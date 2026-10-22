import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  it("defaults to the local server, read-only, with limits", () => {
    expect(loadConfig({})).toEqual({
      graphqlUrl: "http://localhost:4000/graphql", allowMutations: false, headers: {}, timeoutMs: 15000,
      maxResultBytes: 100000, maxDocumentBytes: 20000, port: 4100, host: "127.0.0.1",
    });
  });
  it("turns mutations on only for the exact word true", () => {
    expect(loadConfig({ ALLOW_MUTATIONS: "true" }).allowMutations).toBe(true);
    expect(loadConfig({ ALLOW_MUTATIONS: "TRUE" }).allowMutations).toBe(true);
    expect(loadConfig({ ALLOW_MUTATIONS: "yes" }).allowMutations).toBe(false);
  });
  it("parses extra headers as a JSON object of strings", () => {
    expect(loadConfig({ GRAPHQL_HEADERS: '{"authorization":"Bearer x"}' }).headers).toEqual({ authorization: "Bearer x" });
    expect(() => loadConfig({ GRAPHQL_HEADERS: "nope" })).toThrow(/GRAPHQL_HEADERS/);
    expect(() => loadConfig({ GRAPHQL_HEADERS: '{"a":1}' })).toThrow(/strings/);
    expect(() => loadConfig({ GRAPHQL_HEADERS: "[]" })).toThrow(/GRAPHQL_HEADERS/);
  });
  it("validates the URL and the numbers", () => {
    expect(() => loadConfig({ GRAPHQL_URL: "localhost:4000" })).toThrow(/http\(s\) URL/);
    expect(() => loadConfig({ TIMEOUT_MS: "0" })).toThrow(/TIMEOUT_MS/);
    expect(() => loadConfig({ MAX_RESULT_BYTES: "lots" })).toThrow(/MAX_RESULT_BYTES/);
    expect(loadConfig({ PORT: "5000", HOST: "0.0.0.0" })).toMatchObject({ port: 5000, host: "0.0.0.0" });
  });
});
