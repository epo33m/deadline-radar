import { execSync } from "node:child_process";

import type { NextConfig } from "next";
import withBundleAnalyzer from "@next/bundle-analyzer";

const API_ORIGIN = process.env.API_ORIGIN ?? "http://127.0.0.1:4025";

/**
 * Deterministic build ID (perf plan, Fase C).
 *
 * The static-page CSP hashes (`scripts/build-csp-hashes.ts`) are derived
 * from prerendered HTML that embeds the build ID — so the double-build
 * (build → hash → build → verify) only produces identical output when the
 * ID is stable across both builds in the same run. Random default IDs
 * would invalidate the hashes on every build.
 */
function resolveBuildId(): string {
  const fromVercel = process.env.VERCEL_GIT_COMMIT_SHA;
  if (fromVercel && fromVercel.length > 0) return fromVercel;
  try {
    const sha = execSync("git rev-parse HEAD", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (sha.length > 0) return sha;
  } catch {
    // No git available (e.g. minimal CI checkout) — fall through.
  }
  return "local-dev";
}

const nextConfig: NextConfig = {
  generateBuildId: async () => resolveBuildId(),
  async headers() {
    // Edge cache for the prerendered-static pages (perf plan, Fase C).
    // Same bytes for every viewer until the next deploy (chunks are
    // content-addressed and immutable), so a 1h edge TTL with 24h
    // stale-while-revalidate is safe. Middleware still runs first at the
    // edge, so the session gate (logged-in → away from /login) keeps
    // working — only anonymous viewers ever hit the cached copy.
    const staticEdgeCache = {
      key: "Cache-Control",
      value: "public, s-maxage=3600, stale-while-revalidate=86400",
    };
    return ["/", "/login", "/register", "/forgot-password"].map((source) => ({
      source,
      headers: [staticEdgeCache],
    }));
  },
  async redirects() {
    return [
      {
        source: "/dashboard",
        destination: "/summary",
        permanent: true,
      },
      {
        source: "/overview",
        destination: "/summary",
        permanent: true,
      },
    ];
  },
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${API_ORIGIN}/api/:path*`,
      },
      {
        source: "/openapi",
        destination: `${API_ORIGIN}/openapi`,
      },
      {
        source: "/openapi/:path*",
        destination: `${API_ORIGIN}/openapi/:path*`,
      },
      {
        source: "/health",
        destination: `${API_ORIGIN}/health`,
      },
    ];
  },
};

export default withBundleAnalyzer({ enabled: process.env.ANALYZE === "true" })(
  nextConfig,
);
