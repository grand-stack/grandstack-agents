// Copyright (c) "Neo4j"
// Neo4j Sweden AB [http://neo4j.com]
// The same MCP server and tools, pointed at the grandstack-auth gateway, acting as one demo user.
// The only difference from src/stdio.ts is the `headers` option: a function that supplies a fresh token for every request.
//   AUTH_USER=alice npx tsx examples/with-auth/server.ts      (stdio; register it with your MCP client like src/stdio.ts)
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "../../src/config.js";
import { createMcpServer } from "../../src/mcp.js";
import { createTools } from "../../src/tools.js";
import { createTokenProvider } from "./token-provider.js";

const user = process.env.AUTH_USER ?? "alice";
const tokenProvider = createTokenProvider({
  realmUrl: process.env.REALM_URL ?? "http://localhost:8081/realms/grandstack",
  clientId: process.env.CLIENT_ID ?? "grandstack-smoke",
  username: user,
  password: process.env.AUTH_PASSWORD ?? `${user}-pass`,
});

// GRAPHQL_URL defaults to http://localhost:4000/graphql, which in the auth setup is the gateway.
const config = loadConfig();
const server = createMcpServer(createTools({ config, headers: tokenProvider }));
await server.connect(new StdioServerTransport());
console.error(`grandstack-agents MCP (stdio, authenticated as ${user}) ready: GraphQL ${config.graphqlUrl}, mutations ${config.allowMutations ? "ALLOWED" : "disabled"}`);
