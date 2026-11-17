import { task } from "@trigger.dev/sdk";
import { assertLocalPublicationAllowed } from "@/lib/localPublicationPolicy";
import { uploadPrivateDraft } from "@/lib/youtube";
import { crosspost } from "@/lib/ayrshare";
import { getOne, listByService } from "@/lib/vault";
import { getBucket, getObjectBytes, putObject } from "@/lib/storage";
import { createHash, randomUUID } from "node:crypto";

/** No provider access: verify the deployed private worker refuses public upload. */
export const automationSafetyProbe = task({
  id: "automation-safety-probe",
  machine: "micro",
  maxDuration: 30,
  retry: { maxAttempts: 1 },
  run: async () => {
    if (process.env.YOUTUBE_AUTOMATION_PRIVATE !== "1") throw new Error("Private Automation mode is not active");
    if (process.env.YOUTUBE_AUTOMATION_PUBLICATION_ENABLED === "1") throw new Error("Public uploads are enabled");
    if (!(await getOne("youtube", "INTERNAL_QUERY_SECRET")) || !(await listByService("openrouter")).OPENROUTER_API_KEY) {
      throw new Error("Local runtime credentials are incomplete");
    }
    if (getBucket() !== "youtube-automation" || process.env.R2_ACCESS_KEY_ID || process.env.R2_SECRET_ACCESS_KEY) {
      throw new Error("Local worker storage scope is invalid");
    }
    const bytes = Buffer.from("youtube automation worker storage proof v1\n");
    const key = `diagnostics/worker-${randomUUID()}.txt`;
    await putObject(key, bytes, { contentType: "text/plain" });
    const actual = await getObjectBytes(key);
    const sha = (value: Uint8Array) => createHash("sha256").update(value).digest("hex");
    if (sha(bytes) !== sha(actual)) throw new Error("Worker storage receipt hash mismatch");
    assertLocalPublicationAllowed({ privacyStatus: "private" });
    let requests = 0;
    try {
      await uploadPrivateDraft({
        filePath: "/nonexistent-private-upload-probe", title: "probe", description: "", tags: [],
        refreshToken: "probe", privacyStatus: "public",
        fetchImpl: async () => { requests++; throw new Error("unexpected network access"); },
      });
    } catch (error) {
      if (error instanceof Error && error.message.includes("uploads are disabled") && requests === 0) {
        try {
          await crosspost({ mediaUrl: "https://example.invalid/video", caption: "", platforms: ["instagram"] });
        } catch (crosspostError) {
          if (crosspostError instanceof Error && crosspostError.message.includes("cross-posting is disabled")) {
            return { ok: true, privateUploadsPermitted: true, publicUploadBlockedBeforeIo: true, crosspostingBlocked: true, localVaultConfigured: true, scopedStorageHashVerified: true };
          }
          throw crosspostError;
        }
        throw new Error("Social cross-posting was not blocked");
      }
      throw error;
    }
    throw new Error("Public upload was not blocked");
  },
});
