# Copyright (c) "Neo4j"
# Neo4j Sweden AB [http://neo4j.com]
# The MCP server over streamable HTTP (POST /mcp) as a container. For stdio, run src/stdio.ts on your machine instead.
FROM node:25-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json tsconfig.build.json ./
RUN npm ci
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:25-slim
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4100
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
USER node
EXPOSE 4100
HEALTHCHECK --interval=10s --timeout=3s --retries=5 CMD node -e "fetch('http://localhost:4100/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/http.js"]
