import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Native/Node-only deps must not be bundled into server components output.
  serverExternalPackages: ["argon2", "@prisma/adapter-pg", "pg", "ioredis"],
  // `next build` type-checks every file its tsconfig includes. The Docker image
  // leaves tests/ out, so the build checks app code only; `pnpm typecheck` still
  // covers the tests.
  typescript: { tsconfigPath: "tsconfig.build.json" },
  // PostHog is reached through our own origin (/ingest) so the CSP stays
  // connect-src 'self' and ad blockers do not drop events. Region: POSTHOG_HOST.
  async rewrites() {
    const ingest = (process.env.POSTHOG_HOST?.trim() || "https://us.i.posthog.com").replace(
      /\/+$/,
      "",
    );
    const assets = ingest
      .replace("://us.i.", "://us-assets.i.")
      .replace("://eu.i.", "://eu-assets.i.");
    return [
      { source: "/ingest/static/:path*", destination: `${assets}/static/:path*` },
      { source: "/ingest/array/:path*", destination: `${assets}/array/:path*` },
      { source: "/ingest/:path*", destination: `${ingest}/:path*` },
    ];
  },
  // PostHog's API uses trailing slashes; don't let Next redirect them away.
  skipTrailingSlashRedirect: true,
};

export default nextConfig;
