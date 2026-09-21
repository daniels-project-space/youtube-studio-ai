import { createHash } from "node:crypto";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import type { StageContext } from "@/engine/types";
import { AcceptedMusicArrangementSchema } from "@/engine/acceptedMusicArrangement";
import { YuE2MusicCandidateSchema } from "@/engine/yue2MusicCandidate";
import { YuE2SourceApprovalSchema } from "@/engine/yue2SourceApproval";
import { StudioConvexHttpClient } from "./studioConvexHttpClient";
import { readDurableYuE2Candidate } from "./yue2DurableEvaluation";
import { getStudioPrivateBucket } from "./studioPrivateStorage";
import { getObjectBytes } from "./storage";
import { selfLoopAudio } from "./music";
import { makeRunTempDir } from "./files";
import { canonicalJson } from "./canonicalJson";
import { probeYuE2NativeWav } from "./yue2NativeAudio";

const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const approvalApi = (api as unknown as { yue2Auditions: { getSourceApproval: never } }).yue2Auditions;

/** Read-only source adoption. Never dispatches inference or copies private audio to a public bucket. */
export async function prepareApprovedYuE2AssemblySource(ctx: StageContext, crossfadeSec: number) {
  const candidate = YuE2MusicCandidateSchema.parse(ctx.store["yue2MusicCandidate"]);
  const arrangement = AcceptedMusicArrangementSchema.parse(ctx.store["acceptedMusicArrangement"]);
  if (candidate.ownerId !== ctx.ownerId || candidate.channelId !== ctx.channelId || candidate.runId !== ctx.runId ||
    arrangement.ownerId !== ctx.ownerId || arrangement.channelId !== ctx.channelId || arrangement.runId !== ctx.runId ||
    candidate.arrangementFingerprint !== arrangement.fingerprint || candidate.technicalStatus !== "needs_audition" ||
    arrangement.arrangement.playback !== "repeat" || !arrangement.reviewContext ||
    !Number.isFinite(crossfadeSec) || crossfadeSec < 0.5 || crossfadeSec > 4) {
    throw new Error("YuE2 assembly requires the exact unblocked, repeatable arrangement and candidate");
  }
  const assertLease = ctx.assertRemoteChildExecutionLease
    ? () => ctx.assertRemoteChildExecutionLease!({ reason: "paid_wave" }) : ctx.assertInlinePaidExecutionLease;
  if (!assertLease) throw new Error("YuE2 assembly requires current execution authority");
  await assertLease();
  const url = process.env.CONVEX_URL ?? process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) throw new Error("YuE2 approval service unavailable");
  const convex = new StudioConvexHttpClient(url);
  const run = await convex.query(api.runs.getRun, { runId: ctx.runId as Id<"runs"> });
  if (!run || run._id !== ctx.runId || run.ownerId !== ctx.ownerId || run.channelId !== ctx.channelId ||
    !/^[a-f0-9]{64}$/u.test(run.pipelineInvocationSha256 ?? "")) throw new Error("YuE2 assembly invocation mismatch");
  const scope = { ownerId: ctx.ownerId, channelId: ctx.channelId, runId: ctx.runId,
    candidateSha256: candidate.candidateSha256, invocationSha256: run.pipelineInvocationSha256 };
  const readApproval = async () => YuE2SourceApprovalSchema.parse(await convex.query(approvalApi.getSourceApproval, scope as never));
  const approval = await readApproval();
  const basis = approval.basis;
  if (basis.ownerId !== ctx.ownerId || basis.channelId !== ctx.channelId || basis.runId !== ctx.runId ||
    basis.invocationSha256 !== run.pipelineInvocationSha256 || basis.candidateSha256 !== candidate.candidateSha256 ||
    basis.arrangementFingerprint !== arrangement.fingerprint || basis.jobId !== candidate.jobId ||
    basis.listeningAudioKey !== candidate.listeningAudioKey || basis.listeningAudioSha256 !== candidate.listeningAudioSha256 ||
    basis.nativeFrames !== candidate.nativeFrames || canonicalJson(basis.sectionIds) !== canonicalJson(arrangement.arrangement.sections.map(section => section.id))) {
    throw new Error("YuE2 approval does not bind this exact source");
  }
  const material = await readDurableYuE2Candidate(scope);
  if (!material || material.candidateSha256 !== candidate.candidateSha256 || material.quality.status !== "needs_audition" ||
    material.candidate.nativeOutput.frames !== candidate.nativeFrames ||
    (material.candidate.headroom?.audioSha256 ?? material.candidate.audioSha256) !== candidate.listeningAudioSha256 ||
    material.listeningAudioKey !== candidate.listeningAudioKey || canonicalJson(material.request.acceptedArrangement) !== canonicalJson(arrangement)) {
    throw new Error("YuE2 retained source no longer matches the approved candidate");
  }
  const bytes = await getObjectBytes(candidate.listeningAudioKey, getStudioPrivateBucket(), {
    timeoutMs: 120_000, maxBytes: Math.min(256 * 1024 * 1024, candidate.nativeFrames * 8 + 65536),
  });
  if (digest(bytes) !== candidate.listeningAudioSha256) throw new Error("YuE2 approved listening bytes changed");
  const directory = await makeRunTempDir(ctx.runId);
  const cleanup = () => rm(directory, { recursive: true, force: true });
  try {
  const inputPath = join(directory, "source.wav"), path = join(directory, "loop.wav");
  await writeFile(inputPath, bytes, { mode: 0o600 });
  await probeYuE2NativeWav(inputPath, { frames: candidate.nativeFrames }, bytes.byteLength);
  await selfLoopAudio(inputPath, path, { outputFormat: "native_float_wav", crossfadeSec, log: ctx.log });
  const loopBytes = await readFile(path);
  const preparedFrames = candidate.nativeFrames - Math.round(crossfadeSec * 48000);
  await probeYuE2NativeWav(path, { frames: preparedFrames }, loopBytes.byteLength);
  // Recheck after storage/CPU work: a changed owner decision cannot slip into encoding.
  if ((await readApproval()).fingerprint !== approval.fingerprint) throw new Error("YuE2 source approval changed during preparation");
  await assertLease();
  return { path, cleanup, evidence: {
    version: "yue2-assembly-source/v1", approvalFingerprint: approval.fingerprint,
    candidateSha256: candidate.candidateSha256, arrangementFingerprint: arrangement.fingerprint,
    listeningAudioSha256: candidate.listeningAudioSha256, nativeFrames: candidate.nativeFrames,
    preparedAudioSha256: digest(loopBytes), preparedAudioBytes: loopBytes.byteLength, preparedFrames,
    crossfadeSec, sampleRateHz: 48000, channels: 2, playback: "repeat", publishingApproved: false,
  } };
  } catch (error) { await cleanup(); throw error; }
}
