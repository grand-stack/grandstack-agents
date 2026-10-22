import { GraphQLError, Kind, parse, type OperationDefinitionNode } from "graphql";

export type OperationKind = "query" | "mutation" | "subscription";

/** A mistake in what the agent sent. The message is written for the agent, so it can correct itself. */
export class InputError extends Error {}

export interface Classified {
  kind: OperationKind;
  /** The operation that will run (its name, or undefined for an anonymous one). */
  name?: string;
}

/** Parses a GraphQL document and says which single operation would run. Rejects anything ambiguous or malformed. */
export function classify(document: string, operationName?: string, maxBytes = 20_000): Classified {
  if (Buffer.byteLength(document) > maxBytes) throw new InputError(`The document is larger than ${maxBytes} bytes. Send a smaller statement.`);
  let ast;
  try {
    ast = parse(document);
  } catch (error) {
    if (error instanceof GraphQLError) {
      const where = error.locations?.[0] ? ` (line ${error.locations[0].line}, column ${error.locations[0].column})` : "";
      throw new InputError(`GraphQL syntax error${where}: ${error.message}`);
    }
    throw error;
  }
  const operations = ast.definitions.filter((d): d is OperationDefinitionNode => d.kind === Kind.OPERATION_DEFINITION);
  if (operations.length === 0) throw new InputError("The document contains no operation. Send a query or a mutation.");
  let op: OperationDefinitionNode | undefined;
  if (operationName) {
    op = operations.find((o) => o.name?.value === operationName);
    if (!op) throw new InputError(`No operation named "${operationName}". Operations in the document: ${operations.map((o) => o.name?.value ?? "(anonymous)").join(", ")}.`);
  } else if (operations.length === 1) {
    op = operations[0];
  } else {
    throw new InputError(`The document has ${operations.length} operations (${operations.map((o) => o.name?.value ?? "(anonymous)").join(", ")}). Send one, or pass operationName.`);
  }
  return { kind: op.operation, name: op.name?.value };
}

export type HeadersSource = Record<string, string> | (() => Record<string, string> | Promise<Record<string, string>>);

export interface ExecutorOptions {
  url: string;
  /** Static headers, or a function called before every request (for tokens that expire). */
  headers?: HeadersSource;
  timeoutMs?: number;
  maxResultBytes?: number;
  fetch?: typeof fetch;
}

export interface ExecutionResult {
  /** True for an HTTP 2xx response with no GraphQL errors. */
  ok: boolean;
  status: number;
  data?: unknown;
  errors?: { message: string; path?: unknown[]; extensions?: unknown }[];
  /** The response as compact JSON text, cut at maxResultBytes. */
  text: string;
  truncated: boolean;
}

export type Executor = (request: { query: string; variables?: Record<string, unknown>; operationName?: string }) => Promise<ExecutionResult>;

export function createExecutor(options: ExecutorOptions): Executor {
  const doFetch = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? 15_000;
  const maxBytes = options.maxResultBytes ?? 100_000;

  return async ({ query, variables, operationName }) => {
    const extra = typeof options.headers === "function" ? await options.headers() : (options.headers ?? {});
    let response: Response;
    try {
      response = await doFetch(options.url, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json", ...extra },
        body: JSON.stringify({ query, variables, operationName }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
      const reason = timedOut ? `the request took longer than ${timeoutMs} ms` : `could not reach ${options.url} (${(error as Error).message})`;
      return { ok: false, status: 0, errors: [{ message: `GraphQL request failed: ${reason}` }], text: `GraphQL request failed: ${reason}`, truncated: false };
    }

    const raw = await response.text();
    let body: { data?: unknown; errors?: ExecutionResult["errors"] } | undefined;
    try { body = JSON.parse(raw); } catch { /* not JSON */ }

    let text = body ? JSON.stringify(body) : raw;
    let truncated = false;
    if (Buffer.byteLength(text) > maxBytes) {
      const total = Buffer.byteLength(text);
      text = `${Buffer.from(text).subarray(0, maxBytes).toString("utf8")}\n[truncated: the result was ${total} bytes and the limit is ${maxBytes}. Ask for fewer fields or rows (limit, where) and try again.]`;
      truncated = true;
    }
    const errors = body?.errors ?? (body ? undefined : [{ message: `HTTP ${response.status}: ${raw.slice(0, 300)}` }]);
    return { ok: response.ok && !body?.errors?.length && !!body, status: response.status, data: body?.data, errors, text, truncated };
  };
}
