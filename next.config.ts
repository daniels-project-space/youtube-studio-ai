import type { NextConfig } from "next";
import { execFileSync } from "node:child_process";

const shaPattern = /^[a-f0-9]{40}$/i;

function checkedOutSha(): string | undefined {
  try {
    const sha = execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return shaPattern.test(sha) ? sha.toLowerCase() : undefined;
  } catch {
    return undefined;
  }
}

function platformSha(): string | undefined {
  const sha = process.env.VERCEL_GIT_COMMIT_SHA?.trim();
  return sha && shaPattern.test(sha) ? sha.toLowerCase() : undefined;
}

const checkoutSha = checkedOutSha();
const vercelSha = platformSha();
if (process.env.VERCEL && checkoutSha && vercelSha && checkoutSha !== vercelSha) {
  console.warn(
    `[youtube-studio-release] Vercel source ${vercelSha} differs from checkout ${checkoutSha}; embedding checkout revision`,
  );
}
const releaseSha = checkoutSha ?? vercelSha ?? (process.env.VERCEL ? undefined : process.env.RELEASE_SHA?.trim());
if (process.env.VERCEL && !releaseSha) {
  throw new Error("[youtube-studio-release] Vercel build has no verifiable source revision");
}
const deploymentId = process.env.VERCEL_DEPLOYMENT_ID?.trim();
console.info(`[youtube-studio-release] revision=${releaseSha ?? "unknown"} deployment=${deploymentId || "unknown"}`);

const nextConfig: NextConfig = {
  ...(process.env.YOUTUBE_WORKSHOP_STANDALONE === "1" ? { output: "standalone" as const } : {}),
  ...(process.env.YOUTUBE_WORKSHOP_STANDALONE === "1" ? { serverExternalPackages: ["remotion", "@remotion/renderer", "@remotion/bundler"] } : {}),
  // Embed source and deployment identity in the build instead of trusting
  // runtime Git metadata, which can lag the deployment's actual source commit.
  ...(releaseSha || deploymentId || process.env.YOUTUBE_WORKSHOP_STANDALONE === "1"
    ? {
        env: {
          ...(releaseSha ? { RELEASE_SHA: releaseSha } : {}),
          ...(deploymentId ? { RELEASE_DEPLOYMENT_ID: deploymentId } : {}),
          ...(process.env.YOUTUBE_WORKSHOP_STANDALONE === "1" ? { NEXT_PUBLIC_YTS_WORKSHOP: "1" } : {}),
        },
      }
    : {}),
  typescript: { tsconfigPath: "tsconfig.website.json" },
};

export default nextConfig;
