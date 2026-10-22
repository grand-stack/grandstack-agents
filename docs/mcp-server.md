# The MCP server

A small [Model Context Protocol](https://modelcontextprotocol.io) server that accepts GraphQL statements and runs them against any GraphQL endpoint. It knows nothing about movies: the schema is read by introspection, so it works with another GraphQL server too.

> **Where to run this.** Commands on this page that start with `npm`, `node` or `docker build` run inside a clone of this repository: `git clone https://github.com/grand-stack/grandstack-agents`, then `cd grandstack-agents` (Node 22 or later; run `npm ci` once). Commands that need the running stack use the `grandstack` repository's compose files: see the [quickstart](https://www.grandstack.ai/quickstart/).

## Tools

| Tool | Input | Result |
| --- | --- | --- |
| `get_schema` | `detail`: `summary` (default) or `full` | SDL text. The summary lists root query and mutation fields with arguments, and the types the schema defines with descriptions; generated filter, sort and input types are left out |
| `describe_type` | `name`, for example `MovieWhere` | The definition of that type, input or enum. An unknown name returns suggestions |
| `run_query` | `query`, optional `variables`, `operationName` | The JSON response as text. Mutations and subscriptions are refused |
| `run_mutation` | same | The JSON response as text. Refused unless `ALLOW_MUTATIONS=true`; queries are refused |

Failures (a syntax error, a GraphQL error, a refusal, a timeout) are returned as text with `isError: true`, so the agent can read and correct.

## Transports

| | Command | Use when |
| --- | --- | --- |
| stdio | `npm run mcp:stdio` | The client starts the process: Claude Code, Claude Desktop |
| Streamable HTTP | `npm run mcp:http`, or the `agents-mcp` container | A long-running server, a container, remote or shared use |

The HTTP server is **stateless**: `POST /mcp` only. `GET /mcp` returns 405, `GET /healthz` returns `{"ok":true}`. It listens on `127.0.0.1` by default; the container sets `HOST=0.0.0.0` and publishes port 4100. It has no auth of its own: anyone who can reach port 4100 can run queries (and mutations, if enabled) as the server is configured. Do not expose it beyond your machine without putting auth in front.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `GRAPHQL_URL` | `http://localhost:4000/graphql` | The endpoint to run statements against |
| `ALLOW_MUTATIONS` | `false` | `true` enables `run_mutation` |
| `GRAPHQL_HEADERS` | none | JSON object of extra headers, for example `{"authorization":"Bearer ..."}` |
| `TIMEOUT_MS` | `15000` | Request timeout |
| `MAX_RESULT_BYTES` | `100000` | Results longer than this are cut with a marker |
| `MAX_DOCUMENT_BYTES` | `20000` | Longest statement accepted |
| `PORT`, `HOST` | `4100`, `127.0.0.1` | HTTP only |

With the umbrella, `AGENTS_ALLOW_MUTATIONS=true docker compose -f compose.yaml -f compose.agents.yaml up -d` turns writes on for the container.

## Connecting a client

**Claude Code, HTTP** (server already running on :4100):

```sh
claude mcp add --transport http grandstack http://localhost:4100/mcp
```

**Claude Code, stdio** (Claude Code starts the process; use absolute paths):

```sh
claude mcp add grandstack -e GRAPHQL_URL=http://localhost:4000/graphql -- npx --prefix /path/to/grandstack-agents tsx /path/to/grandstack-agents/src/stdio.ts
```

**Claude Desktop** (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "grandstack": {
      "command": "npx",
      "args": ["--prefix", "/path/to/grandstack-agents", "tsx", "/path/to/grandstack-agents/src/stdio.ts"],
      "env": { "GRAPHQL_URL": "http://localhost:4000/graphql" }
    }
  }
}
```

Add `"ALLOW_MUTATIONS": "true"` to `env` to let the agent write. To skip `tsx`, run `npm run build` once and use `node /path/to/grandstack-agents/dist/stdio.js`.

> Verified: the HTTP server and the stdio entry point against the SDK client (see [testing](testing.md)), and `claude mcp add` accepted both commands above. A live conversation in Claude Code or Claude Desktop was **not** run by the authors.

**Your own app**, with the MCP SDK:

```ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const client = new Client({ name: "my-app", version: "1.0.0" });
await client.connect(new StreamableHTTPClientTransport(new URL("http://localhost:4100/mcp")));
const result = await client.callTool({ name: "run_query", arguments: { query: "{ moviesConnection { totalCount } }" } });
console.log(result.content);
```

## Debugging with curl

The HTTP server speaks JSON-RPC. Send both `Accept` types; the reply is a single server-sent event:

```sh
curl -s localhost:4100/mcp -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"run_query","arguments":{"query":"{ moviesConnection { totalCount } }"}}}'
```

```
event: message
data: {"result":{"content":[{"type":"text","text":"{\"data\":{\"moviesConnection\":{\"totalCount\":152}}}"}],"isError":false},"jsonrpc":"2.0","id":1}
```

`"method":"tools/list"` lists the tools. The same call with `run_mutation` and a mutation returns `isError: true` and "Mutations are disabled" until the flag is set.
