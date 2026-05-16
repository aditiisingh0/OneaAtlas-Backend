/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@oneatlas/db", "@oneatlas/shared", "@oneatlas/ai"],
  images: { unoptimized: true },
  experimental: {
    serverActions: { allowedOrigins: ["localhost:3000", "*.oneatlas.dev"] },
  },
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
          { key: "Access-Control-Allow-Methods", value: "GET,POST,PATCH,DELETE,OPTIONS" },
          { key: "Access-Control-Allow-Headers", value: "Content-Type, Authorization" },
        ],
      },
    ];
  },
};

export default nextConfig;
