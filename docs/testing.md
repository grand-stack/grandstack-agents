# Testing

| Command | Needs | What it proves |
| --- | --- | --- |
| `npm test` | nothing | the unit and integration tests, below (42 today) |
| `npm run typecheck` | nothing | TypeScript compiles for source, examples, scripts and tests |
| `npm run live` | the open stack running | 12 checks against the real server (below) |
| `npm run container` | the `agents-mcp` container running (`compose.agents.yaml`) | 3 checks through `http://localhost:4100/mcp` (`MCP_URL` to change); with `EXPECT_MUTATIONS=true` it checks that writes are enabled instead |
| `npm run auth:check` | the auth stack running | 9 checks of the [auth example](adding-auth.md) |
| `npm run docs:check` | nothing | links, anchors, image alt text, SVG safety, diagram legends |

> **Where to run this.** Commands on this page that start with `npm`, `node` or `docker build` run inside a clone of this repository: `git clone https://github.com/grand-stack/grandstack-agents`, then `cd grandstack-agents` (Node 22 or later; run `npm ci` once). Commands that need the running stack use the `grandstack` repository's compose files: see the [quickstart](https://www.grandstack.ai/quickstart/).

## Unit and integration tests (`npm test`)

They run against `test/stub-server.ts`, a real `graphql-js` server over HTTP, so they need no Docker.

- `graphql.test.ts`: classification (query, mutation, subscription, several operations, syntax errors), size limit, timeout, truncation, unreachable server, non-JSON replies, static and function headers.
- `config.test.ts`: defaults, validation messages.
- `tools.test.ts`: the four tools, lanes, mutations on and off, schema summary and `describe_type`.
- `mcp.test.ts`: the SDK client against the server over **stdio** and **streamable HTTP**: tool listing, a query, a refused mutation, an allowed one.
- `agent.test.ts`: the agent loop with a scripted model that makes two tool calls and answers; the `graphql` tool's guardrails.
- `token-provider.test.ts`: caching, renewal before expiry, shared concurrent logins, error messages.

## Live checks (`npm run live`)

Against the real stack: the schema summary is much smaller than the full schema; top directors are Nolan 8, Spielberg 7, Scorsese 6; a typo returns "Did you mean"; mutations are refused by default; with the flag a `ZZ Agent Movie` is created and removed, and the stored counts return to normal; and the agent loop with a scripted model answers from real data.

## What is not tested

The Claude adapter (`examples/direct/adapter-anthropic.ts`) and a live conversation in Claude Code or Claude Desktop need a key or a client session that the authors did not run. The tools, the loop and both transports are tested without a model.
