FROM node:24-alpine3.23 AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=secret,id=proxy_ca,required=false \
    if [ -s /run/secrets/proxy_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/proxy_ca; fi; \
    npm ci --omit=dev --no-audit --no-fund

FROM postgres:17-alpine3.23
WORKDIR /app
COPY --from=dependencies --chmod=0755 /usr/local/bin/node /usr/local/bin/node
COPY --from=dependencies --chown=postgres:postgres /app/node_modules ./node_modules
COPY --chown=postgres:postgres package.json ./
COPY --chown=postgres:postgres src ./src
COPY --chown=postgres:postgres public ./public
COPY --chown=postgres:postgres migrations ./migrations
COPY --chown=postgres:postgres scripts ./scripts
COPY --chown=postgres:postgres docker ./docker

ENV APP_MODE=demo \
    HOST=0.0.0.0 \
    PORT=3000 \
    PGDATA=/var/lib/postgresql/data \
    DATABASE_URL=postgresql://postgres@localhost/aurora?host=%2Fvar%2Frun%2Fpostgresql

EXPOSE 3000
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=10s --timeout=4s --start-period=45s \
    CMD ["node", "docker/healthcheck.js"]

ENTRYPOINT ["/bin/bash", "/app/docker/start.sh"]
