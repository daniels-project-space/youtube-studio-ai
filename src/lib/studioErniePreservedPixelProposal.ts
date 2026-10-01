import { generationProfile } from "@/engine/generationProfiles";
import { STUDIO_ERNIE_CONTRACT } from "@/lib/renderEngineErnieClient";

/** Input-shape evidence only. These sources do not qualify a provider, memory budget or Final output. */
export const ERNIE_DYNAMIC_GEOMETRY_SOURCE = {
  diffusers: {
    revision: "c60830ee365d520ab52b110dda562dd26f7b4d7f",
    sha256: "0ff565a8661b8d62f880dc72f13424c90a5837adb79a72f96a833072d45de18f",
    url: "https://github.com/huggingface/diffusers/blob/c60830ee365d520ab52b110dda562dd26f7b4d7f/src/diffusers/pipelines/ernie_image/pipeline_ernie_image.py",
    dimensionRule: "width and height divisible by the configured VAE scale factor; reference factor 16",
  },
  comfy: {
    revision: "e20d433a4966dcc88fa5abbae6ace824cb78b263",
    latentNodeSha256: "71c9d804a9acfb7a828fecb8fcc4b93e28f4417f0c4259a68910f4027059741f",
    nodesSha256: "918a322c43665f24513856a5bec6c564ede01a29b6081b83fd67d27a49571e0c",
    url: "https://github.com/Comfy-Org/ComfyUI/blob/e20d433a4966dcc88fa5abbae6ace824cb78b263/comfy_extras/nodes_flux.py",
    dimensionStep: 16, maximumDimension: 16_384,
    archiveRelationship: "upstream equivalent recorded in Engine ERNIE v2 source audit; latent node archive member not independently attested",
  },
} as const;

/**
 * Prepare an exact-size review candidate from the real editorial packet.
 * This proposal is not an accepted Engine request: the pinned v2 worker has a
 * preset whitelist and cannot execute it. Keep its hash and whitelist intact.
 */
export function buildStudioErniePreservedPixelProposal(args: {
  profileId: "production" | "hero";
  candidate: { id: string; prompt: string; seed: number };
  maxCostUsd: number;
}) {
  const { width, height } = generationProfile(args.profileId).image;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width % 16 || height % 16 ||
      width > ERNIE_DYNAMIC_GEOMETRY_SOURCE.comfy.maximumDimension || height > ERNIE_DYNAMIC_GEOMETRY_SOURCE.comfy.maximumDimension ||
      !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(args.candidate.id) || args.candidate.prompt.trim().length < 3 ||
      args.candidate.prompt.length > 20_000 || !Number.isSafeInteger(args.candidate.seed) || args.candidate.seed < 0 || args.candidate.seed > 0xffffffff ||
      !Number.isFinite(args.maxCostUsd) || args.maxCostUsd <= 0 || args.maxCostUsd > 1_000)
    throw new Error("Studio ERNIE preserved-pixel proposal is outside its exact input contract");
  const instruction = '<s>[SYSTEM_PROMPT]你是一个专业的文生图 Prompt 增强助手。你将收到用户的简短图片描述及目标生成分辨率，请据此扩写为一段内容丰富、细节充分的视觉描述，以帮助文生图模型生成高质量的图片。仅输出增强后的描述，不要包含任何解释或前缀。[/SYSTEM_PROMPT][INST]' +
    JSON.stringify({ prompt: args.candidate.prompt.trim(), width, height }) + '[/INST]';
  return {
    version: "studio-ernie-preserved-pixel-proposal/v1" as const,
    profileId: args.profileId,
    state: "awaiting-preserved-pixel-worker-and-final-qualification" as const,
    dispatchable: false as const,
    registered: false as const,
    finalQualified: false as const,
    candidate: { ...args.candidate, width, height },
    imageSettings: { width, height, steps: 50, cfg: 4, precision: "bf16", promptEnhancer: "ernie-native-v1",
      modelManifestSha256: STUDIO_ERNIE_CONTRACT.modelManifestSha256 },
    runtimeArgs: ["--bf16-unet"],
    currentWorker: { sha256: STUDIO_ERNIE_CONTRACT.workerSha256, acceptsGeometry: false },
    requiredBeforeAdmission: ["separate worker artifact and exact geometry parser registration", "real own-project R2 PNG and timing receipts", "reviewed Final image evidence for this geometry and provider", "measured execution within the existing cost cap"],
    maxCostUsd: args.maxCostUsd,
    sourceSupport: ERNIE_DYNAMIC_GEOMETRY_SOURCE,
    // Exact current native enhancer and SFT graph; only dimensions come from
    // the approved profile. Nothing submits this graph to a running worker.
    reviewGraph: {
      "10": { class_type: "CLIPLoader", inputs: { clip_name: "ernie-image-prompt-enhancer.safetensors", type: "flux2", device: "default" } },
      "11": { class_type: "TextGenerate", inputs: { clip: ["10", 0], prompt: instruction, max_length: 2048, sampling_mode: "on",
        "sampling_mode.temperature": 0.6, "sampling_mode.top_k": 64, "sampling_mode.top_p": 0.8, "sampling_mode.min_p": 0.05,
        "sampling_mode.repetition_penalty": 1.05, "sampling_mode.seed": 0, "sampling_mode.presence_penalty": 0, use_default_template: false } },
      "12": { class_type: "ErnieAttestEnhancedPrompt", inputs: { text: ["11", 0] } },
      "1": { class_type: "UNETLoader", inputs: { unet_name: "ernie-image.safetensors", weight_dtype: "default" } },
      "2": { class_type: "CLIPLoader", inputs: { clip_name: "ministral-3-3b.safetensors", type: "flux2", device: "default" } },
      "3": { class_type: "VAELoader", inputs: { vae_name: "flux2-vae.safetensors" } },
      "4": { class_type: "CLIPTextEncode", inputs: { clip: ["2", 0], text: ["12", 0] } },
      "5": { class_type: "CLIPTextEncode", inputs: { clip: ["2", 0], text: "" } },
      "6": { class_type: "EmptyFlux2LatentImage", inputs: { width, height, batch_size: 1 } },
      "7": { class_type: "KSampler", inputs: { model: ["1", 0], positive: ["4", 0], negative: ["5", 0], latent_image: ["6", 0],
        seed: args.candidate.seed, steps: 50, cfg: 4, sampler_name: "euler", scheduler: "simple", denoise: 1 } },
      "8": { class_type: "VAEDecode", inputs: { samples: ["7", 0], vae: ["3", 0] } },
      "9": { class_type: "SaveImage", inputs: { images: ["8", 0], filename_prefix: `ernie-review-${args.candidate.id}` } },
    },
  };
}
