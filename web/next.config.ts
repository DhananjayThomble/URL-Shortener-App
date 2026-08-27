import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // This app is a pure client of the NestJS API. There are intentionally no
  // route handlers under src/app/api — all data access goes through
  // src/lib/api/client.ts to NEXT_PUBLIC_API_URL.
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001/api/v1",
  },
};

export default nextConfig;
