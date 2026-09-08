import type { NextConfig } from "next";

const API_ORIGIN = process.env.API_ORIGIN ?? "http://127.0.0.1:4025";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      {
        source: "/dashboard",
        destination: "/overview",
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
