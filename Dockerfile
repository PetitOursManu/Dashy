# syntax=docker/dockerfile:1

# ----------------------------------------------------------------------------
# Stage 1 — build the client (Vite → server/public) and compile the server.
# Uses the full node image so native modules (argon2) build/prebuild reliably.
# ----------------------------------------------------------------------------
FROM node:20-bookworm AS builder
WORKDIR /app

# Skip mongodb-memory-server's binary download (dev-only, pruned for prod).
ENV MONGOMS_DISABLE_POSTINSTALL=1

# Install dependencies first (better layer caching).
COPY server/package*.json ./server/
COPY client/package*.json ./client/
RUN npm ci --prefix server && npm ci --prefix client

# Copy sources and build.
COPY server ./server
COPY client ./client
RUN npm run build --prefix client \
  && npm run build --prefix server \
  && npm prune --omit=dev --prefix server

# ----------------------------------------------------------------------------
# Stage 2 — slim runtime image with only production artifacts.
# ----------------------------------------------------------------------------
FROM node:20-bookworm-slim AS runtime
ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/data
WORKDIR /app/server

# Docker CLI + compose plugin, so the Store's "direct Docker" deploy driver can
# run `docker compose` WHEN the host's Docker socket is mounted into this
# container (see docker-compose.yml). Harmless if the socket is never mounted —
# the driver simply reports itself unavailable.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl gnupg \
  && install -m 0755 -d /etc/apt/keyrings \
  && curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc \
  && chmod a+r /etc/apt/keyrings/docker.asc \
  && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian bookworm stable" \
     > /etc/apt/sources.list.d/docker.list \
  && apt-get update \
  && apt-get install -y --no-install-recommends docker-ce-cli docker-compose-plugin gosu passwd \
  && rm -rf /var/lib/apt/lists/*

# Production node_modules + compiled server + built client.
COPY --from=builder /app/server/node_modules ./node_modules
COPY --from=builder /app/server/dist ./dist
COPY --from=builder /app/server/public ./public
COPY --from=builder /app/server/package.json ./package.json

# Persistent data directory (hosted apps + previews), owned by the runtime user.
RUN mkdir -p /data && chown -R node:node /app /data

# Entrypoint starts as root only to align the node user with the Docker socket
# group (when mounted), then drops to `node` via gosu to run the server.
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 3000
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "dist/index.js"]
