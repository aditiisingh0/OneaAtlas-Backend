// =============================================================================
// apps/api/next.config.ts
// =============================================================================

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Transpile local workspace packages
  transpilePackages: ["@oneatlas/db", "@oneatlas/shared"],

  // API-only app — no need for image optimization
  images: { unoptimized: true },

  experimental: {
    // Enable server actions if needed later
    serverActions: { allowedOrigins: ["localhost:3000", "*.oneatlas.dev"] },
  },

  // Security headers
  async headers() {
    return [
      {
        source: "/api/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Access-Control-Allow-Origin",
            value: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
          },
          {
            key: "Access-Control-Allow-Methods",
            value: "GET,POST,PATCH,DELETE,OPTIONS",
          },
          {
            key: "Access-Control-Allow-Headers",
            value: "Content-Type, Authorization",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
