import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Validate the website and all imported helpers here. The unchanged root
  // typecheck in CI also validates workers, backend and offline diagnostics.
  typescript: { tsconfigPath: "tsconfig.website.json" },
};

export default nextConfig;
