import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["192.168.100.10"],
  // The Playwright suite sets its own build folder so it can run beside a normal `next dev`.
  ...(process.env.E2E_DIST_DIR ? { distDir: process.env.E2E_DIST_DIR } : {}),
};

export default nextConfig;
