# syntax=docker/dockerfile:1.7
# ---- Base: Node 22 + pnpm via corepack ----
FROM node:22-bookworm-slim AS base
ENV PNPM_HOME="/pnpm" PATH="/pnpm:$PATH"
RUN corepack enable
WORKDIR /app

# ---- Dependencies (cached on lockfile) ----
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN pnpm install --frozen-lockfile

# ---- Build: generate Prisma client + build Next ----
FROM base AS build
# Prisma config requires these at generate time; values are never connected.
ENV DATABASE_URL=postgresql://build:build@localhost:5432/build?schema=public
ENV SHADOW_DATABASE_URL=postgresql://build:build@localhost:5432/build_shadow?schema=public
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm prisma generate
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm build

# ---- Runtime: minimal, non-root, runs web (default) or worker (override CMD) ----
FROM base AS runtime
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
RUN groupadd --system --gid 1001 nodejs \
 && useradd --system --uid 1001 --gid nodejs nextjs

# Full app deps (worker uses tsx + Prisma client at runtime)
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/pnpm-lock.yaml ./pnpm-lock.yaml
COPY --from=build /app/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY --from=build /app/.npmrc ./.npmrc
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/prisma.config.ts ./prisma.config.ts
COPY --from=build /app/next.config.ts ./next.config.ts
COPY --from=build /app/src ./src
COPY --from=build /app/.next ./.next
COPY --from=build /app/src/generated ./src/generated

USER nextjs
EXPOSE 3000
ENV PORT=3000
# Web service default; the worker service overrides this with: pnpm worker:start
CMD ["pnpm", "start"]
