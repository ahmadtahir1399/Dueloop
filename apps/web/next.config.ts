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
  // The Playwright build uses its own folder (it is built against the LOCAL stack: NEXT_PUBLIC_ values are inlined).
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  // The container image (Dockerfile, target `web`) sets NEXT_OUTPUT=standalone: a traced, self-contained server.js
  // (Next docs, config/next-config-js/output). Tracing starts at the monorepo root so workspace packages are included.
  ...(process.env.NEXT_OUTPUT === "standalone" ? { output: "standalone" as const, outputFileTracingRoot: path.resolve(process.cwd(), "../..") } : {}),
  // Workspace packages are TypeScript sources (with .ts import extensions); Next compiles them.
  transpilePackages: [
    "@dueloop/core",
    "@dueloop/db",
    "@dueloop/ingest",
    "@dueloop/authz",
    "@dueloop/links",
    "@dueloop/ops",
    "@dueloop/config",
    "@dueloop/messaging",
    "@dueloop/payments",
    "@dueloop/proofs",
    "@dueloop/worker",
    "@dueloop/adapters-email",
    "@dueloop/adapters-notify",
    "@dueloop/adapters-whatsapp",
    "@dueloop/adapters-payments",
    "@dueloop/classifier",
    "@dueloop/inbound",
    "@dueloop/webhooks",
  ],
  // Node-only libraries used by the server-side pipelines (never in a client bundle): required at runtime.
  serverExternalPackages: ["pg", "nodemailer", "imapflow", "@anthropic-ai/sdk", "postal-mime", "html-to-text"],
  // No X-Powered-By header (nothing to fingerprint).
  poweredByHeader: false,
  experimental: {
    // Two root layouts (staff, public): unmatched URLs get app/global-not-found.tsx.
    globalNotFound: true,
    // The proxy buffers request bodies up to this size and TRUNCATES above it (Next docs, proxyClientMaxBodySize).
    // Every route enforces its own smaller cap before parsing; this only has to stay above the largest (proof 10 MB).
    proxyClientMaxBodySize: "11mb",
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
