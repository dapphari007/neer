# ──────────────────────────────────────────────────────────────────────────────
# Neer API
#
# Built from the repository root so the workspace packages (@neer/shared,
# @neer/scoring, @neer/insights) resolve — the API is not independently
# buildable, and pretending otherwise by copying only apps/api would produce a
# Dockerfile that works nowhere.
# ──────────────────────────────────────────────────────────────────────────────

FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /app

# ─── dependencies ─────────────────────────────────────────────────────────────
# Manifests are copied before sources so the install layer is cached against
# dependency changes rather than invalidated by every edit to a .ts file.
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/shared/package.json      packages/shared/
COPY packages/scoring/package.json     packages/scoring/
COPY packages/insights/package.json    packages/insights/
COPY packages/pipeline/package.json    packages/pipeline/
COPY apps/api/package.json             apps/api/
COPY apps/web/package.json             apps/web/
COPY tools/package.json                tools/
RUN pnpm install --frozen-lockfile

# ─── build ────────────────────────────────────────────────────────────────────
FROM deps AS build
COPY tsconfig.base.json ./
COPY packages ./packages
COPY apps/api ./apps/api
RUN pnpm --filter @neer/shared --filter @neer/scoring --filter @neer/insights --filter @neer/pipeline --filter @neer/api build

# ─── runtime ──────────────────────────────────────────────────────────────────
FROM base AS runtime
ENV NODE_ENV=production

COPY --from=build /app/node_modules              ./node_modules
COPY --from=build /app/packages                  ./packages
COPY --from=build /app/apps/api/dist             ./apps/api/dist
COPY --from=build /app/apps/api/node_modules     ./apps/api/node_modules
COPY --from=build /app/apps/api/package.json     ./apps/api/package.json

WORKDIR /app/apps/api

# Run unprivileged. The node image ships a `node` user for exactly this, and a
# read-only API has no reason whatsoever to run as root.
USER node

EXPOSE 3000
CMD ["node", "dist/main.js"]
