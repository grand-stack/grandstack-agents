import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { graphqlTool, runAgent, systemPrompt, type Block, type ModelAdapter } from "../src/agent.js";
import { loadConfig } from "../src/config.js";
import { startStub, type Stub } from "./stub-server.js";

let stub: Stub;
beforeAll(async () => { stub = await startStub(); });
afterAll(async () => { await stub.close(); });

/** A model that plays back a script: each entry is the content of one assistant turn. */
function scripted(turns: Block[][]): ModelAdapter & { seen: { messages: number; tools: string[]; system: string }[] } {
  let i = 0;
  const seen: { messages: number; tools: string[]; system: string }[] = [];
  return {
    seen,
    async next({ system, messages, tools }) {
      seen.push({ messages: messages.length, tools: tools.map((t) => t.name), system });
      const content = turns[i++];
      if (!content) throw new Error("script ran out");
      return { content };
    },
  };
}

const use = (id: string, query: string): Block => ({ type: "tool_use", id, name: "graphql", input: { query } });
const config = (env: Record<string, string> = {}) => loadConfig({ GRAPHQL_URL: stub.url, ...env });

describe("agent loop", () => {
  it("runs a tool call, feeds the result back, and returns the model's answer", async () => {
    const model = scripted([
      [{ type: "text", text: "Let me check." }, use("t1", "{ moviesConnection { totalCount } }")],
      [{ type: "text", text: "There are 2 movies." }],
    ]);
    const calls: string[] = [];
    const r = await runAgent({ question: "How many movies?", adapter: model, tools: [graphqlTool(config())], system: "s", onToolCall: (c) => calls.push(c.result.content) });
    expect(r.answer).toBe("There are 2 movies.");
    expect(r).toMatchObject({ steps: 2, toolCalls: 1 });
    expect(calls[0]).toBe('{"data":{"moviesConnection":{"totalCount":2}}}');
    const toolResult = r.messages[2].content[0];
    expect(toolResult).toMatchObject({ type: "tool_result", tool_use_id: "t1", content: '{"data":{"moviesConnection":{"totalCount":2}}}' });
    expect(model.seen[0].tools).toEqual(["graphql"]);
    expect(model.seen[1].messages).toBe(3);
  });

  it("lets the model recover from a GraphQL error", async () => {
    const model = scripted([[use("a", "{ movies { titel } }")], [use("b", "{ movies { title } }")], [{ type: "text", text: "done" }]]);
    const results: { is_error?: boolean }[] = [];
    const r = await runAgent({ question: "q", adapter: model, tools: [graphqlTool(config())], system: "s", onToolCall: (c) => results.push(c.result) });
    expect(results.map((x) => x.is_error)).toEqual([true, false]);
    expect(r.answer).toBe("done");
  });

  it("refuses mutations unless they are allowed, and still reports back to the model", async () => {
    const mutation = "mutation { deleteMovies(title: \"x\") { nodesDeleted } }";
    const readOnly = await graphqlTool(config()).run({ query: mutation });
    expect(readOnly).toMatchObject({ is_error: true });
    expect(readOnly.content).toMatch(/read-only|disabled/i);
    const allowed = await graphqlTool(config({ ALLOW_MUTATIONS: "true" })).run({ query: mutation });
    expect(allowed).toMatchObject({ content: '{"data":{"deleteMovies":{"nodesDeleted":0}}}', is_error: false });
  });

  it("rejects subscriptions, syntax errors and unknown tools without crashing", async () => {
    const tool = graphqlTool(config());
    expect((await tool.run({ query: "subscription { x }" })).is_error).toBe(true);
    expect((await tool.run({ query: "{ nope" })).content).toMatch(/syntax error/i);
    const model = scripted([[{ type: "tool_use", id: "z", name: "nope", input: {} }], [{ type: "text", text: "ok" }]]);
    const r = await runAgent({ question: "q", adapter: model, tools: [tool], system: "s" });
    expect(r.messages[2].content[0]).toMatchObject({ is_error: true, content: 'Unknown tool "nope".' });
  });

  it("stops after maxSteps instead of looping forever", async () => {
    const endless = scripted(Array.from({ length: 5 }, (_, i) => [use(`t${i}`, "{ moviesConnection { totalCount } }")]));
    await expect(runAgent({ question: "q", adapter: endless, tools: [graphqlTool(config())], system: "s", maxSteps: 3 })).rejects.toThrow(/did not finish within 3 steps/);
  });

  it("builds a system prompt that contains the schema summary", async () => {
    const prompt = await systemPrompt(config());
    expect(prompt).toContain("type Movie   # A film.");
    expect(prompt).toMatch(/totalCount/);
  });
});
