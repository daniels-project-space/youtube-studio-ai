import { createHash } from "node:crypto";

// Derived from a read-only Cloudflare Get Bucket response for youtube-studio-ai
// on 2026-09-27, authenticated with the app vault's independent API token.
const VERIFIED_YOUTUBE_R2_ACCOUNT_SHA256 = "2e10392dc4d0c45e123828eab3bdb0a2911d593a78cda90c6f75ac241453c01c";

/** Fail closed on a wrong account, copied generic R2 env, or endpoint override. */
export function assertYouTubeStudioR2Account(input: {
  accountId?: string; expectedAccountId?: string; endpoint?: string;
}, expectedHash = VERIFIED_YOUTUBE_R2_ACCOUNT_SHA256): void {
  const { accountId, expectedAccountId, endpoint } = input;
  if (!accountId || !expectedAccountId || !/^[a-f0-9]{32}$/iu.test(expectedAccountId) ||
      accountId.toLowerCase() !== expectedAccountId.toLowerCase() ||
      createHash("sha256").update(accountId.toLowerCase()).digest("hex") !== expectedHash ||
      (endpoint && endpoint !== `https://${accountId}.r2.cloudflarestorage.com`)) {
    throw new Error("R2 retention requires the verified YouTube Studio Cloudflare account and endpoint");
  }
}
