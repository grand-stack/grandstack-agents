# Guardrails

What the tools check before anything reaches the GraphQL server, and what they do not.

## What is checked

| Check | Behaviour |
| --- | --- |
| Parse | A syntax error is returned with its line and column. Nothing is sent |
| One operation | A document with several operations needs `operationName`; otherwise it is refused |
| Lane | `run_query` takes only queries, `run_mutation` only mutations; subscriptions are refused |
| Mutations off | `run_mutation` returns an explanation unless `ALLOW_MUTATIONS=true` (the direct `graphql` tool does the same) |
| Document size | Longer than `MAX_DOCUMENT_BYTES` (20000) is refused |
| Timeout | A request longer than `TIMEOUT_MS` (15 s) ends with a message |
| Result size | Longer than `MAX_RESULT_BYTES` (100 kB) is cut and marked as truncated, so an agent does not drown in rows |
| Unreachable or non-JSON | Reported as a tool error, never thrown |

Each is covered by a test (see [testing](testing.md)).

The path of a call, with the four checks, is drawn in [how it works](how-it-works.md#one-tool-call-end-to-end).

## What is not protected

Be honest about this when you give an agent these tools:

- **The server is open.** Port 4000 accepts anyone. `ALLOW_MUTATIONS` limits the MCP path and the example agent, not the server. Anything else on your machine can still send a mutation.
- **A read-only flag is not access control.** It stops an agent *using this server* from writing. It does not identify the agent or limit what it can read.
- **Queries can be expensive.** Nesting and large lists are allowed. The result cap protects the agent's context, not the database. Use `limit` in queries, and consider depth and cost limits at a gateway for anything shared.
- **Agents can be wrong.** A permitted mutation may do the wrong thing, for example `deleteMovies` without a filter. Enable mutations only for sessions where you accept that, and prefer a disposable database.
- **The HTTP endpoint has no auth.** Keep it on localhost.

Real control comes from [auth](adding-auth.md): a token per agent, a role with the least permissions that work, rules at the gateway and in the server.
