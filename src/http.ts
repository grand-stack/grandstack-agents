#!/usr/bin/env node
// Copyright (c) "Neo4j"
// Neo4j Sweden AB [http://neo4j.com]
// MCP server over streamable HTTP (stateless): POST /mcp. A new server and transport per request, no sessions.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { loadConfig, type Config } from "./config.js";
import { createMcpServer } from "./mcp.js";
import { createTools, type ToolOptions } from "./tools.js";

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > 1_000_000) throw new Error("request body too large");
    chunks.push(chunk as Buffer);
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : undefined;
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
}

export function createHttpServer(options: ToolOptions) {
  return createServer(async (req, res) => {
    const path = (req.url ?? "").split("?")[0];
    if (path === "/healthz") return send(res, 200, { ok: true });
    if (path !== "/mcp") return send(res, 404, { error: "Not found. The MCP endpoint is POST /mcp." });
    if (req.method !== "POST") {
      res.setHeader("allow", "POST");
      return send(res, 405, { jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed. This server is stateless: use POST /mcp." }, id: null });
    }
    try {
      const body = await readJson(req);
      const server = createMcpServer(createTools(options));
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      res.on("close", () => { void transport.close(); void server.close(); });
      await server.connect(transport);
      await transport.handleRequest(req, res, body);
    } catch (error) {
      if (!res.headersSent) send(res, 400, { jsonrpc: "2.0", error: { code: -32700, message: `Bad request: ${(error as Error).message}` }, id: null });
    }
  });
}

export function startHttp(config: Config = loadConfig()) {
  const server = createHttpServer({ config });
  server.listen(config.port, config.host, () => {
    console.log(`grandstack-agents MCP (http) at http://${config.host}:${config.port}/mcp: GraphQL ${config.graphqlUrl}, mutations ${config.allowMutations ? "ALLOWED" : "disabled"}`);
  });
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => { server.close(); process.exit(0); });
  return server;
}

if (import.meta.url === `file://${process.argv[1]}`) startHttp();
