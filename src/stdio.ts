#!/usr/bin/env node
// Copyright (c) "Neo4j"
// Neo4j Sweden AB [http://neo4j.com]
// MCP server over stdio, for agents that start a local process (Claude Code, Claude Desktop, ...). Logs go to stderr only.
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { createMcpServer } from "./mcp.js";
import { createTools } from "./tools.js";

const config = loadConfig();
const server = createMcpServer(createTools({ config }));
await server.connect(new StdioServerTransport());
console.error(`grandstack-agents MCP (stdio) ready: GraphQL ${config.graphqlUrl}, mutations ${config.allowMutations ? "ALLOWED" : "disabled"}`);
