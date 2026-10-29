# AGENTS.md: grandstack-agents

How agents work with GraphQL: an MCP server that runs GraphQL statements, and a direct agent-loop example. It uses the open `grandstack-server` (no auth); `docs/adding-auth.md` shows the auth variant.

## Commands

```sh
npm ci
npm test              # unit and integration tests, no Docker needed
npm run typecheck
npm run docs:check    # links, anchors, alt text, SVGs, diagram legends
npm run mcp:http      # MCP over HTTP on :4100 (needs the stack for real use)
npm run mcp:stdio
npm run live          # needs the open stack up
```

The stack (`grandstack` umbrella): `docker compose -f compose.yaml -f compose.agents.yaml up --build`.

## Where things are

- `src/graphql.ts` the guarded executor (parse, classify, timeout, size cap); every request goes through it.
- `src/tools.ts` the four tools; `src/mcp.ts` registers them; `src/agent.ts` has the loop and the single `graphql` tool.
- `docs/` explains all of it; `docs/diagrams/` has annotated SVGs (the checker verifies legends).

## Rules

- **Build on the blocks; do not make a silo.** A new repository or setup must be made from what GRANDstack already provides (the `grandstack-server` image and its models, the `grandstack-federation` gateway, `grandstack-auth`, `grandstack-agents`, compose overlays in the `grandstack` repository), and improve a block when it falls short rather than copying or working around it. Read [building on GRANDstack](../grandstack/docs/building-on-grandstack.md) before creating a repository, a compose file, a server, a gateway or a docs structure. Providing building blocks that people shape into their own solution is a goal of the project.
- Keep mutations off by default (`ALLOW_MUTATIONS`). Do not weaken that or the lane checks without a test.
- Tool errors are returned as text with `isError`, not thrown.
- No auth in this repo's default path. Auth lives in `examples/with-auth` and `grandstack-auth`.
- Pin `@modelcontextprotocol/sdk` and use v1-style imports. `graphql` must stay 16.x.
- Do not claim in docs what you did not run. The live Claude run is not exercised by tests; keep saying so until it is.
- Add a test for every new tool or guardrail (`test/tools.test.ts`, `test/mcp.test.ts`).
- New code files need the copyright header (two lines: `Copyright (c) "Neo4j"` and `Neo4j Sweden AB [http://neo4j.com]`, in the file's comment syntax). Run `node ../grandstack/scripts/add-headers.mjs` (or `node ../.github/scripts/headers.mjs --root .` for one repository) to add it; `--check` lists what is missing. Generated files are exempt.
- Releases use the **release-cut** workflow (Actions tab), which sets the version in every `package.json`, tags and publishes. Do not bump versions or push tags by hand; see `grandstack/docs/releasing.md`.
- Base images in Dockerfiles and compose files are pinned to an exact version **and** a digest (`image:1.2.3@sha256:...`), never a floating tag such as `latest` or `24-slim`, so a rebuilt image cannot silently change or be swapped. Dependabot proposes updates to both; take them through a pull request that passes CI. To pin a new image, look up the digest of the multi-arch index (not of one platform).
