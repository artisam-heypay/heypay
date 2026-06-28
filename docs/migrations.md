# Database Migrations

HeyPay uses **Prisma 7** (Rust-free `prisma-client` generator) with the
**`@prisma/adapter-pg` driver adapter** against **PostgreSQL 17**. This document
records the conventions the team follows before making any schema change.

## Source of truth

- Schema: [`prisma/schema.prisma`](../prisma/schema.prisma) — all models + enums.
- Config: [`prisma.config.ts`](../prisma.config.ts) — Prisma 7 config. Connection
  URLs (`url`, `shadowDatabaseUrl`) live here (read from env), **not** in
  `schema.prisma`. In Prisma 7 the `datasource` block only declares `provider`;
  `url`/`shadowDatabaseUrl` were moved to the config file.
- Migrations: [`prisma/migrations/`](../prisma/migrations) — committed to git.
- Generated client: `src/generated/prisma/**` — **gitignored**, regenerated
  locally via `pnpm prisma generate`. Imported through the alias
  `@/generated/prisma` (mapped in `tsconfig.json` to the generator entry
  `client.ts`, since the Prisma 7 generator emits no barrel `index.ts`).

## Migration naming & timestamp format

Each migration is a directory:

```
prisma/migrations/<UTC_TIMESTAMP>_<name>/migration.sql
```

- `<UTC_TIMESTAMP>` — `YYYYMMDDHHMMSS` in UTC, generated automatically by Prisma.
  Example: `20260628131155_init`.
- `<name>` — the snake_cased value passed to `--name` (e.g. `init`,
  `add_payment_index`). Keep it short and descriptive of the change.
- `migration_lock.toml` records the provider (`postgresql`) and must not be
  edited by hand.

Never rename, edit, or delete an already-applied/committed migration. To change
the schema, add a **new** migration.

## How to add a migration

1. Ensure local infra is up (Postgres + Redis): `docker compose up -d`.
2. Edit `prisma/schema.prisma`.
3. Create + apply the migration and regenerate the client:
   ```bash
   pnpm prisma migrate dev --name <descriptive_name>
   ```
   This writes `prisma/migrations/<ts>_<name>/migration.sql`, applies it to the
   dev DB, and runs `prisma generate`.
4. Verify: `pnpm prisma validate && pnpm typecheck`.
5. Commit the new `prisma/migrations/**` directory together with the schema
   change.

### Applying migrations elsewhere (CI / prod)

```bash
pnpm prisma migrate deploy
```

`migrate deploy` only applies committed migrations (no schema diffing, no shadow
DB, never resets data) — use it in CI and production.

### Generating SQL without applying (offline)

If a database is unavailable, the SQL can be authored with:

```bash
pnpm prisma migrate diff \
  --from-empty \
  --to-schema-datamodel prisma/schema.prisma \
  --script
```

Prefer the real `migrate dev` path whenever Docker/Postgres is available.

## Shadow database

`prisma migrate dev` uses a **shadow database** to detect schema drift and
validate migrations. It is configured explicitly via `SHADOW_DATABASE_URL`
(wired in `prisma.config.ts` as `datasource.shadowDatabaseUrl`).

- Dev default: a separate `heypay_shadow` database on the same Postgres
  instance. Create it once if it does not exist:
  ```bash
  docker compose exec -T postgres psql -U heypay -d postgres \
    -c "CREATE DATABASE heypay_shadow;"
  ```
- The shadow DB is only used by `migrate dev`/`migrate diff`; `migrate deploy`
  does not need it.
- If your DB user has `CREATEDB`, Prisma can manage a temporary shadow database
  automatically, but we pin an explicit URL for deterministic local + CI runs.

## Local port note

`docker-compose.yml` publishes Postgres on host port `5432`. If a native
Postgres already listens on `5432`, point your local (gitignored) `.env`
`DATABASE_URL`/`SHADOW_DATABASE_URL` at an alternate host port (e.g. `5433`) and
publish the container there to avoid the conflict. This only affects local
`.env`; the committed compose file and migrations are unaffected.
