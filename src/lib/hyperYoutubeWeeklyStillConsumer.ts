import { z } from "zod";
import { canonicalJson } from "@/lib/canonicalJson";
import { sha256BytesHex, sha256Hex } from "@/lib/sha256";
import { getObjectBytes } from "@/lib/storage";
import { configuredHyperYoutubeStageClient } from "@/lib/hyperYoutubeStageClient";
import { rasterImageDimensions } from "@/lib/imageDimensions";
import { StillRenderManifestSchema } from "@/engine/renderArtifacts";

const sha = z.string().regex(/^[a-f0-9]{64}$/);
const environment = z.object({id:z.string().uuid(),modelId:z.literal("ernie-image-turbo"),sha256:sha}).strict();
const stage = z.object({modelId:z.literal("ernie-image-turbo"),inputs:z.object({prompt:z.string().min(1).max(16_000)}).strict(),
  seed:z.number().int().nonnegative().safe().optional()}).strict();
const item = z.object({shotId:z.string().min(1),candidateIndex:z.number().int().nonnegative(),status:z.literal("ready"),
  stillKey:z.string(),sha256:sha,byteLength:z.number().int().positive().max(50*1024*1024),jobId:z.string().uuid(),
  generation:z.number().int().nonnegative(),environment,idempotencyKey:z.string().min(1),stage,requestSha256:sha,
  source:z.object({bucket:z.string(),key:z.string(),sha256:sha,bytes:z.number().int().positive(),contentType:z.literal("image/png")}).strict()}).strict();
const receiptSchema=z.object({version:z.literal("weekly-hrs-ernie-stills/v1"),projectId:z.string().uuid(),inputSha256:sha,
  manifestSha256:sha,ownerId:z.string(),channelId:z.string(),generationProfile:z.enum(["production","hero"]),
  modelId:z.literal("ernie-image-turbo"),width:z.literal(1024),height:z.literal(1024),
  expectedNativeProfile:z.object({precision:z.literal("bf16"),steps:z.literal(50)}).strict(),
  referenceConditioning:z.literal(false),costStatus:z.literal("unreported"),items:z.array(item).min(1).max(240)}).strict();

/** Authenticate receipt and stored bytes again at the still consumer boundary. */
export async function loadWeeklyHyperStillsForConsumer(input:{receiptKey:string;manifestSha256:string;ownerId:string;channelId:string;
  keyPrefix:string;profileId:"production"|"hero";shots:readonly {id:string;candidateCount:number;requiredPrompt:string;
    visualDirective?:string;requiresReference:boolean}[];client?:ReturnType<typeof configuredHyperYoutubeStageClient>;
  read?:typeof getObjectBytes}) {
  const read=input.read ?? getObjectBytes,client=input.client ?? configuredHyperYoutubeStageClient(),binding=await client.binding();
  if (!process.env.R2_BUCKET || binding.outputBucket!==process.env.R2_BUCKET) throw new Error("weekly ERNIE project bucket mismatch");
  if (!input.receiptKey.startsWith(`${input.keyPrefix.replace(/\/$/,"")}/plan-batches/`) || !input.receiptKey.endsWith("/receipt.json"))
    throw new Error("weekly ERNIE receipt is outside its owner-scoped preparation");
  const root=input.receiptKey.slice(0,-"/receipt.json".length);
  const readJson=async(key:string)=>JSON.parse(Buffer.from(await read(key,binding.outputBucket,{maxBytes:5_000_000,timeoutMs:30_000})).toString("utf8"));
  const receipt=receiptSchema.parse(await readJson(input.receiptKey));
  if (receipt.ownerId!==input.ownerId || receipt.channelId!==input.channelId || receipt.projectId!==binding.projectId ||
      receipt.manifestSha256!==input.manifestSha256 || receipt.generationProfile!==input.profileId)
    throw new Error("weekly ERNIE receipt scope or profile mismatch");
  const request=z.object({version:z.literal("weekly-hrs-ernie-request/v1"),projectId:z.literal(binding.projectId),
    inputSha256:z.literal(receipt.inputSha256)}).strict().parse(await readJson(`${root}/request.json`));
  void request;
  const expected=input.shots.flatMap(shot=>Array.from({length:shot.candidateCount},(_,candidateIndex)=>({shot,candidateIndex})));
  if (receipt.items.length!==expected.length) throw new Error("weekly ERNIE candidate count mismatch or reference item is blocked");
  const items=[];
  for (const [ordinal,entry] of receipt.items.entries()) {
    const wanted=expected[ordinal];
    if (!wanted || entry.shotId!==wanted.shot.id || entry.candidateIndex!==wanted.candidateIndex || wanted.shot.requiresReference ||
        !entry.stage.inputs.prompt.includes(wanted.shot.requiredPrompt) ||
        (wanted.shot.visualDirective && !entry.stage.inputs.prompt.includes(wanted.shot.visualDirective)))
      throw new Error(`weekly ERNIE shot ${entry.shotId} lacks required shot, visual directive or image-reference evidence`);
    const itemRoot=`${root}/items/${String(ordinal).padStart(4,"0")}`;
    const requestSha256=sha256Hex(canonicalJson({inputSha256:receipt.inputSha256,shotId:entry.shotId,
      candidateIndex:entry.candidateIndex,stage:entry.stage}));
    const expectedKey=`youtube-weekly-ernie:${sha256Hex(canonicalJson({inputSha256:receipt.inputSha256,ordinal}))}`;
    if(entry.requestSha256!==requestSha256 || entry.idempotencyKey!==expectedKey || entry.stillKey!==`${itemRoot}/output.png`)
      throw new Error("weekly ERNIE request or output identity mismatch");
    const envRecord=z.object({version:z.literal("weekly-hrs-ernie-environment/v1"),projectId:z.literal(binding.projectId),
      requestSha256:z.literal(requestSha256),environment}).strict().parse(await readJson(`${itemRoot}/environment.json`));
    if(canonicalJson(envRecord.environment)!==canonicalJson(entry.environment)) throw new Error("weekly ERNIE environment checkpoint mismatch");
    z.object({version:z.literal("weekly-hrs-ernie-job/v1"),projectId:z.literal(binding.projectId),requestSha256:z.literal(requestSha256),
      environmentId:z.literal(entry.environment.id),jobId:z.literal(entry.jobId)}).strict().parse(await readJson(`${itemRoot}/job.json`));
    const resolved=await client.getEnvironment(entry.environment.id,"ernie-image-turbo");
    if(resolved.sha256!==entry.environment.sha256) throw new Error("weekly ERNIE environment digest changed");
    const job=await client.get(entry.jobId,entry.stage,entry.idempotencyKey,entry.environment),out=job.output;
    if(job.state!=="completed" || job.projectId!==binding.projectId || job.generation!==entry.generation ||
      !out || !out.available || out.bucket!==binding.outputBucket || out.projectId!==binding.projectId || out.jobId!==entry.jobId ||
      out.generation!==entry.generation || out.key!==`${binding.outputPrefix}jobs/${entry.jobId}/${entry.generation}/output.png` ||
      out.key!==entry.source.key || out.bucket!==entry.source.bucket || out.sha256!==entry.source.sha256 ||
      out.bytes!==entry.source.bytes || out.contentType!=="image/png" || entry.sha256!==out.sha256 || entry.byteLength!==out.bytes)
      throw new Error("weekly ERNIE source receipt mismatch");
    const bytes=await read(entry.stillKey,binding.outputBucket,{maxBytes:entry.byteLength,timeoutMs:300_000});
    const size=rasterImageDimensions(bytes);
    if(bytes.byteLength!==entry.byteLength || sha256BytesHex(bytes)!==entry.sha256 || size.contentType!=="image/png" || size.width!==1024 || size.height!==1024)
      throw new Error("weekly ERNIE retained bytes failed verification");
    items.push({shotId:entry.shotId,candidateIndex:entry.candidateIndex,outputId:entry.jobId,stillKey:entry.stillKey,
      sourceSha256:entry.sha256,sourceByteLength:entry.byteLength});
  }
  return StillRenderManifestSchema.parse({version:"1.0.0",generation:{contractVersion:"hrs-ernie/v1",profileId:input.profileId,
    model:"ernie-image-turbo",width:1024,height:1024,expectedPrecision:"bf16",expectedSteps:50,allowFallback:false},items});
}
