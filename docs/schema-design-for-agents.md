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
| Offer purpose-built operations for frequent questions | A fixed tool is the same idea one level up: see [add a fixed-purpose tool](recipes.md#add-a-fixed-purpose-tool) |

Beyond those, consider custom queries (for example a `topDirectors(limit:)` field backed by a Cypher query) when a question is both common and awkward in the generated shape, and keep the description of each operation as specific as a tool description, because the agent reads it the same way.

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
