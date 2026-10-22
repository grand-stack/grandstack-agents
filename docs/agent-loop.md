# The agent loop

`src/agent.ts` is the whole idea of an agent in about 60 lines: send the question and the tool list to a model; if the model asks for a tool, run it and send back the result; repeat until the model answers in text. There is no MCP in it.

```ts
const result = await runAgent({
  question: "Which three directors have made the most films?",
  adapter: anthropicAdapter(),                 // the model, behind a small interface
  tools: [graphqlTool(config)],                // one tool: send a GraphQL statement
  system: await systemPrompt(config),          // how to work, plus a schema summary
});
console.log(result.answer);
```

## Pieces

| | Where | Does |
| --- | --- | --- |
| `graphqlTool(config)` | `src/agent.ts` | The single `graphql` tool. Same guardrails as the MCP tools: parse first, one operation, no subscriptions, mutations only when `ALLOW_MUTATIONS=true` |
| `systemPrompt(config)` | `src/agent.ts` | Instructions plus the schema summary (about 4.6 KB), so no tool call is spent learning the schema |
| `runAgent(...)` | `src/agent.ts` | The loop. Stops when the model answers, or after `maxSteps` (default 8) |
| `ModelAdapter` | `src/agent.ts` | `next({ system, messages, tools }) -> { content }`. Messages use the Anthropic content-block shape |
| `anthropicAdapter()` | `examples/direct/adapter-anthropic.ts` | The adapter for Claude |

To use another model provider, write an adapter that turns `messages` and `tools` into that provider's request and its reply back into `text` and `tool_use` blocks. Nothing else changes.

## Run it with Claude

You need an Anthropic API key. The stack must be running (see the README).

```sh
export ANTHROPIC_API_KEY=...            # your key
npm run agent -- "Which three directors have made the most films?"
```

The script prints each GraphQL statement and a short result to stderr, then the answer and a count of calls. Without a key it exits with a message. `ANTHROPIC_MODEL` sets the model (default `claude-sonnet-5-5`). `ALLOW_MUTATIONS=true` lets it change data; leave it off for questions.

> **Not run live by the authors.** The loop, the tool and its guardrails are tested with a scripted model that makes two tool calls and answers ([testing](testing.md)); the Claude adapter is type-checked but was not exercised, because that needs a key. If it misbehaves, the adapter at `examples/direct/adapter-anthropic.ts` is the place to look.

## Using the MCP tools in your own loop instead

If you would rather give your agent the four MCP tools than the single `graphql` tool, `createTools(...)` in `src/tools.ts` returns them with handlers, and `inputSchemaOf(tool)` gives the JSON Schema a model API wants. They are the same objects the MCP server registers.
