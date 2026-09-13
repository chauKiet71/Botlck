# syntax=docker/dockerfile:1

FROM node:24-bookworm-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

COPY tsconfig.json index.ts openclaw.plugin.json ./
COPY src ./src
COPY test ./test
RUN npm run build

FROM node:24-bookworm-slim AS runtime

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates tini \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY openclaw.plugin.json README.md ./
COPY workspace ./workspace
COPY scripts ./scripts

ENV NODE_ENV=production \
    OPENCLAW_GATEWAY_PORT=8080 \
    OPENCLAW_STATE_DIR=/data/.openclaw \
    OPENCLAW_WORKSPACE_DIR=/data/workspace \
    OPENCLAW_DISABLE_BONJOUR=1

RUN mkdir -p /data/.openclaw /data/workspace \
    && chown -R node:node /data

USER node

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "const p=process.env.OPENCLAW_GATEWAY_PORT||process.env.PORT||'8080';fetch('http://127.0.0.1:'+p+'/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

ENTRYPOINT ["tini", "--"]
CMD ["node", "scripts/start-railway.mjs"]
