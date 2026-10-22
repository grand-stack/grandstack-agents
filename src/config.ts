// Copyright (c) "Neo4j"
// Neo4j Sweden AB [http://neo4j.com]
/** Settings for the tools and the MCP server, read from environment variables. */
export interface Config {
  graphqlUrl: string;
  allowMutations: boolean;
  /** Extra headers for every request, for example an Authorization header. See docs/adding-auth.md. */
  headers: Record<string, string>;
  timeoutMs: number;
  maxResultBytes: number;
  maxDocumentBytes: number;
  port: number;
  host: string;
}

type Env = Record<string, string | undefined>;

function positiveInt(env: Env, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`${name} must be a positive whole number, got "${raw}"`);
  return n;
}

export function loadConfig(env: Env = process.env): Config {
  const graphqlUrl = env.GRAPHQL_URL ?? "http://localhost:4000/graphql";
  if (!/^https?:\/\//.test(graphqlUrl)) throw new Error(`GRAPHQL_URL must be an http(s) URL, got "${graphqlUrl}"`);

  let headers: Record<string, string> = {};
  if (env.GRAPHQL_HEADERS) {
    let parsed: unknown;
    try { parsed = JSON.parse(env.GRAPHQL_HEADERS); } catch { throw new Error("GRAPHQL_HEADERS must be a JSON object, for example {\"authorization\":\"Bearer ...\"}"); }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed) || !Object.values(parsed).every((v) => typeof v === "string")) {
      throw new Error("GRAPHQL_HEADERS must be a JSON object whose values are strings");
    }
    headers = parsed as Record<string, string>;
  }

  return {
    graphqlUrl,
    allowMutations: (env.ALLOW_MUTATIONS ?? "false").toLowerCase() === "true",
    headers,
    timeoutMs: positiveInt(env, "TIMEOUT_MS", 15_000),
    maxResultBytes: positiveInt(env, "MAX_RESULT_BYTES", 100_000),
    maxDocumentBytes: positiveInt(env, "MAX_DOCUMENT_BYTES", 20_000),
    port: positiveInt(env, "PORT", 4100),
    host: env.HOST ?? "127.0.0.1",
  };
}
