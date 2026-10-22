# Direct GraphQL

An agent does not need MCP to use GraphQL. It needs the endpoint, a way to learn the schema, and the discipline to fix its own errors. This page shows the loop with plain `curl`; [the agent loop](agent-loop.md) wraps it in code.

The endpoint here is `http://localhost:4000/graphql`, the open `grandstack-server`.

## 1. Learn the shape

Read the descriptions first: every type and field in the server's schema has one ([schema guide](../../grandstack-server/docs/schema-guide.md) in the server repo, and `llms.txt` in the umbrella). Then ask the server:

```sh
curl -s localhost:4000/graphql -H 'content-type: application/json' \
  -d '{"query":"{ __schema { queryType { fields { name } } } }"}'
```

```json
{"data":{"__schema":{"queryType":{"fields":[{"name":"moviesConnection"},{"name":"movies"},{"name":"peopleConnection"},{"name":"people"},{"name":"genresConnection"},{"name":"genres"}]}}}}
```

The generated schema is large. Ask for one type at a time:

```graphql
{ __type(name: "MovieWhere") { inputFields { name type { name kind ofType { name } } } } }
```

## 2. Query

Filters use operators such as `eq`, `contains`, `gte`, `startsWith` (`contains` is case-sensitive). `...Connection` fields give `totalCount`.

```sh
curl -s localhost:4000/graphql -H 'content-type: application/json' \
  -d '{"query":"{ movies(where:{title:{contains:\"Matrix\"}}){ title released genres{name} } }"}'
```

```json
{"data":{"movies":[{"title":"The Matrix","released":1999,"genres":[{"name":"Action"},{"name":"Sci-Fi"}]},{"title":"The Matrix Reloaded","released":2003,"genres":[{"name":"Action"},{"name":"Sci-Fi"}]}]}}
```

With variables, and a count:

```sh
curl -s localhost:4000/graphql -H 'content-type: application/json' \
  -d '{"query":"query($y:Int){ moviesConnection(where:{released:{gte:$y}}){ totalCount } }","variables":{"y":2010}}'
```

```json
{"data":{"moviesConnection":{"totalCount":40}}}
```

Sorting takes a list of single-field objects, for example `sort: [{ released: ASC }]` (the exact enum is in `MovieSort`; ask for it with `describe_type` or `__type`). "Who has directed the most films":

```graphql
{ people(sort: [{ directedCount: DESC }], limit: 3) { name directedCount } }
```

returns Christopher Nolan 8, Steven Spielberg 7, Quentin Tarantino 6. The counts are stored on each person and refreshed by the server after every mutation.

## 3. Read the errors

```sh
curl -s localhost:4000/graphql -H 'content-type: application/json' \
  -d '{"query":"{ movies(where:{titel:\"x\"}){ title } }"}'
```

```json
{"errors":[{"message":"Field \"titel\" is not defined by type \"MovieWhere\". Did you mean \"title\"?","locations":[{"line":1,"column":17}],"extensions":{"code":"GRAPHQL_VALIDATION_FAILED"}}]}
```

GraphQL returns HTTP 200 with an `errors` array, so an agent must look at the body, not just the status. The message says what to fix. That is the loop: write, run, read the error, correct.

## 4. Mutate carefully

```graphql
mutation($t: String!) {
  createMovies(input: [{ title: $t, released: 2030,
    actors: { connect: [{ where: { node: { name: { eq: "Tom Hanks" } } }, edge: { roles: ["Agent test"] } }] } }]) {
    movies { title }
  }
}
```

Rules an agent must know (also in the [server mutation guide](../../grandstack-server/docs/mutations.md)):

- Update scalars with `{ set: value }`.
- Change relationships as a difference (connect what is new, disconnect what is gone), never "disconnect all then connect" in one mutation.
- Delete a movie with `deleteMovies(where: ...)`. Always filter; `deleteMovies` with no filter deletes everything.

Cleanup of the example: `mutation { deleteMovies(where: { title: { startsWith: "ZZ Agent" } }) { nodesDeleted } }`.

On an open server nothing stops an agent from writing. That is why the MCP server and the example agent are read-only by default; see [guardrails](guardrails.md).
