import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { createHttpServer } from "../src/http.js";
import { startStub, type Stub } from "./stub-server.js";

let stub: Stub;
beforeAll(async () => { stub = await startStub(); });
afterAll(async () => { await stub.close(); });

const text = (r: unknown): string => ((r as { content: { text: string }[] }).content[0]).text;

/** The same behaviour is expected over both transports. */
async function exercise(client: Client, mutationsAllowed: boolean) {
  const tools = (await client.listTools()).tools.map((t) => t.name);
  expect(tools).toEqual(["get_schema", "describe_type", "run_query", "run_mutation"]);

  const schema = await client.callTool({ name: "get_schema", arguments: {} });
  expect(text(schema)).toContain("movies(limit: Int)");

  const query = await client.callTool({ name: "run_query", arguments: { query: "{ moviesConnection { totalCount } }" } });
  expect(text(query)).toBe('{"data":{"moviesConnection":{"totalCount":2}}}');
  expect(query.isError).toBe(false);

  const bad = await client.callTool({ name: "run_query", arguments: { query: "{ movies { titel } }" } });
  expect(bad.isError).toBe(true);

  const mutation = await client.callTool({ name: "run_mutation", arguments: { query: "mutation { deleteMovies(title: \"x\") { nodesDeleted } }" } });
  if (mutationsAllowed) {
    expect(mutation.isError).toBe(false);
    expect(text(mutation)).toContain("nodesDeleted");
  } else {
    expect(mutation.isError).toBe(true);
    expect(text(mutation)).toMatch(/ALLOW_MUTATIONS=true/);
  }
  expect(client.getInstructions()).toMatch(/get_schema/);
}

describe("MCP over stdio", () => {
  for (const allowed of [false, true]) {
    it(`works with mutations ${allowed ? "allowed" : "disabled"}`, async () => {
      const transport = new StdioClientTransport({
        command: process.execPath,
        args: ["--import", "tsx", "src/stdio.ts"],
        env: { ...process.env as Record<string, string>, GRAPHQL_URL: stub.url, ALLOW_MUTATIONS: String(allowed) },
        stderr: "ignore",
      });
      const client = new Client({ name: "test", version: "0" });
      await client.connect(transport);
      try { await exercise(client, allowed); } finally { await client.close(); }
    }, 30_000);
  }
});

describe("MCP over streamable HTTP", () => {
  for (const allowed of [false, true]) {
    it(`works with mutations ${allowed ? "allowed" : "disabled"}`, async () => {
      const server = createHttpServer({ config: loadConfig({ GRAPHQL_URL: stub.url, ALLOW_MUTATIONS: String(allowed) }) });
      await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
      const { port } = server.address() as AddressInfo;
      const client = new Client({ name: "test", version: "0" });
      await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`)));
      try { await exercise(client, allowed); } finally { await client.close(); server.closeAllConnections(); server.close(); }
    }, 30_000);
  }

  it("answers health checks, and rejects GET on /mcp and unknown paths", async () => {
    const server = createHttpServer({ config: loadConfig({ GRAPHQL_URL: stub.url }) });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      expect((await fetch(`${base}/healthz`)).status).toBe(200);
      const get = await fetch(`${base}/mcp`);
      expect(get.status).toBe(405);
      expect(get.headers.get("allow")).toBe("POST");
      expect((await fetch(`${base}/nope`)).status).toBe(404);
    } finally { server.closeAllConnections(); server.close(); }
  });
});
