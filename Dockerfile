# syntax=docker/dockerfile:1

ARG NODE_VERSION=22

FROM node:${NODE_VERSION}-alpine AS build
WORKDIR /repo

COPY . .
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund

# Public build-time variables baked into the SPA (never put secrets here).
ARG VITE_UMAMI_WEBSITE_ID=""
ARG VITE_UMAMI_SRC="https://cloud.umami.is/script.js"
ARG VITE_SITE_URL=""
ENV VITE_UMAMI_WEBSITE_ID=${VITE_UMAMI_WEBSITE_ID} \
    VITE_UMAMI_SRC=${VITE_UMAMI_SRC} \
    VITE_SITE_URL=${VITE_SITE_URL}

RUN npm run build
# The image must build without datasets; they can be mounted at /app/data instead.
RUN mkdir -p data/processed

FROM node:${NODE_VERSION}-alpine AS dev
RUN apk add --no-cache tini
WORKDIR /repo
# Pre-creating node_modules gives the named volume mounted there node ownership.
RUN mkdir -p node_modules && chown -R node:node /repo
USER node
ENV NODE_ENV=development
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["npm", "run", "dev"]

FROM node:${NODE_VERSION}-alpine AS runtime
RUN apk add --no-cache tini
WORKDIR /app

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080 \
    DATA_DIR=/app/data \
    WEB_DIR=/app/web \
    LOG_LEVEL=info

COPY --from=build --chown=node:node /repo/apps/api/dist/server.mjs ./server.mjs
COPY --from=build --chown=node:node /repo/apps/web/dist ./web
COPY --from=build --chown=node:node /repo/data/processed ./data

USER node
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=15s --retries=3 \
  CMD wget -q -O /dev/null "http://127.0.0.1:${PORT}/healthz" || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server.mjs"]
