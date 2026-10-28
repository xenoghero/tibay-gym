import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["192.168.100.10"],
  serverExternalPackages: ["tesseract.js", "tesseract.js-core", "@tesseract.js-data/eng"],
  outputFileTracingIncludes: { "/api/receipts/review": ["./node_modules/tesseract.js/**/*", "./node_modules/tesseract.js-core/**/*", "./node_modules/@tesseract.js-data/eng/**/*"] },
};

export default nextConfig;
