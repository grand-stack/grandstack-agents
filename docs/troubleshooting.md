# Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| `Not Acceptable: Client must accept both application/json and text/event-stream` | A raw HTTP call to `/mcp` without the `Accept` header. Send `-H 'accept: application/json, text/event-stream'` ([curl example](mcp-server.md#debugging-with-curl)) |
| `405 Method Not Allowed` on `GET /mcp` | The server is stateless and accepts `POST /mcp` only. Use `GET /healthz` to check it is up |
| `GraphQL request failed: could not reach http://localhost:... (fetch failed)` | The GraphQL server is not running or `GRAPHQL_URL` is wrong. In a container, `localhost` is the container: the compose file uses `http://server:4000/graphql` |
| `Mutations are disabled. This server is read-only by default...` | By design. Start with `ALLOW_MUTATIONS=true` (compose: `AGENTS_ALLOW_MUTATIONS=true`). Only the exact value `true` enables it; `1` or `yes` leave it off |
| A mutation works with the flag but the agent still cannot write through the gateway | The auth setup: the user's role lacks the permission. See [adding auth](adding-auth.md) |
| `The document has 2 operations (...). Send one, or pass operationName` | Send a single operation or set `operationName` |
| Results end with a truncation marker | The result exceeded `MAX_RESULT_BYTES`. Ask for fewer fields or use `limit` |
| `Could not get a token for alice: ...` | The auth example cannot log in: the auth stack is not up, `REALM_URL` is wrong, or the user or password is wrong |
| Port 4100 or 4000 already in use | Another process holds it. Stop it or change `PORT`; check `lsof -i :4100`. A Neo4j of your own on 7687 can also clash with the stack |
| `npm run agent` exits asking for `ANTHROPIC_API_KEY` | Set the variable; the example calls a Claude model |
| A client shows no tools | Check the server starts (`npm run mcp:stdio` should wait silently; `curl localhost:4100/healthz` for HTTP) and that paths in the client config are absolute |
