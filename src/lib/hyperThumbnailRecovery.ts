import { canonicalJson } from "@/lib/canonicalJson";
import type {HyperThumbnailRequest,HyperThumbnailResult} from "@/lib/hyperThumbnailClient";
import { getObjectBytes, putObject } from "@/lib/storage";

export interface HyperThumbnailIntent {
  version:"hrs-thumbnail-intent/v1"; request:HyperThumbnailRequest;
  expectedReferenceHashes:Record<string,string>; expectedWords:string[];
  mode:"lofi-render-frame-native"|"native-scene-and-typography";
  estimatedGenerationCostUsd:number;
  estimatedImageCostUsd:number;
}
export interface RecoveryClient {
  get(request:HyperThumbnailRequest, hashes:Readonly<Record<string,string>>):Promise<HyperThumbnailResult|{state:string}>;
  download(result:HyperThumbnailResult,request:HyperThumbnailRequest,hashes:Readonly<Record<string,string>>):Promise<Buffer>;
}
export function hyperThumbnailIntentKey(root:string,requestHash:string) {
  if (!/^[a-f0-9]{64}$/.test(requestHash)) throw new Error("Invalid thumbnail intent identity");
  return `${root}/${requestHash}.hrs-intent.json`;
}
/** Persist the exact creative input before POST, with an immutable project-owned key. */
export async function persistHyperThumbnailIntent(key:string,intent:HyperThumbnailIntent):Promise<void> {
  const encoded = canonicalJson(intent);
  try { await putObject(key,Buffer.from(encoded),{contentType:"application/json",ifNoneMatch:"*"}); }
  catch (error) {
    try { if (Buffer.from(await getObjectBytes(key)).toString("utf8") === encoded) return; } catch { /* surface original */ }
    throw error;
  }
}
/** Read-only reattachment: this function never submits a candidate. */
export async function recoverHyperThumbnailIntent(args:{key:string;requestHash:string;client:RecoveryClient;
  read?:(key:string)=>Promise<Uint8Array>}) {
  const bytes = await (args.read ?? getObjectBytes)(args.key);
  if (bytes.length > 200_000) throw new Error("HRS thumbnail intent is too large");
  const raw = Buffer.from(bytes).toString("utf8"), intent = JSON.parse(raw) as HyperThumbnailIntent;
  if (canonicalJson(intent) !== raw || intent.version !== "hrs-thumbnail-intent/v1" ||
      intent.request?.candidateId !== args.requestHash || !Array.isArray(intent.expectedWords) ||
      !["lofi-render-frame-native","native-scene-and-typography"].includes(intent.mode) ||
      !intent.expectedReferenceHashes || typeof intent.expectedReferenceHashes !== "object" ||
      !Number.isFinite(intent.estimatedGenerationCostUsd) || intent.estimatedGenerationCostUsd < 0)
    throw new Error("Invalid HRS thumbnail recovery intent");
  if (!Number.isFinite(intent.estimatedImageCostUsd) || intent.estimatedImageCostUsd < 0 ||
      intent.estimatedImageCostUsd > intent.estimatedGenerationCostUsd) throw new Error("Invalid HRS thumbnail recovery estimate");
  const result = await args.client.get(intent.request,intent.expectedReferenceHashes);
  if (result.state !== "completed") return {state:result.state,intent};
  const complete = result as HyperThumbnailResult;
  const image = await args.client.download(complete,intent.request,intent.expectedReferenceHashes);
  return {state:"completed" as const,intent,result:complete,image};
}
