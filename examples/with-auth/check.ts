// Copyright (c) "Neo4j"
// Neo4j Sweden AB [http://neo4j.com]
// Proves the auth example against a RUNNING auth stack (docker compose -f compose.yaml -f compose.auth.yaml up):
// alice (a "user") can read but cannot change movies, bob (an "editor") can, and an anonymous agent can only read.
// Creates and removes a movie named "ZZ Agent Auth ...". Usage: npx tsx examples/with-auth/check.ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { AddressInfo } from "node:net";
import { loadConfig } from "../../src/config.js";
import { createHttpServer } from "../../src/http.js";
import { createTokenProvider, type TokenProvider } from "./token-provider.js";

const gateway = process.env.GRAPHQL_URL ?? "http://localhost:4000/graphql";
const realmUrl = process.env.REALM_URL ?? "http://localhost:8081/realms/grandstack";
const results: string[] = [];
const check = (name: string, ok: boolean, extra = "") => results.push(`${ok ? "PASS" : "FAIL"} ${name}${extra ? " " + extra : ""}`);
const text = (r: unknown) => (r as { content: { text: string }[] }).content[0].text;
const asUser = (username: string): TokenProvider => createTokenProvider({ realmUrl, clientId: "grandstack-smoke", username, password: `${username}-pass` });

async function withAgent<T>(headers: TokenProvider | undefined, fn: (call: (name: string, args: Record<string, unknown>) => Promise<{ isError?: boolean; text: string }>) => Promise<T>): Promise<T> {
  const server = createHttpServer({ config: loadConfig({ GRAPHQL_URL: gateway, ALLOW_MUTATIONS: "true" }), headers });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const client = new Client({ name: "auth-check", version: "0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`)));
  try {
    return await fn(async (name, args) => { const r = await client.callTool({ name, arguments: args }); return { isError: r.isError as boolean | undefined, text: text(r) }; });
  } finally { await client.close(); server.closeAllConnections(); server.close(); }
}

const create = "mutation($t: String!) { createMovies(input: [{ title: $t }]) { movies { title } } }";
const remove = "mutation($t: String!) { deleteMovies(where: { title: { eq: $t } }) { nodesDeleted } }";
const TITLE = "ZZ Agent Auth Movie";

await withAgent(undefined, async (call) => {
  check("anonymous agent can read", (await call("run_query", { query: "{ moviesConnection { totalCount } }" })).isError === false);
  const w = await call("run_mutation", { query: create, variables: { t: TITLE } });
  check("anonymous agent cannot write", w.isError === true, w.text.slice(0, 90));
});

await withAgent(asUser("alice"), async (call) => {
  check("alice (user) can read", (await call("run_query", { query: "{ moviesConnection { totalCount } }" })).isError === false);
  const w = await call("run_mutation", { query: create, variables: { t: TITLE } });
  check("alice (user) cannot create a movie, and the agent sees why", w.isError === true && /Forbidden|catalog:write/.test(w.text), w.text.slice(0, 110));
  const review = await call("run_mutation", { query: "mutation { createReview(movie: \"Inception\", rating: 8, text: \"ZZ agent review\") { id author { name } } }" });
  check("alice (user) can write a review as herself", review.isError === false && review.text.includes("Alice Reader"), review.text.slice(0, 110));
  const id = (JSON.parse(review.text).data?.createReview?.id as string | undefined) ?? "";
  if (id) await call("run_mutation", { query: "mutation($id: ID!) { deleteReviews(where: { id: { eq: $id } }) { nodesDeleted } }", variables: { id } });
});

await withAgent(asUser("bob"), async (call) => {
  try {
    const c = await call("run_mutation", { query: create, variables: { t: TITLE } });
    check("bob (editor) can create a movie", c.isError === false && c.text.includes(TITLE), c.text.slice(0, 90));
  } finally {
    const d = await call("run_mutation", { query: remove, variables: { t: TITLE } });
    check("bob removes it again", d.text.includes('"nodesDeleted":1'));
  }
});

// The stdio example server (what an MCP client such as Claude Code would start), authenticated as alice
{
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--import", "tsx", "examples/with-auth/server.ts"],
    env: { ...(process.env as Record<string, string>), AUTH_USER: "alice", GRAPHQL_URL: gateway, ALLOW_MUTATIONS: "true", REALM_URL: realmUrl },
    stderr: "ignore",
  });
  const client = new Client({ name: "auth-check-stdio", version: "0" });
  await client.connect(transport);
  try {
    const read = text(await client.callTool({ name: "run_query", arguments: { query: "{ moviesConnection { totalCount } }" } }));
    check("stdio example server: reads as alice", /"totalCount":\d+/.test(read));
    const w = await client.callTool({ name: "run_mutation", arguments: { query: create, variables: { t: TITLE } } });
    check("stdio example server: alice still cannot create a movie", w.isError === true && /Forbidden/.test(text(w)), text(w).slice(0, 90));
  } finally { await client.close(); }
}

console.log(results.join("\n"));
const failed = results.filter((r) => r.startsWith("FAIL")).length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
