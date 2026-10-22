// Checks the tools against a RUNNING grandstack stack (default http://localhost:4000/graphql), over MCP (streamable HTTP).
// Creates data named "ZZ Agent ..." and removes it. Usage: npm run live   (GRAPHQL_URL to point elsewhere)
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { AddressInfo } from "node:net";
import { graphqlTool, runAgent, systemPrompt, type Block } from "../src/agent.js";
import { loadConfig } from "../src/config.js";
import { createHttpServer } from "../src/http.js";

const url = process.env.GRAPHQL_URL ?? "http://localhost:4000/graphql";
const results: string[] = [];
const check = (name: string, ok: boolean, extra = "") => results.push(`${ok ? "PASS" : "FAIL"} ${name}${extra ? " " + extra : ""}`);
const text = (r: unknown) => (r as { content: { text: string }[] }).content[0].text;

async function withClient<T>(allowMutations: boolean, fn: (c: Client) => Promise<T>): Promise<T> {
  const server = createHttpServer({ config: loadConfig({ GRAPHQL_URL: url, ALLOW_MUTATIONS: String(allowMutations) }) });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const client = new Client({ name: "live-check", version: "0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`)));
  try { return await fn(client); } finally { await client.close(); server.closeAllConnections(); server.close(); }
}
const call = (c: Client, name: string, args: Record<string, unknown>) => c.callTool({ name, arguments: args });

await withClient(false, async (c) => {
  const schema = text(await call(c, "get_schema", {}));
  check("schema summary describes Movie and Person", schema.includes("type Movie") && schema.includes("type Person"), `(${schema.length} bytes)`);
  check("schema summary is small enough to read in one go", schema.length < 8000);
  const full = text(await call(c, "get_schema", { detail: "full" }));
  check("full schema is much larger than the summary", full.length > schema.length * 4, `(${full.length} bytes)`);
  check("describe_type shows the filter shape", text(await call(c, "describe_type", { name: "MovieWhere" })).includes("rating: FloatScalarFilters"));

  const top = JSON.parse(text(await call(c, "run_query", { query: "{ people(where: { directedCount: { gt: 0 } }, sort: [{ directedCount: DESC }, { name: ASC }], limit: 3) { name directedCount } }" })));
  const names = top.data.people.map((p: { name: string }) => p.name);
  check("top directors by number of films", JSON.stringify(names) === JSON.stringify(["Christopher Nolan", "Steven Spielberg", "Martin Scorsese"]), JSON.stringify(top.data.people));

  const typo = await call(c, "run_query", { query: "{ movies(limit: 1) { titel } }" });
  check("a typo comes back as a readable error", typo.isError === true && text(typo).includes("Did you mean"));
  const refused = await call(c, "run_mutation", { query: "mutation { deleteMovies(where: { title: { eq: \"ZZ none\" } }) { nodesDeleted } }" });
  check("mutations are refused by default", refused.isError === true && /ALLOW_MUTATIONS/.test(text(refused)));
});

await withClient(true, async (c) => {
  const count = async (name: string) => JSON.parse(text(await call(c, "run_query", { query: `{ people(where: { name: { eq: "${name}" } }) { actedCount } }` }))).data.people[0].actedCount as number;
  const before = await count("Tom Hanks");
  try {
    const created = await call(c, "run_mutation", {
      query: "mutation($t: String!) { createMovies(input: [{ title: $t, released: 2030, actors: { connect: [{ where: { node: { name: { eq: \"Tom Hanks\" } } }, edge: { roles: [\"Agent test\"] } }] } }]) { movies { title } } }",
      variables: { t: "ZZ Agent Movie" },
    });
    check("with the flag a movie can be created", created.isError === false && text(created).includes("ZZ Agent Movie"), text(created).slice(0, 120));
    check("the stored count was refreshed by the server", (await count("Tom Hanks")) === before + 1);
  } finally {
    const del = await call(c, "run_mutation", { query: "mutation { deleteMovies(where: { title: { startsWith: \"ZZ Agent\" } }) { nodesDeleted } }" });
    check("the test movie is deleted again", text(del).includes('"nodesDeleted":1'));
  }
  check("counts are back to normal", (await count("Tom Hanks")) === before);
});

// The direct approach: the agent loop with a scripted model, sending real GraphQL to the real server
{
  const config = loadConfig({ GRAPHQL_URL: url });
  const turns: Block[][] = [
    [{ type: "tool_use", id: "1", name: "graphql", input: { query: "{ moviesConnection(where: { rating: { gte: 9 } }) { totalCount } }" } }],
    [{ type: "text", text: "answered" }],
  ];
  let i = 0;
  let toolText = "";
  const r = await runAgent({ question: "q", system: await systemPrompt(config), tools: [graphqlTool(config)], adapter: { next: async () => ({ content: turns[i++] }) }, onToolCall: (c) => { toolText = c.result.content; } });
  check("direct approach: the agent loop sends real GraphQL and gets real data", r.answer === "answered" && /"totalCount":\d+/.test(toolText), toolText);
}

console.log(results.join("\n"));
const failed = results.filter((r) => r.startsWith("FAIL")).length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
