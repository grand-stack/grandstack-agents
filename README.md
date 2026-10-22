# grandstack-agents

How agents work with GraphQL. Two ways, both against the open `grandstack-server`:

1. **Directly**: the agent sends GraphQL queries and mutations itself, through a single `graphql` tool in its own loop.
2. **Through an MCP server**: a small server that accepts GraphQL statements and runs them. Any MCP client (Claude Code, Claude Desktop, your own app) can use it.

![Direct versus MCP](docs/diagrams/direct-vs-mcp.svg)

1. An agent you write: the model, the loop and one `graphql` tool.
2. Any MCP client: Claude Code, Claude Desktop or your own app.
3. The guarded executor both paths share: parse, one operation, lane check, mutations off by default, timeout, size cap.
4. `grandstack-server`, open, no auth.
5. The MCP server with its four tools, over stdio or HTTP.

No login is needed here: it talks to `grandstack-server` as it is. [Adding auth](docs/adding-auth.md) shows how to point the same tools at the `grandstack-auth` gateway, with example code. Agent memory, where auth becomes part of the design, is a later phase and its own repo.

> **Read-only by default.** `run_mutation` does nothing until you start the server with `ALLOW_MUTATIONS=true`. That flag is a guardrail for the MCP path, not access control: the server on port 4000 is open. See [guardrails](docs/guardrails.md).

## The tools

| Tool | Does |
| --- | --- |
| `get_schema` | A compact summary of the API (root fields, the types the schema defines). `detail: "full"` returns everything. |
| `describe_type` | One type or input in full, for example `MovieWhere`, so an agent learns exact shapes step by step. |
| `run_query` | Runs a query. Mutations are refused. |
| `run_mutation` | Runs a mutation, only when `ALLOW_MUTATIONS=true`. |

## Run it

With the `grandstack` umbrella and its sibling repos cloned side by side into one folder:

```sh
mkdir grand-stack && cd grand-stack      # any folder name
for repo in grandstack grandstack-server grandstack-web grandstack-agents; do git clone https://github.com/grand-stack/$repo; done
cd grandstack
docker compose -f compose.yaml -f compose.agents.yaml up --build
```

The MCP server (streamable HTTP) is then at `http://localhost:4100/mcp`. Or run it from a clone of this repo (Node 22 or later) against a stack that is already up:

```sh
git clone https://github.com/grand-stack/grandstack-agents   # skip if you cloned it above
cd grandstack-agents
npm ci
npm run mcp:http        # HTTP on :4100
npm run mcp:stdio       # stdio, for clients that start the process themselves
```

Connect Claude Code:

```sh
claude mcp add --transport http grandstack http://localhost:4100/mcp
```

More clients and setups are in [the MCP server guide](docs/mcp-server.md).

## Documentation

| Read | To learn |
| --- | --- |
| [How it works](docs/how-it-works.md) | The pieces, a tool call end to end, the diagrams |
| [The MCP server](docs/mcp-server.md) | Tools in detail, transports, client setup, debugging with curl, configuration |
| [Direct GraphQL](docs/direct-graphql.md) | What an agent does without MCP, with copy-paste examples |
| [The agent loop](docs/agent-loop.md) | The runnable example, the model adapter, running it with Claude |
| [Adding auth](docs/adding-auth.md) | Using `grandstack-auth` with these tools, with verified example code |
| [Schema design for agents](docs/schema-design-for-agents.md) | Why tailored type definitions beat introspection alone, and what to do if you cannot change them |
| [Guardrails](docs/guardrails.md) | What is checked, what is not |
| [Recipes](docs/recipes.md) | Add a tool, restrict operations, change limits |
| [Testing](docs/testing.md) | Unit, MCP, live and container checks |
| [Troubleshooting](docs/troubleshooting.md) | Errors and their fixes |

Working with a coding agent? Start with [AGENTS.md](AGENTS.md).

Last verified: grandstack-agents v0.1.2 with grandstack-server v0.7.1 and grandstack-auth v0.1.1, `@modelcontextprotocol/sdk` 1.32.1, Node 24, under Podman 6 on macOS. The live Claude run of the agent example needs an `ANTHROPIC_API_KEY` and has **not** been run by the authors; the loop is tested with a scripted model.

## Licence

Apache License 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE). The same licence applies to every GRANDstack repository and to [grandstack.ai](https://grandstack.ai).
