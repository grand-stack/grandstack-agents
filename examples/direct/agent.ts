// Ask a question about the data; a Claude model writes and runs GraphQL against the server until it can answer.
//   ANTHROPIC_API_KEY=... npm run agent -- "Which three directors have made the most films?"
// Settings: GRAPHQL_URL, ALLOW_MUTATIONS (default false), ANTHROPIC_MODEL (default claude-sonnet-5-5), GRAPHQL_HEADERS.
import { loadConfig } from "../../src/config.js";
import { graphqlTool, runAgent, systemPrompt } from "../../src/agent.js";
import { anthropicAdapter } from "./adapter-anthropic.js";

const question = process.argv.slice(2).join(" ").trim();
if (!question) {
  console.error('Usage: npm run agent -- "your question about the data"');
  process.exit(2);
}
if (!process.env.ANTHROPIC_API_KEY) {
  console.error("Set ANTHROPIC_API_KEY to run this example (it calls a Claude model). See docs/agent-loop.md.");
  process.exit(2);
}

const config = loadConfig();
console.error(`GraphQL ${config.graphqlUrl}, mutations ${config.allowMutations ? "ALLOWED" : "disabled"}`);
const result = await runAgent({
  question,
  adapter: anthropicAdapter(),
  tools: [graphqlTool(config)],
  system: await systemPrompt(config),
  onToolCall: ({ name, input, result }) => {
    console.error(`\n> ${name}: ${String(input.query).replace(/\s+/g, " ").trim()}`);
    console.error(`  ${result.is_error ? "ERROR" : "ok"}: ${result.content.slice(0, 200)}${result.content.length > 200 ? "..." : ""}`);
  },
});
console.log(`\n${result.answer}\n\n(${result.toolCalls} GraphQL call${result.toolCalls === 1 ? "" : "s"}, ${result.steps} model step${result.steps === 1 ? "" : "s"})`);
