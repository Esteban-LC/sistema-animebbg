import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: '50mb',
    },
  },
  // Aumentar limite de body para route handlers (upload-redraw, etc.)
  middlewareClientMaxBodySize: 52428800, // 50MB en bytes
} as NextConfig;

export default nextConfig;
