import { execSync } from "node:child_process";

import type { NextConfig } from "next";
import withBundleAnalyzer from "@next/bundle-analyzer";

import { resolveApiOrigin } from "./lib/api/origin";

const API_ORIGIN = resolveApiOrigin();

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
  // Development-only. Next.js blocks its own dev resources — including the HMR
  // WebSocket at /_next/hmr — when the request's Origin host is not on this
  // list, and the default list is only `localhost`. Every doc in this repo
  // tells developers to open the app on 127.0.0.1:3025 instead (.env.example,
  // README, docs/ARCHITECTURE.md), so on the documented URL the socket was
  // refused and the browser reported ERR_INVALID_HTTP_RESPONSE: hot reload
  // never connected.
  //
  // Blocked requests get a bare socket write rather than a valid HTTP response,
  // so the symptom reads as a protocol error instead of a permission error.
  //
  // Entries are hostnames, not host/port, and must include the brackets for the
  // IPv6 loopback. This has no effect in production.
  allowedDevOrigins: ["127.0.0.1", "[::1]"],
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
