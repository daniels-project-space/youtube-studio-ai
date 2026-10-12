import { z } from "zod";
import { StudioRenderEngineClient, type StudioEngineAdmission } from "./studioRenderEngineClient";
import { canonicalJson } from "./canonicalJson";
import { sha256Hex } from "./sha256";

export const StudioEngineAudioInput = z.object({
  model: z.enum(["yue2", "qwen3-tts", "fish-audio-s2-pro", "minimax-music3"]),
  workflowId: z.string().regex(/^[a-z0-9]{32}$/),
  request: z.record(z.unknown()).superRefine((request, ctx) => {
    if (typeof request.idempotencyKey !== "string" || !/^[A-Za-z0-9:_-]{16,200}$/.test(request.idempotencyKey) ||
      typeof request.profileRevisionSha256 !== "string" || !/^[a-f0-9]{64}$/.test(request.profileRevisionSha256)) {
      ctx.addIssue({ code: "custom", message: "An immutable request key and profile revision are required" });
    }
    if (!z.object({ contentType: z.string().regex(/^audio\//) }).safeParse(request.output).success) {
      ctx.addIssue({ code: "custom", message: "A frozen audio output contract is required before submission" });
    }
  }),
}).strict();
export type StudioEngineAudioInput = z.infer<typeof StudioEngineAudioInput>;
export type StudioEngineAudioRecovery = { inputSha256: string; admission: StudioEngineAdmission };

/** Engine owns the job lifecycle. This runner observes one immutable admission. */
export async function executeStudioEngineAudio(inputValue: unknown, options: {
  client: StudioRenderEngineClient;
  authorize: () => Promise<void>;
  wait: (seconds: number, key: string) => Promise<void>;
  onAccepted: (recovery: StudioEngineAudioRecovery) => Promise<void>;
  recovery?: StudioEngineAudioRecovery;
  maxObservations?: number;
}) {
  const input = StudioEngineAudioInput.parse(inputValue);
  const inputSha256 = sha256Hex(canonicalJson(input));
  if (options.recovery && options.recovery.inputSha256 !== inputSha256) throw new Error("Engine recovery input changed");
  const count = options.maxObservations ?? 60;
  if (!Number.isSafeInteger(count) || count < 1 || count > 120) throw new Error("Invalid Engine observation bound");
  await options.authorize();
  const admission = options.recovery?.admission ?? await options.client.submitAudio(input.model, input.workflowId, input.request);
  try {
  await options.onAccepted({ inputSha256, admission });
  for (let index = 0; index < count; index++) {
    await options.authorize();
    const status = await options.client.observeAudio(admission, input.model, input.workflowId);
    if (status.status === "awaiting-final-qualification") {
      throw new Error(`Render Engine audio ${admission.jobId} is held for final qualification; resume this admission when ready`);
    }
    if (["failed", "cancelled"].includes(status.status)) {
      throw new Error(`Render Engine audio ${admission.jobId} ended ${status.status}; retain its original request`);
    }
    if (status.status === "completed") {
      if (status.outputRetired || !status.output) throw new Error("Completed Engine job has no current verified output");
      const { receipt, bytes, nativeArtifactBytes } = await options.client.verifiedOutput(admission.jobId, 250_000_000, input.model === "yue2");
      const requestedOutput = z.object({ contentType: z.string().regex(/^audio\//) }).parse(input.request.output);
      if (receipt.contentType !== requestedOutput.contentType) throw new Error("Engine audio format differs from the frozen request");
      for (const field of ["bucket", "key", "bytes", "sha256", "contentType", "verifiedAt"] as const) {
        if (receipt[field] !== status.output[field]) throw new Error("Engine output readback changed since completion");
      }
      const after = await options.client.observeAudio(admission, input.model, input.workflowId);
      if (after.status !== "completed" || after.outputRetired || !after.output ||
        after.output.sha256 !== receipt.sha256 || after.output.key !== receipt.key ||
        after.output.bytes !== receipt.bytes || after.output.bucket !== receipt.bucket ||
        after.output.verifiedAt !== receipt.verifiedAt || after.output.contentType !== receipt.contentType) {
        throw new Error("Engine output was retired or replaced during verification");
      }
      // Signed capabilities are temporary; persist only the durable receipt.
      const { url, ...output } = receipt;
      void url;
      return { jobId: admission.jobId, manifestSha256: admission.manifestSha256, model: input.model,
        workflowId: input.workflowId, output, bytes, nativeArtifactBytes };
    }
    if (index + 1 < count) await options.wait(30, `${admission.jobId}:studio-audio:${index}`);
  }
  throw new Error(`Render Engine audio ${admission.jobId} remains pending; recover this admission without creating another job`);
  } catch (error) {
    const failure = error instanceof Error ? error : new Error("Accepted Engine audio requires reconciliation");
    Object.assign(failure, { engineJobId: admission.jobId, retryable: false, submissionMayExist: true,
      recovery: { inputSha256, admission } });
    throw failure;
  }
}
