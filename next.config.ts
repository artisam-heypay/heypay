import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Native/Node-only deps must not be bundled into server components output.
  serverExternalPackages: ["argon2", "@prisma/adapter-pg", "pg", "ioredis"],
};

export default nextConfig;
