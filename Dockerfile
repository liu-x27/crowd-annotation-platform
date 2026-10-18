# syntax=docker/dockerfile:1
#
#   docker build -t crowd-annotation .
#   docker run -p 4000:4000 -v crowd-data:/data crowd-annotation
#
# One process serves the API and the web app on $PORT. Data lives in the /data volume
# (embedded Postgres and trained models) unless DATABASE_URL points at a Postgres server.
# Built with --build-arg DEMO_MODE=true, the image also carries a seeded demo database
# that a DEMO_MODE instance starts from; see docs/DEPLOY.md.

ARG NODE_IMAGE=node:24-slim

# ── build: every dependency, then the web app and the server bundles ──────────────────
FROM ${NODE_IMAGE} AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

# ── deps: the server's production dependencies, nothing else ──────────────────────────
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN npm ci --omit=dev --workspace @crowd/server --no-audit --no-fund

# ── demo: a seeded demo database, only when built with DEMO_MODE=true ─────────────────
FROM build AS demo
ARG DEMO_MODE=false
RUN mkdir -p /demo \
 && if [ "$DEMO_MODE" = "true" ]; then \
      DATA_DIR=/demo node apps/server/dist/seed-demo.js --llm mock \
      && date +%s > /demo/built-at; \
    fi

# ── runtime ───────────────────────────────────────────────────────────────────────────
FROM ${NODE_IMAGE}
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4000 DATA_DIR=/data
WORKDIR /app
COPY --from=deps /app/node_modules node_modules
COPY --from=build /app/package.json ./
COPY --from=build /app/apps/server/package.json apps/server/
COPY --from=build /app/apps/server/dist apps/server/dist
COPY --from=build /app/apps/server/drizzle apps/server/drizzle
COPY --from=build /app/apps/web/dist apps/web/dist
COPY --from=demo --chown=node:node /demo demo
COPY docker-entrypoint.sh /usr/local/bin/
RUN mkdir /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 4000
HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + process.env.PORT + '/api/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
ENTRYPOINT ["sh", "/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "apps/server/dist/index.js"]
