import { createHash } from "node:crypto";

/** Native HRS stages supported for the YouTube project. */
export type HyperYoutubeStage =
  | { modelId: "qwen3-tts"; inputs: { text:string; speaker:string; language?:string; instruct?:string }; seed?:number }
  | { modelId: "yue2"; inputs: { prompt:string; lyrics:string; abc?:string }; seed?:number }
  | { modelId: "ernie-image-turbo"; inputs: { prompt:string }; seed?:number };

type Job = { id:string; projectId:string; modelId:string; state:string; generation:number;
  idempotencyKey:string; outputDestination:{bucket:string;projectPrefix:string};
  output?:{projectId:string;jobId:string;generation:number;bucket:string;key:string;sha256:string;
    bytes:number;contentType:string;available:boolean;downloadUrl:string|null}|null };
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const mediaTypes:Record<HyperYoutubeStage["modelId"],string> = {
  "qwen3-tts":"audio/wav", "yue2":"audio/flac", "ernie-image-turbo":"image/png",
};
const extensions:Record<string,string> = {"audio/wav":"wav","audio/flac":"flac","image/png":"png"};

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
  async function request(path:string, method:"GET"|"POST", body?:unknown):Promise<any> {
    const response = await call(root + path, {method,redirect:"error",signal:AbortSignal.timeout(30_000),
      headers:{authorization:`Bearer ${options.projectToken}`,accept:"application/json",...(body === undefined ? {} : {"content-type":"application/json"})},
      ...(body === undefined ? {} : {body:JSON.stringify(body)})});
    if (!response.ok) throw Object.assign(new Error(`HRS YouTube request failed (${response.status})`),{status:response.status});
    return response.json();
  }
  function validate(job:Job, stage:HyperYoutubeStage, key:string):Job {
    if (!job || !uuid.test(job.id) || job.projectId !== options.projectId || job.modelId !== stage.modelId ||
        job.idempotencyKey !== key || !Number.isSafeInteger(job.generation) || job.generation < 0 ||
        job.outputDestination?.bucket !== options.outputBucket || job.outputDestination.projectPrefix !== options.outputPrefix)
      throw new Error("HRS job does not match the YouTube project request");
    return job;
  }
  return {
    async submit(stage:HyperYoutubeStage, idempotencyKey:string):Promise<Job> {
      if (!idempotencyKey || idempotencyKey.length > 160 ||
          (stage.seed !== undefined && (!Number.isSafeInteger(stage.seed) || stage.seed < 0)))
        throw new Error("Invalid HRS stage identity or seed");
      const environment = await request("/environments","POST",{modelId:stage.modelId,spec:{}});
      if (!uuid.test(environment.id) || environment.modelId !== stage.modelId)
        throw new Error("HRS environment does not match the requested model");
      return validate(await request("/jobs","POST",{environmentId:environment.id,idempotencyKey,
        outputKind:"intermediate",finalRetention:"project-default",inputs:stage.inputs,
        settings:stage.seed === undefined ? {} : {seed:stage.seed},inputRefs:[]}),stage,idempotencyKey);
    },
    async get(id:string,stage:HyperYoutubeStage,idempotencyKey:string):Promise<Job> {
      if (!uuid.test(id)) throw new Error("Invalid HRS job ID");
      const job = validate(await request(`/jobs/${id}`,"GET"),stage,idempotencyKey);
      if (job.id !== id) throw new Error("HRS returned a different job");
      return job;
    },
    async download(job:Job,stage:HyperYoutubeStage,idempotencyKey:string,maxBytes=100_000_000):Promise<Buffer> {
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
