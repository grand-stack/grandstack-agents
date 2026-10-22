// Copyright (c) "Neo4j"
// Neo4j Sweden AB [http://neo4j.com]
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { buildSchema, graphql } from "graphql";

const schema = buildSchema(`
  """A film."""
  type Movie { """Title.""" title: String! """Year.""" released: Int }
  type MoviesConnection { totalCount: Int! }
  """The root query."""
  type Query {
    movies(limit: Int): [Movie!]!
    moviesConnection: MoviesConnection!
    big: [String!]!
    slow: String
  }
  type DeleteInfo { nodesDeleted: Int! }
  type Mutation { deleteMovies(title: String): DeleteInfo! }
`);

const movies = [{ title: "The Matrix", released: 1999 }, { title: "Inception", released: 2010 }];

export interface Stub {
  url: string;
  requests: { headers: Record<string, string | string[] | undefined>; body: { query: string; variables?: unknown } }[];
  close: () => Promise<void>;
}

export async function startStub(): Promise<Stub> {
  const requests: Stub["requests"] = [];
  const server: Server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    requests.push({ headers: req.headers, body });
    const result = await graphql({
      schema,
      source: body.query,
      variableValues: body.variables,
      operationName: body.operationName,
      rootValue: {
        movies: ({ limit }: { limit?: number }) => movies.slice(0, limit ?? movies.length),
        moviesConnection: () => ({ totalCount: movies.length }),
        big: () => Array.from({ length: 5000 }, (_, i) => `row-${i}-${"x".repeat(40)}`),
        slow: () => new Promise((r) => setTimeout(() => r("done"), 1500)),
        deleteMovies: () => ({ nodesDeleted: 0 }),
      },
    });
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(result));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}/graphql`, requests, close: () => new Promise((r) => { server.closeAllConnections(); server.close(() => r()); }) };
}
