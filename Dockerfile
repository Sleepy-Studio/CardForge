# syntax=docker/dockerfile:1.7
# CardForge production images. One Dockerfile, two targets:
#   docker build --target match-server -t cardforge-match-server .
#   docker build --target web          -t cardforge-web .

ARG NODE_IMAGE=node:22-bookworm-slim

FROM ${NODE_IMAGE} AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /app

# Manifests only, so dependency layers cache across source changes.
FROM base AS manifests
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
COPY apps/match-server/package.json apps/match-server/
COPY apps/simulator/package.json apps/simulator/
COPY packages/card-schema/package.json packages/card-schema/
COPY packages/competitive/package.json packages/competitive/
COPY packages/content-core-set/package.json packages/content-core-set/
COPY packages/content-tools/package.json packages/content-tools/
COPY packages/economy/package.json packages/economy/
COPY packages/live-ops/package.json packages/live-ops/
COPY packages/persistence/package.json packages/persistence/
COPY packages/rules-kernel/package.json packages/rules-kernel/
COPY packages/rules-tempofront/package.json packages/rules-tempofront/
COPY packages/theme-default/package.json packages/theme-default/
COPY packages/theme-test-scifi/package.json packages/theme-test-scifi/
COPY packages/training/package.json packages/training/

FROM manifests AS deps
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile

FROM deps AS build
COPY tsconfig.base.json tsconfig.json ./
COPY apps apps
COPY packages packages
RUN pnpm exec tsc -b && pnpm --filter @cardforge/web build

# Production-only dependencies for the match server and its workspace deps.
FROM manifests AS server-deps
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod --filter "@cardforge/match-server..."

FROM ${NODE_IMAGE} AS match-server
ENV NODE_ENV=production PORT=2567
WORKDIR /app
COPY --from=server-deps --chown=node:node /app ./
COPY --from=build --chown=node:node /app/packages ./packages-built
RUN set -e; for pkg in packages-built/*; do \
      name=$(basename "$pkg"); \
      [ -d "$pkg/dist" ] && cp -r "$pkg/dist" "packages/$name/dist"; \
      [ -d "$pkg/migrations" ] && cp -r "$pkg/migrations" "packages/$name/migrations"; \
    done; rm -rf packages-built; \
    find packages -name '*.test.*' -delete; find packages -name '*.tsbuildinfo' -delete
COPY --from=build --chown=node:node /app/apps/match-server/dist ./apps/match-server/dist
ARG CARDFORGE_VERSION=dev
ARG CARDFORGE_COMMIT=unknown
ENV CARDFORGE_VERSION=${CARDFORGE_VERSION} CARDFORGE_COMMIT=${CARDFORGE_COMMIT}
USER node
WORKDIR /app/apps/match-server
EXPOSE 2567
HEALTHCHECK --interval=15s --timeout=3s --start-period=30s --retries=4 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||2567)+'/ready').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "dist/index.js"]

FROM ${NODE_IMAGE} AS web
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
ARG CARDFORGE_VERSION=dev
ENV CARDFORGE_VERSION=${CARDFORGE_VERSION}
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=4 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "apps/web/server.js"]
