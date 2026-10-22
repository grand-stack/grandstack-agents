import { buildClientSchema, getIntrospectionQuery, isObjectType, printSchema, printType, type GraphQLField, type GraphQLObjectType, type GraphQLSchema, type IntrospectionQuery } from "graphql";
import type { Executor } from "./graphql.js";

/** Loads the schema of any GraphQL server by introspection. */
export async function loadSchema(execute: Executor): Promise<GraphQLSchema> {
  const result = await execute({ query: getIntrospectionQuery({ descriptions: true }) });
  if (!result.data) throw new Error(`Could not read the schema: ${result.errors?.[0]?.message ?? `HTTP ${result.status}`}`);
  return buildClientSchema(result.data as IntrospectionQuery);
}

const GENERATED = /(Connection|Edge|Info|Response|PageInfo|Aggregate\w*)$/;

function signature(field: GraphQLField<unknown, unknown>): string {
  const args = field.args.map((a) => `${a.name}: ${a.type}`).join(", ");
  const note = field.description ? `   # ${field.description.replace(/\s+/g, " ").trim()}` : "";
  return `${field.name}${args ? `(${args})` : ""}: ${field.type}${note}`;
}

/**
 * A summary small enough to read in one go: the root fields with their arguments, and the object types the schema's
 * author described (generated filter, sort, input and connection types are left out; describe them one at a time).
 */
export function summarize(schema: GraphQLSchema): string {
  const out: string[] = [];
  const roots = [["Query", schema.getQueryType()], ["Mutation", schema.getMutationType()]] as const;
  for (const [label, type] of roots) {
    if (!type) continue;
    out.push(`# ${label} fields`);
    for (const f of Object.values(type.getFields())) out.push(`  ${signature(f)}`);
    out.push("");
  }
  const rootNames = new Set([schema.getQueryType()?.name, schema.getMutationType()?.name, schema.getSubscriptionType()?.name]);
  const objects = Object.values(schema.getTypeMap()).filter((t): t is GraphQLObjectType => isObjectType(t) && !t.name.startsWith("__") && !rootNames.has(t.name));
  const described = objects.filter((t) => t.description && !GENERATED.test(t.name));
  const shown = described.length > 0 ? described : objects.filter((t) => !GENERATED.test(t.name)).slice(0, 40);
  out.push("# Types");
  for (const t of shown) {
    out.push(`type ${t.name}${t.description ? `   # ${t.description.replace(/\s+/g, " ").trim()}` : ""}`);
    for (const f of Object.values(t.getFields())) out.push(`  ${signature(f)}`);
    out.push("");
  }
  out.push("Generated input types (filters, sort, create and update inputs) are not listed here. Use describe_type with a name such as MovieWhere or MovieCreateInput.");
  return out.join("\n");
}

export function describeType(schema: GraphQLSchema, name: string): string {
  const type = schema.getType(name);
  if (!type) {
    const lower = name.toLowerCase();
    const names = Object.keys(schema.getTypeMap()).filter((n) => !n.startsWith("__"));
    // names that start with the text first, then names that contain it, shorter (more basic) names first
    const rank = (n: string) => (n.toLowerCase().startsWith(lower) ? 0 : 1);
    const similar = names.filter((n) => n.toLowerCase().includes(lower)).sort((a, b) => rank(a) - rank(b) || a.length - b.length || a.localeCompare(b)).slice(0, 8);
    throw new Error(`No type named "${name}".${similar.length ? ` Did you mean: ${similar.join(", ")}?` : " Call get_schema to see the types."}`);
  }
  return printType(type);
}

export const fullSchema = (schema: GraphQLSchema): string => printSchema(schema);
