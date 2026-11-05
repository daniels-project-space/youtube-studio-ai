import { createHash } from "node:crypto";
import { canonicalJson } from "@/lib/canonicalJson";

/** Project-scoped HRS contract; provider credentials remain in HRS. */
export interface HyperThumbnailRequest {
  candidateId:string; videoId:string; revision:number; title:string; hook:string; heroSubject:string;
  visualDirection:string; overlayText?:string; heroProp?:string; creativeDirection?:string;
  referenceAssets:{assetId:string;role:"source-frame"|"style"}[];
}
export interface HyperThumbnailReference {assetId:string;role:"source-frame"|"style";sha256:string;bytes:number;contentType:string}
export interface HyperThumbnailClientOptions {
  baseUrl:string; projectId:string; projectToken:string; outputBucket:string; outputPrefix:string;
  fetch?:typeof fetch;
}
/** Explicit project binding; never silently fall back to a different provider. */
export function configuredHyperThumbnailClient() {
  return createHyperThumbnailClient({baseUrl:process.env.HRS_YOUTUBE_BASE_URL ?? "",
    projectId:process.env.HRS_YOUTUBE_PROJECT_ID ?? "",projectToken:process.env.HRS_YOUTUBE_PROJECT_TOKEN ?? "",
    outputBucket:process.env.HRS_YOUTUBE_OUTPUT_BUCKET ?? "",outputPrefix:process.env.HRS_YOUTUBE_OUTPUT_PREFIX ?? ""});
}
export function hasConfiguredHyperThumbnailClient():boolean {
  try { configuredHyperThumbnailClient(); return true; } catch { return false; }
}
export interface HyperThumbnailResult {
  id:string; candidateId:string; projectId:string; videoId:string; revision:number; state:"completed";
  provider:"google-gemini-api"; modelId:"gemini-3-pro-image";
  settings:{aspectRatio:"16:9";imageSize:"2K"}; request:HyperThumbnailRequest;
  completedAt:string;
  requestSha256:string; referenceAssets:HyperThumbnailReference[]; sourceSha256:string|null;
  output:{bucket:string;key:string;sha256:string;bytes:number;contentType:"image/png";downloadUrl:string;expiresInSeconds:number};
}
export type HyperThumbnailStatus = HyperThumbnailResult | {
  id:string; candidateId:string; projectId:string; videoId:string; revision:number;
  state:"generating" | "uncertain" | "failed" | "output-expired";
  provider:"google-gemini-api"; modelId:"gemini-3-pro-image";
  failureCode?:string; retryable:false; nextAction:string;
};

/** One submission only: on an uncertain response the caller should inspect the same video/revision. */
export function createHyperThumbnailClient(options:HyperThumbnailClientOptions) {
  const base = new URL(options.baseUrl);
  if (base.protocol !== "https:" || base.username || base.password || base.search || base.hash)
    throw new Error("Invalid HRS base URL");
  if (!/^[a-f0-9-]{36}$/i.test(options.projectId) || !options.projectToken ||
      !options.outputBucket || !options.outputPrefix.startsWith("projects/") ||
      !options.outputPrefix.endsWith("/") || options.outputPrefix.includes(".."))
    throw new Error("Invalid HRS project binding");
  const call = options.fetch ?? fetch;
  const endpoint = `${base.toString().replace(/\/$/, "")}/api/v1/projects/${encodeURIComponent(options.projectId)}/youtube/thumbnail-candidates`;
  async function request(url:string, init:RequestInit) {
    const response = await call(url,{...init,headers:{...init.headers,authorization:`Bearer ${options.projectToken}`}});
    if (!response.ok) throw new Error(`HRS thumbnail request failed (${response.status}); inspect this video revision before retrying`);
    return response.json() as Promise<HyperThumbnailStatus>;
  }
  function verify(result:HyperThumbnailStatus, input:HyperThumbnailRequest):HyperThumbnailResult {
    if (result.state !== "completed") throw new Error("HRS thumbnail has no completed output");
    const out = result?.output;
    if (result?.projectId !== options.projectId || result.candidateId !== input.candidateId || result.videoId !== input.videoId || result.revision !== input.revision ||
        result.state !== "completed" || result.provider !== "google-gemini-api" || result.modelId !== "gemini-3-pro-image" ||
        typeof result.completedAt !== "string" || !Number.isFinite(Date.parse(result.completedAt)) || Date.parse(result.completedAt) <= 0 ||
        result.settings?.aspectRatio !== "16:9" || result.settings?.imageSize !== "2K" ||
        canonicalJson(result.request) !== canonicalJson(input) ||
        !/^[a-f0-9]{64}$/.test(result.requestSha256) || !Array.isArray(result.referenceAssets) ||
        !out || out.bucket !== options.outputBucket || !out.key.startsWith(options.outputPrefix) ||
        out.key.includes("..") || !/^[a-f0-9]{64}$/.test(out.sha256) || !Number.isSafeInteger(out.bytes) ||
        out.bytes < 1 || out.bytes > 25_000_000 || out.contentType !== "image/png" ||
        !Number.isFinite(out.expiresInSeconds) || out.expiresInSeconds <= 0)
      throw new Error("HRS thumbnail receipt does not match this project and request");
    const url = new URL(out.downloadUrl);
    if (url.protocol !== "https:" || url.username || url.password) throw new Error("Invalid HRS thumbnail download URL");
    const refs = result.referenceAssets;
    if (refs.length !== input.referenceAssets.length || refs.some((ref,index) => !ref ||
      ref.assetId !== input.referenceAssets[index]?.assetId || ref.role !== input.referenceAssets[index]?.role ||
      typeof ref.assetId !== "string" || !["source-frame","style"].includes(ref.role) ||
      !/^[a-f0-9]{64}$/.test(ref.sha256) || !Number.isSafeInteger(ref.bytes) || ref.bytes < 1 ||
      !["image/png","image/jpeg","image/webp"].includes(ref.contentType)) ||
      refs.filter(ref => ref.role === "source-frame").length > 1 ||
      result.sourceSha256 !== (refs.find(ref => ref.role === "source-frame")?.sha256 ?? null))
      throw new Error("Invalid HRS reference manifest");
    const identityHash = createHash("sha256").update(canonicalJson({provider:result.provider,modelId:result.modelId,
      settings:result.settings,candidateId:result.candidateId,request:result.request,referenceAssets:refs})).digest("hex");
    if (identityHash !== result.requestSha256) throw new Error("HRS thumbnail request hash mismatch");
    return result;
  }
  function checkReferenceHashes(result:HyperThumbnailResult,input:HyperThumbnailRequest,expected:Readonly<Record<string,string>>) {
    if (input.referenceAssets.some((ref,index) => !/^[a-f0-9]{64}$/.test(expected[ref.assetId] ?? "") ||
      result.referenceAssets[index]?.sha256 !== expected[ref.assetId])) throw new Error("HRS thumbnail reference hash mismatch");
  }
  return {
    async uploadReference(args:{bytes:Buffer;name:string;contentType:"image/png"|"image/jpeg"|"image/webp";idempotencyKey:string}) {
      if (!args.bytes.length || args.bytes.length > 8_000_000 || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(args.name) ||
          !args.idempotencyKey || args.idempotencyKey.length > 160) throw new Error("Invalid HRS reference upload");
      const sha256 = createHash("sha256").update(args.bytes).digest("hex");
      const assets = `${base.toString().replace(/\/$/, "")}/api/v1/projects/${encodeURIComponent(options.projectId)}/assets`;
      const response = await call(`${assets}/uploads`,{method:"POST",headers:{authorization:`Bearer ${options.projectToken}`,"content-type":"application/json"},
        body:JSON.stringify({sha256,bytes:args.bytes.length,name:args.name,contentType:args.contentType,kind:"intermediate",idempotencyKey:args.idempotencyKey})});
      if (!response.ok) throw new Error(`HRS reference upload allocation failed (${response.status})`);
      const upload = await response.json() as {assetId:string;bucket:string;key:string;verified:boolean;url?:string;headers?:Record<string,string>};
      if (!/^[a-f0-9-]{36}$/i.test(upload.assetId) || upload.bucket !== options.outputBucket ||
          !upload.key.startsWith(options.outputPrefix) || upload.key.includes("..")) throw new Error("Invalid HRS reference upload binding");
      if (!upload.verified) {
        if (!upload.url || Object.keys(upload.headers ?? {}).length !== 1 || upload.headers?.["if-none-match"] !== "*")
          throw new Error("HRS reference upload protection missing");
        const url = new URL(upload.url);
        if (url.protocol !== "https:" || url.username || url.password) throw new Error("Invalid HRS reference upload URL");
        const put = await call(url,{method:"PUT",redirect:"error",headers:{"content-type":args.contentType,"if-none-match":"*"},body:args.bytes as unknown as BodyInit});
        if (!put.ok && put.status !== 412) throw new Error(`HRS reference upload requires verification (${put.status})`);
        const verified = await call(`${assets}/${encodeURIComponent(upload.assetId)}/verify`,{method:"POST",headers:{authorization:`Bearer ${options.projectToken}`,"content-type":"application/json"},body:JSON.stringify({name:args.name})});
        if (!verified.ok) throw new Error(`HRS reference verification failed (${verified.status})`);
        const result = await verified.json() as {assetId:string;verified:boolean};
        if (result.assetId !== upload.assetId || result.verified !== true) throw new Error("HRS reference was not verified");
      }
      return {assetId:upload.assetId,sha256,bytes:args.bytes.length,contentType:args.contentType};
    },
    async submit(input:HyperThumbnailRequest, expectedReferenceHashes:Readonly<Record<string,string>> = {}) {
      if (input.referenceAssets.some(ref => !/^[a-f0-9]{64}$/.test(expectedReferenceHashes[ref.assetId] ?? "")))
        throw new Error("Every HRS thumbnail reference requires its verified source hash");
      const result = verify(await request(endpoint,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(input)}),input);
      checkReferenceHashes(result,input,expectedReferenceHashes);
      return result;
    },
    async get(input:HyperThumbnailRequest,expectedReferenceHashes:Readonly<Record<string,string>> = {}) {
      const result = await request(`${endpoint}/${encodeURIComponent(input.candidateId)}`,{method:"GET"});
      if (result.projectId !== options.projectId || result.candidateId !== input.candidateId || result.videoId !== input.videoId || result.revision !== input.revision ||
          result.provider !== "google-gemini-api" || result.modelId !== "gemini-3-pro-image" ||
          !["completed","generating","uncertain","failed","output-expired"].includes(result.state))
        throw new Error("HRS thumbnail status does not match this project and request");
      if (result.state !== "completed") return result;
      const verified = verify(result,input); checkReferenceHashes(verified,input,expectedReferenceHashes); return verified;
    },
    async download(result:HyperThumbnailResult,input:HyperThumbnailRequest,expectedReferenceHashes:Readonly<Record<string,string>> = {}) {
      checkReferenceHashes(result,input,expectedReferenceHashes);
      const {output} = verify(result,input);
      const response = await call(output.downloadUrl,{method:"GET",redirect:"error"});
      if (!response.ok) throw new Error(`HRS thumbnail download failed (${response.status})`);
      if (!response.body) throw new Error("HRS thumbnail download has no body");
      const reader = response.body.getReader(), chunks:Buffer[] = [];
      let received = 0;
      try {
        for (;;) {
          const part = await reader.read();
          if (part.done) break;
          received += part.value.byteLength;
          if (received > output.bytes) throw new Error("HRS thumbnail output exceeds receipt size");
          chunks.push(Buffer.from(part.value));
        }
      } finally { await reader.cancel().catch(() => undefined); }
      const bytes = Buffer.concat(chunks,received);
      if (bytes.length !== output.bytes || createHash("sha256").update(bytes).digest("hex") !== output.sha256)
        throw new Error("HRS thumbnail output hash mismatch");
      return bytes;
    },
  };
}
