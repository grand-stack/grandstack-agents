// Calls the running MCP container (or any streamable-HTTP MCP endpoint) like a client would. Usage: npm run container
// MCP_URL defaults to http://localhost:4100/mcp. Read-only: it only runs a query and expects a mutation to be refused
// unless the server was started with ALLOW_MUTATIONS=true (set EXPECT_MUTATIONS=true in that case).
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const url = process.env.MCP_URL ?? "http://localhost:4100/mcp";
const results: string[] = [];
const check = (name: string, ok: boolean, extra = "") => results.push(`${ok ? "PASS" : "FAIL"} ${name}${extra ? " " + extra : ""}`);
const text = (r: unknown) => (r as { content: { text: string }[] }).content[0].text;

const client = new Client({ name: "container-check", version: "0" });
await client.connect(new StreamableHTTPClientTransport(new URL(url)));
try {
  check("lists the four tools", (await client.listTools()).tools.map((t) => t.name).join(",") === "get_schema,describe_type,run_query,run_mutation");
  const q = await client.callTool({ name: "run_query", arguments: { query: "{ moviesConnection { totalCount } }" } });
  check("answers a query through the container", q.isError === false && /"totalCount":\d+/.test(text(q)), text(q));
  const m = await client.callTool({ name: "run_mutation", arguments: { query: "mutation { deleteMovies(where: { title: { eq: \"ZZ none\" } }) { nodesDeleted } }" } });
  const expectMutations = process.env.EXPECT_MUTATIONS === "true";
  check(expectMutations ? "mutations are allowed (as configured)" : "mutations are refused by default", expectMutations ? m.isError === false : m.isError === true && /ALLOW_MUTATIONS/.test(text(m)));
} finally { await client.close(); }
console.log(results.join("\n"));
const failed = results.filter((r) => r.startsWith("FAIL")).length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
