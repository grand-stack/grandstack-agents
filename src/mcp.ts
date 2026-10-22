// Copyright (c) "Neo4j"
// Neo4j Sweden AB [http://neo4j.com]
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { SERVER_INSTRUCTIONS, type Tool } from "./tools.js";

export const VERSION = "0.1.0";

/** An MCP server that exposes the tools. Create one per connection (stdio) or per request (stateless HTTP). */
export function createMcpServer(tools: Tool[]): McpServer {
  const server = new McpServer({ name: "grandstack-agents", version: VERSION }, { instructions: SERVER_INSTRUCTIONS });
  for (const tool of tools) {
    server.registerTool(tool.name, { description: tool.description, inputSchema: tool.inputShape as Record<string, z.ZodType> }, async (args: Record<string, unknown>) => {
      const result = await tool.handler(args);
      return { content: [{ type: "text" as const, text: result.text }], isError: result.isError ?? false };
    });
  }
  return server;
}
