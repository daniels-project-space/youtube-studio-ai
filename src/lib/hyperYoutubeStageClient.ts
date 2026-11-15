import { createHash } from "node:crypto";
import { resolveHyperYoutubeProject } from "@/lib/hyperYoutubeProject";

/** Native HRS stages supported for the YouTube project. */
export type HyperYoutubeStage =
  | { modelId: "qwen3-tts"; inputs: { text:string; speaker:string; language?:string; instruct?:string }; seed?:number }
  | { modelId: "yue2"; inputs: { prompt:string; lyrics:string; abc?:string }; seed?:number }
  | { modelId: "ernie-image-turbo"; inputs: { prompt:string }; seed?:number };

export type HyperYoutubeJob = { id:string; projectId:string; modelId:string; state:string; generation:number;
  /** Caller-owned key; HRS accepts it on POST but does not echo it in publicJob(). */
  idempotencyKey:string; environmentId:string; environmentSha256:string;
  outputDestination:{bucket:string;projectPrefix:string};
  output?:{projectId:string;jobId:string;generation:number;bucket:string;key:string;sha256:string;
    bytes:number;contentType:string;available:boolean;downloadUrl:string|null}|null };
export type HyperYoutubeEnvironment = {id:string;modelId:string;sha256:string};
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const mediaTypes:Record<HyperYoutubeStage["modelId"],string> = {
  "qwen3-tts":"audio/wav", "yue2":"audio/flac", "ernie-image-turbo":"image/png",
};
const extensions:Record<string,string> = {"audio/wav":"wav","audio/flac":"flac","image/png":"png"};
type JsonObject=Record<string,unknown>;
function object(value:unknown,label:string):JsonObject {
  if (!value || typeof value!=="object" || Array.isArray(value)) throw new Error(`Invalid HRS ${label}`);
  return value as JsonObject;
}
function string(value:unknown,label:string):string {
  if (typeof value!=="string") throw new Error(`Invalid HRS ${label}`);
  return value;
}
function output(value:unknown):NonNullable<HyperYoutubeJob["output"]> {
  const item=object(value,"output receipt");
  const available=item.available;
  if (typeof available!=="boolean" || !Number.isSafeInteger(item.generation) ||
      !Number.isSafeInteger(item.bytes) || typeof item.downloadUrl!=="string" && item.downloadUrl!==null)
    throw new Error("Invalid HRS output receipt");
  return {projectId:string(item.projectId,"output project ID"),jobId:string(item.jobId,"output job ID"),
    generation:item.generation as number,bucket:string(item.bucket,"output bucket"),key:string(item.key,"output key"),
    sha256:string(item.sha256,"output digest"),bytes:item.bytes as number,
    contentType:string(item.contentType,"output content type"),available,downloadUrl:item.downloadUrl};
}
function parseJob(value:unknown):HyperYoutubeJob {
  const item=object(value,"job"),destination=object(item.outputDestination,"output destination");
  const result:HyperYoutubeJob={id:string(item.id,"job ID"),projectId:string(item.projectId,"project ID"),
    modelId:string(item.modelId,"model ID"),state:string(item.state,"job state"),
    generation:item.generation as number,idempotencyKey:"",environmentId:string(item.environmentId,"environment ID"),
    environmentSha256:"",
    outputDestination:{bucket:string(destination.bucket,"destination bucket"),
      projectPrefix:string(destination.projectPrefix,"destination prefix")}};
  if (!Number.isSafeInteger(result.generation) || result.generation<0) throw new Error("Invalid HRS job generation");
  if (item.output!==undefined) result.output=item.output===null?null:output(item.output);
  return result;
}

/** The caller owns its durable request key and persists the returned job ID. */
export function createHyperYoutubeStageClient(options:{baseUrl:string;projectId:string;projectToken:string;
  outputBucket:string;outputPrefix:string;fetch?:typeof fetch}) {
  const base = new URL(options.baseUrl);
  if (base.protocol !== "https:" || base.username || base.password || base.search || base.hash ||
      !uuid.test(options.projectId) || !options.projectToken || !options.outputBucket ||
      !options.outputPrefix.startsWith("projects/") || !options.outputPrefix.endsWith("/") ||
      options.outputPrefix.split("/").some(part => part === ".." || part === ".") || options.outputPrefix.includes("\\"))
    throw new Error("Invalid HRS YouTube project binding");
  const call = options.fetch ?? fetch;
  const root = `${base.toString().replace(/\/$/, "")}/api/v1/projects/${options.projectId}`;
  async function request(path:string, method:"GET"|"POST", body?:unknown):Promise<unknown> {
    const response = await call(root + path, {method,redirect:"error",signal:AbortSignal.timeout(30_000),
      headers:{authorization:`Bearer ${options.projectToken}`,accept:"application/json",...(body === undefined ? {} : {"content-type":"application/json"})},
      ...(body === undefined ? {} : {body:JSON.stringify(body)})});
    if (!response.ok) throw Object.assign(new Error(`HRS YouTube request failed (${response.status})`),{status:response.status});
    return await response.json() as unknown;
  }
  function validate(value:unknown, stage:HyperYoutubeStage, key:string):HyperYoutubeJob {
    const job=parseJob(value);
    if (!job || !uuid.test(job.id) || job.projectId !== options.projectId || job.modelId !== stage.modelId ||
        ("idempotencyKey" in object(value,"job") && object(value,"job").idempotencyKey !== undefined &&
          object(value,"job").idempotencyKey !== key) || !Number.isSafeInteger(job.generation) || job.generation < 0 ||
        job.outputDestination?.bucket !== options.outputBucket || job.outputDestination.projectPrefix !== options.outputPrefix)
      throw new Error("HRS job does not match the YouTube project request");
    job.idempotencyKey=key;
    return job;
  }
  async function environment(id:string,modelId:string):Promise<HyperYoutubeEnvironment> {
    if (!uuid.test(id)) throw new Error("Invalid HRS environment ID");
    const value=object(await request(`/environments/${id}`,"GET"),"environment");
    const sha256=string(value.sha256,"environment digest");
    if (value.id!==id || value.modelId!==modelId || !/^[a-f0-9]{64}$/.test(sha256))
      throw new Error("HRS environment does not match the requested model");
    return {id,modelId,sha256};
  }
  async function validateEnvironmentJob(value:unknown,stage:HyperYoutubeStage,key:string,
    expectedEnvironment?:HyperYoutubeEnvironment):Promise<HyperYoutubeJob> {
    const job=validate(value,stage,key);
    if (expectedEnvironment && (expectedEnvironment.modelId!==stage.modelId || !uuid.test(expectedEnvironment.id) ||
        !/^[a-f0-9]{64}$/.test(expectedEnvironment.sha256)))
      throw new Error("Invalid pinned HRS environment for the requested model");
    const resolved=expectedEnvironment ?? await environment(job.environmentId,stage.modelId);
    if (job.environmentId!==resolved.id) throw new Error("HRS job does not match its pinned environment");
    job.environmentSha256=resolved.sha256;
    return job;
  }
  async function createEnvironment(modelId:HyperYoutubeStage["modelId"]):Promise<HyperYoutubeEnvironment> {
    const created=object(await request("/environments","POST",{modelId,spec:{}}),"environment");
    const result={id:string(created.id,"environment ID"),modelId:string(created.modelId,"environment model ID"),
      sha256:string(created.sha256,"environment digest")};
    if (!uuid.test(result.id) || result.modelId!==modelId || !/^[a-f0-9]{64}$/.test(result.sha256))
      throw new Error("HRS environment does not match the requested model");
    return result;
  }
  return {
    createEnvironment: (modelId:HyperYoutubeStage["modelId"])=>createEnvironment(modelId),
    async getEnvironment(id:string,modelId:string):Promise<HyperYoutubeEnvironment> {
      return environment(id,modelId);
    },
    async submit(stage:HyperYoutubeStage, idempotencyKey:string, preparedEnvironment?:HyperYoutubeEnvironment):Promise<HyperYoutubeJob> {
      if (!idempotencyKey || idempotencyKey.length > 160 ||
          (stage.seed !== undefined && (!Number.isSafeInteger(stage.seed) || stage.seed < 0)))
        throw new Error("Invalid HRS stage identity or seed");
      const resolved=preparedEnvironment ?? await createEnvironment(stage.modelId);
      if (!uuid.test(resolved.id) || resolved.modelId!==stage.modelId || !/^[a-f0-9]{64}$/.test(resolved.sha256))
        throw new Error("HRS environment does not match the requested model");
      const job=await validateEnvironmentJob(await request("/jobs","POST",{environmentId:resolved.id,idempotencyKey,
        outputKind:"intermediate",finalRetention:"project-default",inputs:stage.inputs,
        settings:stage.seed === undefined ? {} : {seed:stage.seed},inputRefs:[]}),stage,idempotencyKey,
        resolved);
      if (job.environmentId!==resolved.id) throw new Error("HRS submitted job does not use its submitted environment");
      return job;
    },
    async get(id:string,stage:HyperYoutubeStage,idempotencyKey:string,expectedEnvironment?:HyperYoutubeEnvironment):Promise<HyperYoutubeJob> {
      if (!uuid.test(id)) throw new Error("Invalid HRS job ID");
      const job = await validateEnvironmentJob(await request(`/jobs/${id}`,"GET"),stage,idempotencyKey,expectedEnvironment);
      if (job.id !== id) throw new Error("HRS returned a different job");
      return job;
    },
    async download(job:HyperYoutubeJob,stage:HyperYoutubeStage,idempotencyKey:string,maxBytes=100_000_000):Promise<Buffer> {
      validate(job,stage,idempotencyKey);
      const out=job.output, expectedType=mediaTypes[stage.modelId];
      const expectedKey=`${options.outputPrefix}jobs/${job.id}/${job.generation}/output.${extensions[expectedType]}`;
      if (job.state !== "completed" || !out || out.available !== true || out.projectId !== options.projectId ||
          out.jobId !== job.id || out.generation !== job.generation || out.bucket !== options.outputBucket ||
          out.key !== expectedKey || out.contentType !== expectedType || !/^[a-f0-9]{64}$/.test(out.sha256) ||
          !Number.isSafeInteger(out.bytes) || out.bytes < 1 || out.bytes > maxBytes || !out.downloadUrl)
        throw new Error("HRS output is not a verified project receipt");
      const url=new URL(out.downloadUrl);
      if (url.protocol !== "https:" || url.username || url.password) throw new Error("Invalid HRS output URL");
      const response=await call(url,{method:"GET",redirect:"error",signal:AbortSignal.timeout(300_000)});
      if (!response.ok || !response.body) throw new Error("HRS output download failed");
      const chunks:Buffer[]=[]; let received=0; const reader=response.body.getReader();
      try { for (;;) { const part=await reader.read(); if (part.done) break; received+=part.value.byteLength;
        if (received>out.bytes) throw new Error("HRS output exceeds its receipt"); chunks.push(Buffer.from(part.value)); } }
      finally { await reader.cancel().catch(()=>undefined); }
      const bytes=Buffer.concat(chunks,received);
      if (received !== out.bytes || createHash("sha256").update(bytes).digest("hex") !== out.sha256)
        throw new Error("HRS output does not match its receipt");
      return bytes;
    },
  };
}

export function configuredHyperYoutubeStageClient() {
  let resolved:ReturnType<typeof resolveHyperYoutubeProject>|undefined;
  const binding=()=>resolved ??= resolveHyperYoutubeProject().catch(error=>{resolved=undefined;throw error;});
  const client=async()=>createHyperYoutubeStageClient(await binding());
  return {binding,createEnvironment:async(...args:Parameters<ReturnType<typeof createHyperYoutubeStageClient>["createEnvironment"]>)=>(await client()).createEnvironment(...args),
    getEnvironment:async(...args:Parameters<ReturnType<typeof createHyperYoutubeStageClient>["getEnvironment"]>)=>(await client()).getEnvironment(...args),
    submit:async(...args:Parameters<ReturnType<typeof createHyperYoutubeStageClient>["submit"]>)=>(await client()).submit(...args),
    get:async(...args:Parameters<ReturnType<typeof createHyperYoutubeStageClient>["get"]>)=>(await client()).get(...args),
    download:async(...args:Parameters<ReturnType<typeof createHyperYoutubeStageClient>["download"]>)=>(await client()).download(...args)};
}
