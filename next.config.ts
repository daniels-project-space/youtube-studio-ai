import type { NextConfig } from "next";
import { execFileSync } from "node:child_process";

function sourceReleaseSha(): string | undefined {
  try {
    const sha = execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return /^[a-f0-9]{40}$/i.test(sha) ? sha : undefined;
  } catch {
    return process.env.VERCEL_GIT_COMMIT_SHA?.trim() || process.env.RELEASE_SHA?.trim() || undefined;
  }
}

const releaseSha = sourceReleaseSha();

const nextConfig: NextConfig = {
  // Use the checked-out source revision for health identity, while keeping the
  // existing website build's bounded TypeScript project.
  ...(releaseSha ? { env: { RELEASE_SHA: releaseSha } } : {}),
  typescript: { tsconfigPath: "tsconfig.website.json" },
};

export default nextConfig;
