import type { NextConfig } from "next";

const API_ORIGIN = process.env.API_ORIGIN ?? "http://127.0.0.1:4025";

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

export default nextConfig;
