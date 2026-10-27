import { existsSync } from "node:fs";
import path from "node:path";
import type { NextConfig } from "next";

// The repo keeps one .env at its root. Load it for the web app too; variables already set in the
// environment win (process.loadEnvFile never overrides), so a shell can point the app elsewhere.
const rootEnv = path.resolve(process.cwd(), "../../.env");
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

// Cache Components / Partial Prefetching (opt-in in Next 16) are off: every page here is per-user and
// per-request (Supabase session cookie), so classic dynamic rendering is simpler and fully supported.
const nextConfig: NextConfig = {
  // Workspace packages are TypeScript sources (with .ts import extensions); Next compiles them.
  transpilePackages: ["@dueloop/core", "@dueloop/db", "@dueloop/ingest"],
  experimental: {
    // CSV uploads go through a Server Action; the import limit is 5 MiB plus multipart overhead.
    serverActions: { bodySizeLimit: "6mb" },
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
