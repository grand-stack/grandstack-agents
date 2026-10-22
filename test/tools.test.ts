// Copyright (c) "Neo4j"
// Neo4j Sweden AB [http://neo4j.com]
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { createTools, inputSchemaOf, type Tool } from "../src/tools.js";
import { startStub, type Stub } from "./stub-server.js";

let stub: Stub;
beforeAll(async () => { stub = await startStub(); });
afterAll(async () => { await stub.close(); });

const tools = (env: Record<string, string> = {}) => {
  const list = createTools({ config: loadConfig({ GRAPHQL_URL: stub.url, ...env }) });
  return Object.fromEntries(list.map((t) => [t.name, t])) as Record<string, Tool>;
};

describe("tool list", () => {
  it("exposes the four tools with JSON Schema inputs", () => {
    const t = tools();
    expect(Object.keys(t)).toEqual(["get_schema", "describe_type", "run_query", "run_mutation"]);
    expect(inputSchemaOf(t.run_query)).toMatchObject({ type: "object", required: ["query"], properties: { query: { type: "string" } } });
  });
});

describe("get_schema and describe_type", () => {
  it("summarises root fields and described types, leaving out undescribed generated ones", async () => {
    const r = await tools().get_schema.handler({});
    expect(r.isError).toBeUndefined();
    expect(r.text).toContain("# Query fields");
    expect(r.text).toContain("movies(limit: Int): [Movie!]!");
    expect(r.text).toContain("type Movie   # A film.");
    expect(r.text).toContain("title: String!   # Title.");
    expect(r.text).not.toContain("type MoviesConnection");
    expect(r.text).toMatch(/describe_type/);
  });
  it("returns the whole schema on request", async () => {
    const r = await tools().get_schema.handler({ detail: "full" });
    expect(r.text).toContain("type MoviesConnection");
  });
  it("describes one type, and suggests names for an unknown one", async () => {
    const t = tools();
    expect((await t.describe_type.handler({ name: "Movie" })).text).toContain("type Movie");
    const bad = await t.describe_type.handler({ name: "Movi" });
    expect(bad.isError).toBe(true);
    expect(bad.text).toMatch(/Did you mean: Movie/);
  });
});

describe("run_query", () => {
  it("runs a query and returns JSON text", async () => {
    const r = await tools().run_query.handler({ query: "{ moviesConnection { totalCount } }" });
    expect(r).toEqual({ text: '{"data":{"moviesConnection":{"totalCount":2}}}', isError: false });
  });
  it("returns GraphQL errors as an error result the agent can read", async () => {
    const r = await tools().run_query.handler({ query: "{ movies { titel } }" });
    expect(r.isError).toBe(true);
    expect(r.text).toContain("Did you mean");
  });
  it("rejects mutations, subscriptions and syntax errors before sending anything", async () => {
    stub.requests.length = 0;
    const t = tools();
    expect((await t.run_query.handler({ query: "mutation { deleteMovies { nodesDeleted } }" })).text).toMatch(/Use run_mutation/);
    expect((await t.run_query.handler({ query: "subscription { x }" })).text).toMatch(/Subscriptions are not supported/);
    expect((await t.run_query.handler({ query: "{ movies { title }" })).text).toMatch(/syntax error/i);
    expect(stub.requests).toHaveLength(0);
  });
});

describe("run_mutation", () => {
  it("is disabled by default and explains how to enable it, without contacting the server", async () => {
    stub.requests.length = 0;
    const r = await tools().run_mutation.handler({ query: "mutation { deleteMovies(title: \"x\") { nodesDeleted } }" });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/ALLOW_MUTATIONS=true/);
    expect(stub.requests).toHaveLength(0);
  });
  it("runs when allowed, and still refuses queries", async () => {
    const t = tools({ ALLOW_MUTATIONS: "true" });
    const ok = await t.run_mutation.handler({ query: "mutation { deleteMovies(title: \"x\") { nodesDeleted } }" });
    expect(ok).toEqual({ text: '{"data":{"deleteMovies":{"nodesDeleted":0}}}', isError: false });
    const q = await t.run_mutation.handler({ query: "{ movies { title } }" });
    expect(q.text).toMatch(/Use run_query/);
  });
  it("sends configured headers, for example a token", async () => {
    stub.requests.length = 0;
    await tools({ GRAPHQL_HEADERS: '{"authorization":"Bearer abc"}' }).run_query.handler({ query: "{ moviesConnection { totalCount } }" });
    expect(stub.requests[0].headers.authorization).toBe("Bearer abc");
  });
});
