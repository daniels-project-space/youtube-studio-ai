import { createHash } from "node:crypto";
import { canonicalJson } from "@/lib/canonicalJson";
import type {HyperThumbnailReference,HyperThumbnailRequest,HyperThumbnailResult} from "@/lib/hyperThumbnailClient";

/** Durable provenance deliberately excludes the short-lived signed download URL. */
export interface HyperThumbnailEvidence {
  version:"thumbnail-hrs-pro-evidence/v1"; requestContext:string; mode:"native-scene-and-typography"|"lofi-render-frame-native";
  request:HyperThumbnailRequest; projectId:string; provider:"google-gemini-api"; modelId:"gemini-3-pro-image";
  settings:{aspectRatio:"16:9";imageSize:"2K"}; requestSha256:string; referenceAssets:HyperThumbnailReference[];
  sourceSha256:string|null; output:{bucket:string;key:string;sha256:string;bytes:number;contentType:"image/png"};
  receipt:{route:"hrs-gemini-nano-banana-pro";providerRequestSha256:string;responseSha256:string;costUsd:number;accounting:"estimate"};
  expectedWords:readonly string[]; backgroundSsim?:number;
}
export function createHyperThumbnailEvidence(args:{result:HyperThumbnailResult;requestContext:string;
  mode:HyperThumbnailEvidence["mode"];expectedWords:readonly string[];estimatedCostUsd:number;backgroundSsim?:number}):HyperThumbnailEvidence {
  const {result} = args, {bucket,key,sha256,bytes,contentType} = result.output;
  return {version:"thumbnail-hrs-pro-evidence/v1",requestContext:args.requestContext,mode:args.mode,
    projectId:result.projectId,provider:result.provider,modelId:result.modelId,settings:result.settings,
    request:result.request,requestSha256:result.requestSha256,referenceAssets:result.referenceAssets,
    sourceSha256:result.sourceSha256,output:{bucket,key,sha256,bytes,contentType},expectedWords:args.expectedWords,
    receipt:{route:"hrs-gemini-nano-banana-pro",providerRequestSha256:result.requestSha256,responseSha256:sha256,
      costUsd:args.estimatedCostUsd,accounting:"estimate"},
    ...(args.backgroundSsim === undefined ? {} : {backgroundSsim:args.backgroundSsim})};
}
export function validHyperThumbnailEvidence(value:unknown,requestHash:string):value is HyperThumbnailEvidence {
  try {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const e = value as HyperThumbnailEvidence, r = e.request, out = e.output;
    const context = JSON.parse(e.requestContext) as Record<string,unknown>;
    const sha = /^[a-f0-9]{64}$/;
    if (e.version !== "thumbnail-hrs-pro-evidence/v1" || canonicalJson(context) !== e.requestContext ||
        context.contractVersion !== "thumbnail-gen-nano-banana-context/v1" || context.requestHash !== requestHash ||
        typeof context.keyPrefix !== "string" || !context.keyPrefix || typeof context.runId !== "string" || !context.runId ||
        e.provider !== "google-gemini-api" || e.modelId !== "gemini-3-pro-image" ||
        e.settings?.aspectRatio !== "16:9" || e.settings?.imageSize !== "2K" ||
        typeof e.projectId !== "string" || !/^[a-f0-9-]{36}$/i.test(e.projectId) || !r || r.candidateId !== requestHash ||
        !Array.isArray(r.referenceAssets) || !Array.isArray(e.referenceAssets) || r.referenceAssets.length !== e.referenceAssets.length ||
        !e.referenceAssets.every((ref,index) => ["source-frame","style"].includes(ref.role) && ref.assetId === r.referenceAssets[index]?.assetId && ref.role === r.referenceAssets[index]?.role &&
          sha.test(ref.sha256) && Number.isSafeInteger(ref.bytes) && ref.bytes > 0 && /^image\/(png|jpeg|webp)$/.test(ref.contentType)) ||
        e.referenceAssets.filter(ref => ref.role === "source-frame").length > 1 ||
        e.sourceSha256 !== (e.referenceAssets.find(ref => ref.role === "source-frame")?.sha256 ?? null) ||
        !out || !out.bucket || !out.key.startsWith("projects/") || out.key.includes("..") || !sha.test(out.sha256) ||
        !Number.isSafeInteger(out.bytes) || out.bytes < 1 || out.bytes > 25_000_000 || out.contentType !== "image/png" ||
        e.receipt?.route !== "hrs-gemini-nano-banana-pro" || e.receipt.providerRequestSha256 !== e.requestSha256 ||
        e.receipt.responseSha256 !== out.sha256 || e.receipt.accounting !== "estimate" ||
        !Number.isFinite(e.receipt.costUsd) || e.receipt.costUsd < 0 ||
        !Array.isArray(e.expectedWords) || !e.expectedWords.length || !e.expectedWords.every(word => typeof word === "string" && !!word.trim() && word.length <= 64 &&
          typeof r.creativeDirection === "string" && r.creativeDirection.toUpperCase().includes(word.toUpperCase()))) return false;
    if (e.mode === "lofi-render-frame-native") {
      if (!e.sourceSha256 || e.expectedWords.length !== 1 || e.expectedWords[0] !== "4K" ||
          !Number.isFinite(e.backgroundSsim) || e.backgroundSsim! < 0 || e.backgroundSsim! > 1) return false;
    } else if (e.mode !== "native-scene-and-typography" || e.sourceSha256 !== null || e.backgroundSsim !== undefined) return false;
    const calculated = createHash("sha256").update(canonicalJson({provider:e.provider,modelId:e.modelId,
      settings:e.settings,candidateId:r.candidateId,request:r,referenceAssets:e.referenceAssets})).digest("hex");
    return calculated === e.requestSha256;
  } catch { return false; }
}
