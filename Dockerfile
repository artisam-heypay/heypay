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

# Pre-fetch pnpm into a shared, group-owned corepack home. Otherwise the non-root
# runtime user tries to download pnpm at boot into an unwritable HOME and crashes
# with EACCES. Covers pre-deploy `pnpm prisma migrate deploy` and the worker.
ENV COREPACK_HOME=/opt/corepack
RUN corepack prepare pnpm@10.12.1 --activate \
 && chown -R nextjs:nodejs /opt/corepack

# Full app deps (worker uses tsx + Prisma client at runtime).
# --chown so the non-root nextjs user can write into node_modules at runtime.
# Prisma 7's `migrate deploy` release command needs write access to its engines
# dir (@prisma/engines); root-owned copies crash the release step with EACCES.
COPY --from=deps --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/pnpm-lock.yaml ./pnpm-lock.yaml
COPY --from=build /app/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY --from=build /app/.npmrc ./.npmrc
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/prisma.config.ts ./prisma.config.ts
COPY --from=build /app/next.config.ts ./next.config.ts
# tsx resolves the "@/*" -> "./src/*" path alias from tsconfig.json at runtime;
# without it the worker (node --import tsx src/worker/index.ts) crashes with
# ERR_MODULE_NOT_FOUND: Cannot find package '@/server'.
COPY --from=build /app/tsconfig.json ./tsconfig.json
COPY --from=build /app/src ./src
COPY --from=build /app/.next ./.next
COPY --from=build /app/src/generated ./src/generated

USER nextjs
EXPOSE 3000
ENV PORT=3000
# Run the next binary directly. Invoking `pnpm` here makes corepack try to
# download pnpm into the non-root user's HOME at runtime (EACCES) and crashes boot.
# Web service default; the worker service overrides CMD with:
#   node --conditions=react-server --import tsx src/worker/index.ts
CMD ["node_modules/.bin/next", "start"]
