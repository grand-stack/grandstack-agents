// A small, readable agent loop. It has no MCP in it: the model asks to call a tool, the loop runs it, the result goes
// back, until the model answers in plain text. The model itself is behind a ModelAdapter, so any provider can be used.
import { z } from "zod";
import type { Config } from "./config.js";
import { InputError, classify, createExecutor, type Executor, type HeadersSource } from "./graphql.js";
import { loadSchema, summarize } from "./schema-tools.js";

/** Message blocks use the Anthropic content-block shape. An adapter for another provider translates to and from it. */
export type Block =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean };
export interface Message { role: "user" | "assistant"; content: Block[] }

export interface ToolSpec { name: string; description: string; input_schema: Record<string, unknown> }
export interface ModelTurn { content: Block[] }
export interface ModelAdapter {
  next(input: { system: string; messages: Message[]; tools: ToolSpec[] }): Promise<ModelTurn>;
}

export interface AgentTool extends ToolSpec {
  run(input: Record<string, unknown>): Promise<{ content: string; is_error?: boolean }>;
}

/**
 * The one tool of the direct approach: send any GraphQL statement to the server. Same guardrails as the MCP tools
 * (parse first, one operation, no subscriptions, mutations only when allowed), without MCP in between.
 */
export function graphqlTool(config: Config, headers?: HeadersSource, executor?: Executor): AgentTool {
  const execute = executor ?? createExecutor({ url: config.graphqlUrl, headers: headers ?? config.headers, timeoutMs: config.timeoutMs, maxResultBytes: config.maxResultBytes });
  return {
    name: "graphql",
    description: "Send a GraphQL query" + (config.allowMutations ? " or mutation" : " (read-only: mutations are refused)") + " to the API and get the JSON result. GraphQL errors are returned as text: read them, fix the statement, try again.",
    input_schema: z.toJSONSchema(z.object({
      query: z.string().describe("The GraphQL document."),
      variables: z.record(z.string(), z.unknown()).optional().describe("Variables as a JSON object."),
    })) as Record<string, unknown>,
    async run(input) {
      try {
        const query = String(input.query ?? "");
        const op = classify(query, undefined, config.maxDocumentBytes);
        if (op.kind === "subscription") throw new InputError("Subscriptions are not supported.");
        if (op.kind === "mutation" && !config.allowMutations) throw new InputError("Mutations are disabled (read-only). Start the agent with ALLOW_MUTATIONS=true to allow them.");
        const result = await execute({ query, variables: input.variables as Record<string, unknown> | undefined });
        return { content: result.text, is_error: !result.ok };
      } catch (error) {
        return { content: error instanceof Error ? error.message : String(error), is_error: true };
      }
    },
  };
}

/** The system prompt for the direct approach: how to work, plus a summary of the schema so no tool call is spent on it. */
export async function systemPrompt(config: Config, headers?: HeadersSource, executor?: Executor): Promise<string> {
  const execute = executor ?? createExecutor({ url: config.graphqlUrl, headers: headers ?? config.headers, timeoutMs: config.timeoutMs, maxResultBytes: config.maxResultBytes });
  const schema = summarize(await loadSchema(execute));
  return [
    "You answer questions about the data behind a GraphQL API by writing and running GraphQL statements with the graphql tool.",
    "Prefer one precise query over many small ones. Use the totalCount of ...Connection fields for counts. If a statement fails, read the error and correct it.",
    "Answer in plain language and say which numbers came from the API.",
    "",
    "The API (summary; generated filter, sort and input types are not listed, but you can run an introspection query such as { __type(name: \"MovieWhere\") { inputFields { name type { name kind ofType { name } } } } }):",
    schema,
  ].join("\n");
}

export interface RunOptions {
  question: string;
  adapter: ModelAdapter;
  tools: AgentTool[];
  system: string;
  maxSteps?: number;
  /** Called for every tool call, for logging. */
  onToolCall?: (call: { name: string; input: Record<string, unknown>; result: { content: string; is_error?: boolean } }) => void;
}

export interface RunResult { answer: string; steps: number; toolCalls: number; messages: Message[] }

export async function runAgent({ question, adapter, tools, system, maxSteps = 8, onToolCall }: RunOptions): Promise<RunResult> {
  const messages: Message[] = [{ role: "user", content: [{ type: "text", text: question }] }];
  const specs: ToolSpec[] = tools.map(({ name, description, input_schema }) => ({ name, description, input_schema }));
  let toolCalls = 0;
  for (let step = 1; step <= maxSteps; step++) {
    const turn = await adapter.next({ system, messages, tools: specs });
    messages.push({ role: "assistant", content: turn.content });
    const uses = turn.content.filter((b): b is Extract<Block, { type: "tool_use" }> => b.type === "tool_use");
    if (uses.length === 0) {
      const answer = turn.content.filter((b): b is Extract<Block, { type: "text" }> => b.type === "text").map((b) => b.text).join("\n").trim();
      return { answer, steps: step, toolCalls, messages };
    }
    const results: Block[] = [];
    for (const use of uses) {
      const tool = tools.find((t) => t.name === use.name);
      const result = tool ? await tool.run(use.input) : { content: `Unknown tool "${use.name}".`, is_error: true };
      toolCalls++;
      onToolCall?.({ name: use.name, input: use.input, result });
      results.push({ type: "tool_result", tool_use_id: use.id, content: result.content, is_error: result.is_error });
    }
    messages.push({ role: "user", content: results });
  }
  throw new Error(`The agent did not finish within ${maxSteps} steps.`);
}
