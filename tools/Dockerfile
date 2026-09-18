# ──────────────────────────────────────────────────────────────────────────────
# Neer tools — the simulated field crew
#
# Runs `neer-tools live`: a volunteer network that keeps posting observations to
# the API so the live path is exercised end to end. Simulated, tagged as such,
# and confined to sites whose source is `simulated`.
# ──────────────────────────────────────────────────────────────────────────────

FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /app

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

FROM deps AS build
COPY tsconfig.base.json ./
COPY packages ./packages
COPY tools ./tools
RUN pnpm --filter @neer/shared --filter @neer/scoring --filter @neer/insights --filter @neer/pipeline --filter @neer/tools build

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /app/node_modules            ./node_modules
COPY --from=build /app/packages                ./packages
COPY --from=build /app/tools/dist              ./tools/dist
COPY --from=build /app/tools/node_modules      ./tools/node_modules
COPY --from=build /app/tools/package.json      ./tools/package.json
WORKDIR /app/tools
USER node
CMD ["node", "dist/cli.js", "live"]
