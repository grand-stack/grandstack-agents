# Recipes

Both recipes were run against the live stack before being written here.

## Add a fixed-purpose tool

A generic `run_query` is flexible; a fixed tool is cheaper and safer for a question you expect often. A tool is a name, a description, an `inputShape` (a plain object of zod types, **not** `z.object(...)`; MCP reads it directly) and a handler (`src/tools.ts`).

`execute` (the guarded executor) and `guard` (turns thrown errors into `isError` text, as the built-in tools do) are local to `createTools`, so define the tool inside it, before the `return [`, and append it to the returned array:

```ts
// inside createTools, before `return [`
const topDirectors: Tool = {
  name: "top_directors",
  description: "The directors with the most films, most first.",
  inputShape: { limit: z.number().int().min(1).max(20).optional().describe("How many (default 5).") },
  handler: (args) => guard(async () => {
    const result = await execute({
      query: "query($n: Int!) { people(sort: [{ directedCount: DESC }], limit: $n) { name directedCount } }",
      variables: { n: (args.limit as number | undefined) ?? 5 },
    });
    return { text: result.text, isError: !result.ok };
  }),
};
// ... and add `topDirectors` to the array that `return [` starts
```

Against the live stack, `topDirectors.handler({ limit: 2 })` returns `{"data":{"people":[{"name":"Christopher Nolan","directedCount":8},{"name":"Steven Spielberg","directedCount":7}]}}` (checked with a throwaway script calling `createTools` and the handler).

The MCP server and `inputSchemaOf` pick the tool up with no other change. Then update the tests:

- `test/tools.test.ts` and `test/mcp.test.ts` list the tool names, so add yours to those expectations.
- To test the handler, build the tools with a fake executor: `createTools({ config, executor })`, where `executor` is `async ({ query, variables }) => ({ ok: true, status: 200, data, text: JSON.stringify({ data }), truncated: false })`. Check the `variables` it received and the `text` returned. The stub server in `test/stub-server.ts` has a tiny schema (no `where` or `sort`), so a fake executor is the simple route; extend the stub only if you need a real round trip.

## Allow only some mutations

`ALLOW_MUTATIONS` is all or nothing. To permit only named mutations, wrap `run_mutation`. Put this in a new file, `src/only-allowed.ts`:

```ts
import { parse, Kind, type OperationDefinitionNode } from "graphql";
import type { Tool } from "./tools.js";

export const ALLOWED_MUTATIONS = new Set(["updateMovies"]);

export function onlyAllowed(tool: Tool): Tool {
  return {
    ...tool,
    handler: async (args) => {
      let definitions;
      try { definitions = parse(String(args.query)).definitions; }
      catch { return tool.handler(args); } // a syntax error gets the executor's own message
      for (const def of definitions) {
        if (def.kind !== Kind.OPERATION_DEFINITION) continue;
        for (const sel of (def as OperationDefinitionNode).selectionSet.selections) {
          if (sel.kind !== Kind.FIELD) return { text: "Fragments at the top level of a mutation are not allowed here.", isError: true };
          if (!ALLOWED_MUTATIONS.has(sel.name.value)) return { text: `The mutation "${sel.name.value}" is not allowed here. Allowed: ${[...ALLOWED_MUTATIONS].join(", ")}.`, isError: true };
        }
      }
      return tool.handler(args);
    },
  };
}
```

Then wrap the tools **everywhere they are created**: `createTools` is called in `src/stdio.ts`, in `src/http.ts` (once per request, inside `createHttpServer`, using `options`) and in `examples/with-auth/server.ts`. Patching only one leaves the others unrestricted. For stdio:

```ts
const tools = createTools({ config }).map((t) => (t.name === "run_mutation" ? onlyAllowed(t) : t));
```

A refused call returns, for example, `The mutation "deleteMovies" is not allowed here. Allowed: updateMovies.` with `isError: true`. It checks only the top-level fields of each operation. It still needs `ALLOW_MUTATIONS=true`, and it is a convenience for agents: only [auth](adding-auth.md) restricts what the server accepts.

Existing tests use `deleteMovies` as their "allowed mutation" example (`test/mcp.test.ts`), and the stub has no `updateMovies`, so change those tests to a mutation you allow and add it to `test/stub-server.ts`. Add a test that a refused mutation never reaches the executor.

## Change limits

Set `TIMEOUT_MS`, `MAX_RESULT_BYTES`, `MAX_DOCUMENT_BYTES` in the environment; see [the MCP server](mcp-server.md#configuration).

## Point at a different GraphQL server

Set `GRAPHQL_URL`. The tools work from introspection and know nothing about movies; only the example prompts mention them.

## Use the tools from your own agent

See [the agent loop](agent-loop.md#using-the-mcp-tools-in-your-own-loop-instead).
