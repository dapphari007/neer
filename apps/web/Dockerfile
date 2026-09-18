# ──────────────────────────────────────────────────────────────────────────────
# Neer dashboard
#
# Built from the repository root so @neer/shared resolves, then served as static
# files by nginx. A Node process serving a built SPA would be pure overhead —
# there is nothing to render server-side.
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
# Baked in at build time by Vite, so the image knows which API to talk to.
# Leave it unset to build the static-data variant that needs no backend at all.
ARG VITE_API_BASE_URL=""
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL

COPY tsconfig.base.json ./
COPY packages ./packages
COPY apps/web ./apps/web
RUN pnpm --filter @neer/shared build && pnpm --filter @neer/web build

FROM nginx:1.27-alpine AS runtime
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
