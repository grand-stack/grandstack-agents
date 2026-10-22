# Copyright (c) "Neo4j"
# Neo4j Sweden AB [http://neo4j.com]
# The MCP server over streamable HTTP (POST /mcp) as a container. For stdio, run src/stdio.ts on your machine instead.
FROM node:24.22.1-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205 AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json tsconfig.build.json ./
RUN npm ci
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:24.22.1-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4100
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
USER node
EXPOSE 4100
HEALTHCHECK --interval=10s --timeout=3s --retries=5 CMD node -e "fetch('http://localhost:4100/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/http.js"]
