// Copyright (c) "Neo4j"
// Neo4j Sweden AB [http://neo4j.com]
import { z } from "zod";
import type { Config } from "./config.js";
import { InputError, classify, createExecutor, type Executor, type HeadersSource } from "./graphql.js";
import { describeType, fullSchema, loadSchema, summarize } from "./schema-tools.js";

export interface ToolResult {
  text: string;
  isError?: boolean;
}

export interface Tool {
  name: string;
  description: string;
  /** A zod object shape; MCP uses it directly, the agent script converts it to JSON Schema. */
  inputShape: Record<string, z.ZodType>;
  handler: (args: Record<string, unknown>) => Promise<ToolResult>;
}

export interface ToolOptions {
  config: Config;
  /** Overrides the headers (for example a token provider). Defaults to config.headers. */
  headers?: HeadersSource;
  /** For tests. */
  executor?: Executor;
}

const statementShape = {
  query: z.string().describe("The GraphQL document, as text."),
  variables: z.record(z.string(), z.unknown()).optional().describe("Variables for the document, as a JSON object."),
  operationName: z.string().optional().describe("Which operation to run when the document contains several."),
};

export const SERVER_INSTRUCTIONS =
  "Work with a GraphQL API. Start with get_schema to see the root fields and the types the API defines. " +
  "Use describe_type for the exact shape of one type or input (for example a filter such as MovieWhere). " +
  "Read data with run_query. run_mutation changes data and is off unless the server was started with ALLOW_MUTATIONS=true. " +
  "Errors come back as text: read them and correct the statement.";

export function createTools({ config, headers, executor }: ToolOptions): Tool[] {
  const execute = executor ?? createExecutor({ url: config.graphqlUrl, headers: headers ?? config.headers, timeoutMs: config.timeoutMs, maxResultBytes: config.maxResultBytes });
  let schemaCache: ReturnType<typeof loadSchema> | undefined;
  const schema = () => (schemaCache ??= loadSchema(execute).catch((error) => { schemaCache = undefined; throw error; }));

  const guard = async (fn: () => Promise<ToolResult>): Promise<ToolResult> => {
    try { return await fn(); }
    catch (error) {
      if (error instanceof InputError) return { text: error.message, isError: true };
      return { text: error instanceof Error ? error.message : String(error), isError: true };
    }
  };

  async function run(args: Record<string, unknown>, lane: "query" | "mutation"): Promise<ToolResult> {
    const { query, variables, operationName } = args as { query: string; variables?: Record<string, unknown>; operationName?: string };
    const op = classify(query, operationName, config.maxDocumentBytes);
    if (op.kind === "subscription") throw new InputError("Subscriptions are not supported. Use run_query or run_mutation.");
    if (lane === "query" && op.kind === "mutation") throw new InputError("This is a mutation. Use run_mutation (it is available only when the server runs with ALLOW_MUTATIONS=true).");
    if (lane === "mutation" && op.kind === "query") throw new InputError("This is a query. Use run_query.");
    if (lane === "mutation" && !config.allowMutations) {
      throw new InputError("Mutations are disabled. This server is read-only by default: start it with ALLOW_MUTATIONS=true to let an agent change data. See docs/guardrails.md.");
    }
    const result = await execute({ query, variables, operationName });
    return { text: result.text, isError: !result.ok };
  }

  return [
    {
      name: "get_schema",
      description: "Summary of the GraphQL API: root query and mutation fields with their arguments, and the object types the schema defines with their fields and descriptions. Generated filter, sort and input types are left out; use describe_type for those. detail \"full\" returns the whole schema (can be very large).",
      inputShape: { detail: z.enum(["summary", "full"]).optional().describe("summary (default) or full") },
      handler: (args) => guard(async () => ({ text: (args.detail === "full" ? fullSchema : summarize)(await schema()) })),
    },
    {
      name: "describe_type",
      description: "The definition of one GraphQL type, input or enum, with descriptions. Use it to learn exact shapes, for example MovieWhere (filters), MovieSort, MovieCreateInput or MovieUpdateInput.",
      inputShape: { name: z.string().describe("The type name, for example MovieWhere.") },
      handler: (args) => guard(async () => ({ text: describeType(await schema(), String(args.name)) })),
    },
    {
      name: "run_query",
      description: "Run a GraphQL query and return the JSON result. Only queries are accepted. GraphQL errors are returned as text so you can fix the statement and try again.",
      inputShape: statementShape,
      handler: (args) => guard(() => run(args, "query")),
    },
    {
      name: "run_mutation",
      description: "Run a GraphQL mutation (create, update or delete) and return the JSON result. Disabled unless the server was started with ALLOW_MUTATIONS=true. Only mutations are accepted.",
      inputShape: statementShape,
      handler: (args) => guard(() => run(args, "mutation")),
    },
  ];
}

/** JSON Schema for a tool's input, for model APIs that want it (for example the Anthropic Messages API). */
export function inputSchemaOf(tool: Tool): Record<string, unknown> {
  return z.toJSONSchema(z.object(tool.inputShape)) as Record<string, unknown>;
}
