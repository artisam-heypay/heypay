import "dotenv/config";
import { defineConfig, env } from "prisma/config";

// A shadow DB is only used by `migrate dev`/`migrate diff` (local schema authoring).
// `migrate deploy` (staging/prod release) never needs one. Only configure it when the
// value is present AND distinct from the main DB — supplying a shadow equal to the main
// database makes Prisma refuse to run ("shadow database appears to be the same as the
// main database"), which was breaking the Railway release command.
const shadowDatabaseUrl = process.env.SHADOW_DATABASE_URL;
const useShadow = !!shadowDatabaseUrl && shadowDatabaseUrl !== process.env.DATABASE_URL;

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: env("DATABASE_URL"),
    ...(useShadow ? { shadowDatabaseUrl: env("SHADOW_DATABASE_URL") } : {}),
  },
});
