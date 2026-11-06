import { createHash } from "node:crypto";
import { canonicalJson } from "@/lib/canonicalJson";
import { createYuE2AcceptedArrangementRequest, validateYuE2EvaluationRequest, type YuE2AcceptedArrangementRequest } from "@/lib/yue2Evaluation";
import { configuredHyperYoutubeStageClient, type HyperYoutubeStage } from "@/lib/hyperYoutubeStageClient";
import { decodeHyperYueFlac, inspectHyperYueWav } from "@/lib/hyperYoutubeYueAudio";
import { getObjectBytes, putObject } from "@/lib/storage";
import { getStudioPrivateBucket } from "@/lib/studioPrivateStorage";
import { z } from "zod";

const digest=(bytes:Uint8Array|string)=>createHash("sha256").update(bytes).digest("hex");

/** HRS owns the GPU job. A repeated run submits the same immutable identity. */
export async function renderHyperYoutubeYue(input:{ownerId:string;channelId:string;runId:string;arrangement:unknown;seed:number;
  authorize:()=>Promise<void>;wait:(jobId:string,check:number)=>Promise<void>;
  client?:ReturnType<typeof configuredHyperYoutubeStageClient>;
  storage?:{bucket:string;put:typeof putObject;get:typeof getObjectBytes};decode?:typeof decodeHyperYueFlac}) {
  const request=createYuE2AcceptedArrangementRequest({arrangement:input.arrangement,seed:input.seed,personalCreatorAcknowledged:true});
  const source=request.job;
  if (source.schema_version!==2) throw new Error("HRS YuE requires the accepted scored arrangement");
  const stage:HyperYoutubeStage={modelId:"yue2",inputs:{prompt:source.style,lyrics:source.lyrics,
    ...(source.abc ? {abc:source.abc} : {})},seed:source.seed};
  const idempotencyKey=`youtube-yue:${digest(canonicalJson({ownerId:input.ownerId,channelId:input.channelId,runId:input.runId}))}`;
  const client=input.client ?? configuredHyperYoutubeStageClient();
  await input.authorize();
  let job=await client.submit(stage,idempotencyKey);
  for(let index=0;job.state!=="completed";index++) {
    if (["failed","cancelled"].includes(job.state)) throw new Error(`HRS YuE job ${job.id} ended ${job.state}`);
    if (index>=720) throw new Error(`HRS YuE job ${job.id} is still ${job.state}; resume the same job`);
    await input.wait(job.id,index);
    job=await client.get(job.id,stage,idempotencyKey);
  }
  const flac=await client.download(job,stage,idempotencyKey);
  if (!job.output) throw new Error("HRS YuE has no verified output receipt");
  const decoded=await (input.decode ?? decodeHyperYueFlac)(flac), audioSha256=digest(decoded.wav);
  const root=`owner/${input.ownerId}/runs/${input.runId}/music/yue2-evaluation/`,bucket=input.storage?.bucket ?? getStudioPrivateBucket();
  const audioKey=`${root}audio-native-${audioSha256}.wav`, candidateKey=`${root}candidate-hrs.json`;
  const evidence={version:"studio-yue2-hrs-candidate/v1" as const,ownerId:input.ownerId,channelId:input.channelId,
    runId:input.runId,jobId:job.id,projectId:job.projectId,generation:job.generation,idempotencyKey,
    request,source:{bucket:job.output.bucket,key:job.output.key,sha256:job.output.sha256,
      bytes:job.output.bytes,contentType:job.output.contentType},audioKey,audioSha256,audioBytes:decoded.wav.length,
    nativeOutput:{sampleRateHz:48000 as const,channels:2 as const,codec:"pcm_f32le" as const,
      frames:decoded.frames,durationSec:decoded.frames/48000},signal:decoded.signal,
    costStatus:"unreported" as const,productionApproved:false as const};
  const body=Buffer.from(canonicalJson(evidence)),candidateSha256=digest(body);
  async function immutable(key:string,bytes:Uint8Array,contentType:string) {
    try { await (input.storage?.put ?? putObject)(key,bytes,{bucket,contentType,ifNoneMatch:"*"}); }
    catch(error) {
      const retained=await (input.storage?.get ?? getObjectBytes)(key,bucket,{maxBytes:Math.max(bytes.length,1)}).catch(()=>null);
      if (!retained || digest(retained)!==digest(bytes)) throw error;
    }
    const retained=await (input.storage?.get ?? getObjectBytes)(key,bucket,{maxBytes:Math.max(bytes.length,1)});
    if (retained.length!==bytes.length || digest(retained)!==digest(bytes)) throw new Error("HRS YuE project evidence verification failed");
  }
  await immutable(audioKey,decoded.wav,"audio/wav");
  await immutable(candidateKey,body,"application/json");
  return {evidence,candidateKey,candidateSha256,request:request as YuE2AcceptedArrangementRequest};
}

/** Read-only review; rebind the retained WAV to the same HRS project job. */
export async function readHyperYoutubeYue(scope:{ownerId:string;channelId:string;runId:string},
  options?:{bucket:string;get:typeof getObjectBytes;client:ReturnType<typeof configuredHyperYoutubeStageClient>;
    inspect:typeof inspectHyperYueWav}) {
  const id=z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/u);
  id.parse(scope.ownerId);id.parse(scope.channelId);id.parse(scope.runId);
  const bucket=options?.bucket ?? getStudioPrivateBucket(),root=`owner/${scope.ownerId}/runs/${scope.runId}/music/yue2-evaluation/`;
  const read=options?.get ?? getObjectBytes;
  let raw:Uint8Array;
  try { raw=await read(`${root}candidate-hrs.json`,bucket,{maxBytes:5_000_000}); }
  catch(error) {
    const e=error as {name?:string;$metadata?:{httpStatusCode?:number}};
    if (e.name==="NoSuchKey" || e.name==="NotFound" || e.$metadata?.httpStatusCode===404) return null;
    throw error;
  }
  const sha=z.string().regex(/^[a-f0-9]{64}$/u);
  const evidence=z.object({version:z.literal("studio-yue2-hrs-candidate/v1"),ownerId:z.literal(scope.ownerId),
    channelId:z.literal(scope.channelId),runId:z.literal(scope.runId),jobId:z.string().uuid(),projectId:z.string().uuid(),
    generation:z.number().int().positive(),idempotencyKey:z.string(),request:z.unknown(),
    source:z.object({bucket:z.string().min(1),key:z.string().min(1),sha256:sha,bytes:z.number().int().positive(),contentType:z.literal("audio/flac")}).strict(),
    audioKey:z.string(),audioSha256:sha,audioBytes:z.number().int().positive().max(256*1024*1024),
    nativeOutput:z.object({sampleRateHz:z.literal(48000),channels:z.literal(2),codec:z.literal("pcm_f32le"),
      frames:z.number().int().positive(),durationSec:z.number().positive()}).strict(),signal:z.unknown(),
    costStatus:z.literal("unreported"),productionApproved:z.literal(false)}).strict().parse(JSON.parse(Buffer.from(raw).toString("utf8")));
  if (Buffer.from(canonicalJson(evidence)).compare(Buffer.from(raw))!==0 ||
      evidence.audioKey!==`${root}audio-native-${evidence.audioSha256}.wav` ||
      evidence.nativeOutput.durationSec!==evidence.nativeOutput.frames/48000)
    throw new Error("Invalid HRS YuE retained identity");
  const request=validateYuE2EvaluationRequest(evidence.request);
  if (request.version!=="studio-yue2-arrangement-evaluation/v1" || request.job.schema_version!==2 ||
      request.acceptedArrangement.ownerId!==scope.ownerId || request.acceptedArrangement.channelId!==scope.channelId ||
      request.acceptedArrangement.runId!==scope.runId) throw new Error("HRS YuE arrangement scope mismatch");
  const stage:HyperYoutubeStage={modelId:"yue2",inputs:{prompt:request.job.style,lyrics:request.job.lyrics,
    ...(request.job.abc ? {abc:request.job.abc} : {})},seed:request.job.seed};
  const client=options?.client ?? configuredHyperYoutubeStageClient(),job=await client.get(evidence.jobId,stage,evidence.idempotencyKey);
  if (job.state!=="completed" || job.projectId!==evidence.projectId || job.generation!==evidence.generation ||
      !job.output || job.output.bucket!==evidence.source.bucket || job.output.key!==evidence.source.key ||
      job.output.sha256!==evidence.source.sha256 || job.output.bytes!==evidence.source.bytes || job.output.contentType!=="audio/flac")
    throw new Error("HRS YuE source receipt changed");
  const wav=await read(evidence.audioKey,bucket,{maxBytes:evidence.audioBytes});
  if (wav.length!==evidence.audioBytes || digest(wav)!==evidence.audioSha256) throw new Error("HRS YuE WAV changed");
  const signal=await (options?.inspect ?? inspectHyperYueWav)(wav,evidence.nativeOutput.frames);
  const requestedDurationSec=request.acceptedArrangement.arrangement.requestedDurationSec;
  const durationMatches=evidence.nativeOutput.frames===requestedDurationSec*48000;
  const nativeDurationMatches=evidence.nativeOutput.frames===requestedDurationSec*48000-64;
  const naturalLoopDurationAccepted=request.job.source_duration_policy==="natural_loop" &&
    evidence.nativeOutput.frames>=10*48000-64 && evidence.nativeOutput.frames<=300*48000;
  // Actual length remains explicit. Repeat playback is aligned by assembly;
  // play-once assembly refuses to trim a source that exceeds the timeline.
  const assemblyAlignmentRequired=!durationMatches && !nativeDurationMatches;
  const validSourceLength=evidence.nativeOutput.frames>=10*48000-64 && evidence.nativeOutput.frames<=300*48000;
  return {candidate:{jobId:evidence.jobId,audioSha256:evidence.audioSha256,headroom:undefined,
    nativeOutput:evidence.nativeOutput,executionAccounting:{allocatedCostUsdMicros:null}},candidateSha256:digest(raw),
    request,listeningAudioKey:evidence.audioKey,quality:{status:validSourceLength &&
      !signal.reviewReasons.length ? "needs_audition" as const : "blocked" as const,
      requestedDurationSec,actualDurationSec:evidence.nativeOutput.durationSec,durationMatches,nativeDurationMatches,
      expectedNativeFrames:requestedDurationSec*48000-64,sourceDurationPolicy:request.job.source_duration_policy ?? "exact",
      naturalLoopDurationAccepted,nativeFormatVerified:true as const,signal,headroomPreparation:undefined,productionApproved:false as const,
      unresolved:[...(assemblyAlignmentRequired?["duration_alignment_in_assembly"]:[]),"perceptual_artifacts","instrumental_only",
        "channel_personality_fit","arrangement_fidelity","repetition","ending","listening_quality"]}};
}
