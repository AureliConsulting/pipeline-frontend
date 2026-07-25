import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@aureli/shared"],
  poweredByHeader: false,
  eslint: { ignoreDuringBuilds: true },
  experimental: {
    // API routes that download CSVs from storage for validation need room.
    serverActions: { bodySizeLimit: "2mb" },
  },
};

export default nextConfig;
