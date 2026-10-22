# Designing the type definitions for agents

An agent works with the schema it is given. The tools in this repo read it by introspection, so what the agent sees is whatever the type definitions say. A schema that is generated from a data model and left as it came is usable, but it is not the best an agent can get. One tailored to the questions you want answered does better.

> **Where this comes from.** This is the experience of the project's maintainers from other testing, not something measured in this repository. There is no benchmark here, and the sample schema was not rewritten to compare. Treat it as guidance to try on your own schema and measure.

## Why introspection alone falls short

Introspection reports structure: types, fields, arguments. An agent needs intent. A generated schema is a faithful picture of the database, which is rarely the shape of the questions people ask:

- **Names follow the data, not the task.** A field called `acted` or a relationship type from the database tells an agent little about when to use it.
- **Missing descriptions.** Without them the agent guesses what a field means, what its values look like, and which one to pick when two seem alike.
- **Everything is exposed.** Generated filter, sort and input types are large. This repo's `get_schema` summary leaves them out for that reason (about 4.6 KB instead of 34 KB for the sample), but the agent still has to find the right one.
- **The answer is several hops away.** If a common question needs a traversal, an aggregation and a sort, the agent must assemble it correctly every time.

## What a tailored schema does

These are choices you make in the schema file. The sample schema already makes several of them:

| Choice | Example in this stack |
| --- | --- |
| Describe every type and field, including units and allowed values, and say when to use it | Lint requires a description on everything the schema file defines; the generated [schema reference](../../grandstack-server/docs/schema-reference.md) lists them |
| Store the answer to a common question instead of making the agent compute it | `Person.actedCount` and `directedCount` are stored, so "who has directed the most films" is one sorted query, refreshed by the server after every mutation |
| Name things for the task | Fields and relationships are named for what a person would say (`actors`, `directors`, `genres`) |
| Leave out what an agent should not use | `nestedOperations: []` and `@mutation(operations: ...)` limit which generated mutations exist |
| Write your own Cypher where the generated Cypher is slow or does not fit (`@cypher`) | [Custom Cypher](#custom-cypher-with-cypher), run on the sample data |
| Offer purpose-built operations for frequent questions | A fixed tool is the same idea one level up: see [add a fixed-purpose tool](recipes.md#add-a-fixed-purpose-tool) |

Beyond those, use [`@cypher`](#custom-cypher-with-cypher) for questions that are common and awkward or slow in the generated shape, and keep the description of each operation as specific as a tool description, because the agent reads it the same way.

## Custom Cypher with `@cypher`

The generated Cypher is general. When it is slow for a question, or does not do what the question needs, write the Cypher yourself with the `@cypher` directive and give the result a name and a description an agent can find. There are two places to use it.

**A computed field on a type.** Inside the statement, `this` is the node. `columnName` says which returned column is the field's value:

```graphql
extend type Person {
  "How many different people this person has worked with on a film, as actor or director."
  collaboratorCount: Int!
    @cypher(
      statement: """
      MATCH (this)-[:ACTED_IN|DIRECTED]->(:Movie)<-[:ACTED_IN|DIRECTED]-(other:Person)
      WHERE other <> this
      RETURN count(DISTINCT other) AS n
      """
      columnName: "n"
    )
}
```

Asking `{ people(where: { name: { eq: "Tom Hanks" } }) { name collaboratorCount } }` returned `collaboratorCount` 41 on the sample data.

**A custom query.** Arguments are available in the statement as parameters (`$limit`), and the field can return a type from the schema, so the agent can select fields on the result as usual:

```graphql
type Query {
  "People who have directed the most films, most first. Use this for questions about top directors."
  topDirectors(limit: Int = 5): [Person!]!
    @cypher(
      statement: """
      MATCH (p:Person)-[:DIRECTED]->(m:Movie)
      WITH p, count(m) AS n
      ORDER BY n DESC, p.name
      LIMIT $limit
      RETURN p AS person
      """
      columnName: "person"
    )
}
```

`{ topDirectors(limit: 3) { name directedCount } }` returned Christopher Nolan 8, Steven Spielberg 7, Martin Scorsese 6 (ties are broken by name).

Both were run on the sample stack by loading the definitions through the server's `SCHEMA_EXTRA_PATHS` setting (see the server's configuration doc) in a throwaway server instance; they are **not** part of the shipped schema. Two things we hit:

- Define custom queries with `type Query { ... }` in the extra file. `extend type Query` made `@neo4j/graphql` 7.6.4 crash at startup with `Cannot read properties of undefined (reading 'kind')`, because the base schema file has no `Query` type of its own. (`extend type Person` works.)
- The description is what an agent reads. Say when to use the field, as in `topDirectors` above. A custom query with a clear name and description is the schema-level version of a [fixed-purpose tool](recipes.md#add-a-fixed-purpose-tool), and the agent finds it with `get_schema` without any change to the MCP server.

Use it where it earns its place: a question that is common and slow or awkward in the generated shape, or a result the generated filters cannot express. Keep statements read-only and small, and review them like any query you would put in front of production: custom Cypher runs as you wrote it, so the generated limits and filters do not apply to it. We did not test `@cypher` on mutations, filtering or sorting by a `@cypher` field, or authorization rules on one, so check those on your own schema before relying on them.

## If you cannot change the schema

You may not own the schema, or not be able to change it. Two options:

1. **Put the missing knowledge outside it.** Write the intent into the system prompt (`systemPrompt` in `src/agent.ts`), into fixed-purpose tools, or into a short guide the agent reads first, such as the umbrella's `llms.txt`.
2. **Ask an agent what type definitions would help.** Give it the introspected schema and a list of the questions you want answered, and ask what descriptions, names, stored fields or custom queries would make those questions easier. In the maintainers' testing, agents gave useful suggestions this way. Treat the output as proposals: review them, apply what is right, and check the result by asking the questions again.

## Models matter too

Newer models do better with the same schema, as you would expect: they write more accurate queries, recover better from errors and cope with larger schemas. That is not a reason to skip the design work. A better model and a better schema add up, and the schema is the part you control and that keeps working when you change models. Re-test when you change model, using the same set of questions; `ANTHROPIC_MODEL` switches the model for the [agent loop example](agent-loop.md#run-it-with-claude).

## A way to test your schema

1. Write 10 to 20 real questions, with the answers you expect.
2. Run them through an agent (the [agent loop](agent-loop.md) or an MCP client), read-only.
3. Note which fail or take many calls, and look at the statements the agent wrote. A repeated wrong field or a long traversal points at a name, a missing description or a missing stored field.
4. Change the schema (or add a tool), and run the same questions again.
