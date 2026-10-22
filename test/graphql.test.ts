import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { InputError, classify, createExecutor } from "../src/graphql.js";
import { startStub, type Stub } from "./stub-server.js";

describe("classify", () => {
  it("identifies queries, mutations and subscriptions, including shorthand queries", () => {
    expect(classify("{ movies { title } }").kind).toBe("query");
    expect(classify("query Q { movies { title } }")).toEqual({ kind: "query", name: "Q" });
    expect(classify("mutation M { deleteMovies { nodesDeleted } }")).toEqual({ kind: "mutation", name: "M" });
    expect(classify("subscription S { x }").kind).toBe("subscription");
  });
  it("reports syntax errors with the position, so the agent can fix them", () => {
    expect(() => classify("{ movies { title }")).toThrow(/syntax error \(line 1, column \d+\)/i);
  });
  it("rejects a document with no operation", () => {
    expect(() => classify("fragment F on Movie { title }")).toThrow(/no operation/i);
  });
  it("needs operationName when there are several operations, and checks it exists", () => {
    const doc = "query A { a } mutation B { b }";
    expect(() => classify(doc)).toThrow(/2 operations \(A, B\)/);
    expect(classify(doc, "B").kind).toBe("mutation");
    expect(() => classify(doc, "C")).toThrow(/No operation named "C"/);
  });
  it("refuses documents over the size limit", () => {
    expect(() => classify("{ " + "a ".repeat(100) + "}", undefined, 50)).toThrow(InputError);
  });
});

describe("executor", () => {
  let stub: Stub;
  beforeAll(async () => { stub = await startStub(); });
  afterAll(async () => { await stub.close(); });

  it("returns data as compact JSON", async () => {
    const run = createExecutor({ url: stub.url });
    const r = await run({ query: "{ moviesConnection { totalCount } }" });
    expect(r).toMatchObject({ ok: true, status: 200, truncated: false });
    expect(r.text).toBe('{"data":{"moviesConnection":{"totalCount":2}}}');
  });
  it("passes variables and operationName through", async () => {
    const run = createExecutor({ url: stub.url });
    const r = await run({ query: "query Q($n: Int) { movies(limit: $n) { title } }", variables: { n: 1 }, operationName: "Q" });
    expect((r.data as { movies: unknown[] }).movies).toHaveLength(1);
  });
  it("marks GraphQL errors as not ok but still returns them as text", async () => {
    const run = createExecutor({ url: stub.url });
    const r = await run({ query: "{ movies { titel } }" });
    expect(r.ok).toBe(false);
    expect(r.text).toMatch(/Did you mean/);
  });
  it("cuts oversized results and says so", async () => {
    const run = createExecutor({ url: stub.url, maxResultBytes: 2000 });
    const r = await run({ query: "{ big }" });
    expect(r.truncated).toBe(true);
    expect(r.text).toMatch(/\[truncated: the result was \d+ bytes and the limit is 2000/);
    expect(Buffer.byteLength(r.text)).toBeLessThan(2400);
  });
  it("times out slow requests with a readable message", async () => {
    const run = createExecutor({ url: stub.url, timeoutMs: 200 });
    const r = await run({ query: "{ slow }" });
    expect(r.ok).toBe(false);
    expect(r.text).toMatch(/took longer than 200 ms/);
  });
  it("reports an unreachable server instead of throwing", async () => {
    const run = createExecutor({ url: "http://127.0.0.1:1/graphql", timeoutMs: 1000 });
    const r = await run({ query: "{ x }" });
    expect(r).toMatchObject({ ok: false, status: 0 });
    expect(r.text).toMatch(/could not reach/);
  });
  it("sends static headers, and calls a header function before every request", async () => {
    stub.requests.length = 0;
    await createExecutor({ url: stub.url, headers: { authorization: "Bearer one" } })({ query: "{ moviesConnection { totalCount } }" });
    let n = 0;
    const run = createExecutor({ url: stub.url, headers: async () => ({ authorization: `Bearer t${++n}` }) });
    await run({ query: "{ moviesConnection { totalCount } }" });
    await run({ query: "{ moviesConnection { totalCount } }" });
    expect(stub.requests.map((r) => r.headers.authorization)).toEqual(["Bearer one", "Bearer t1", "Bearer t2"]);
  });
  it("handles a non-JSON error response", async () => {
    const fake = async () => new Response("<html>Bad gateway</html>", { status: 502 });
    const r = await createExecutor({ url: "http://x", fetch: fake as unknown as typeof fetch })({ query: "{ x }" });
    expect(r).toMatchObject({ ok: false, status: 502 });
    expect(r.errors?.[0].message).toMatch(/HTTP 502/);
  });
});
