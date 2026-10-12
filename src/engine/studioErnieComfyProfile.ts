/** Installed native ERNIE reference-image graph; never used as a Z-Image replacement. */
export const STUDIO_ERNIE_REFERENCE_COMFY = {
  workflowId: "jn7fzvqf2nn087rhwtvhq75hjn8g4qx6",
  specificationSha256: "0658f2888e75213288d2e13be5989d9fc6f142cffa764fdf3014a2afd984abfb",
  sourceSha256: "f9e34be1e86c72ff190c48750a71beaf54535b4a535c118045cc054aaa8227ca",
  effectiveGraphSha256: "14deb458b2286782236665a436e738827a54ff5b3a47d0f667032632fa95b20b",
} as const;

export function studioErnieReferenceComfyProfile() {
  const negative = "watermark, logo, lettering, subtitles, malformed anatomy, extra limbs, duplicate subjects, blurry detail";
  const graph = {
    "1": { class_type: "UNETLoader", inputs: { unet_name: "ernie-image.safetensors", weight_dtype: "default" } },
    "2": { class_type: "CLIPLoader", inputs: { clip_name: "ministral-3-3b.safetensors", type: "flux2", device: "default" } },
    "3": { class_type: "VAELoader", inputs: { vae_name: "flux2-vae.safetensors" } },
    "4": { class_type: "CLIPTextEncode", inputs: { clip: ["2", 0], text: ["12", 0] } },
    "5": { class_type: "CLIPTextEncode", inputs: { clip: ["2", 0], text: negative } },
    "6": { class_type: "EmptyFlux2LatentImage", inputs: { width: 896, height: 1200, batch_size: 1 } },
    "7": { class_type: "KSampler", inputs: { model: ["1", 0], positive: ["4", 0], negative: ["5", 0],
      latent_image: ["6", 0], seed: "{{candidate.seed}}", steps: 50, cfg: 4, sampler_name: "euler", scheduler: "simple", denoise: 1 } },
    "8": { class_type: "VAEDecode", inputs: { samples: ["7", 0], vae: ["3", 0] } },
    "9": { class_type: "SaveImage", inputs: { images: ["8", 0], filename_prefix: "{{output.prefix}}" } },
    "10": { class_type: "CLIPLoader", inputs: { clip_name: "ernie-image-prompt-enhancer.safetensors", type: "flux2", device: "default" } },
    "11": { class_type: "TextGenerate", inputs: { clip: ["10", 0], prompt: "{{candidate.enhancer_instruction}}",
      max_length: 2048, sampling_mode: "on", "sampling_mode.temperature": 0.6, "sampling_mode.top_k": 64,
      "sampling_mode.top_p": 0.8, "sampling_mode.min_p": 0.05, "sampling_mode.repetition_penalty": 1.05,
      "sampling_mode.seed": 0, "sampling_mode.presence_penalty": 0, use_default_template: false } },
    "12": { class_type: "ErnieAttestEnhancedPrompt", inputs: { text: ["11", 0] } },
  };
  const models = ["diffusion_models/ernie-image.safetensors", "text_encoders/ministral-3-3b.safetensors",
    "text_encoders/ernie-image-prompt-enhancer.safetensors", "vae/flux2-vae.safetensors"].map(relativePath => ({
    category: relativePath.split("/")[0], provider: "jarvis", filesystemId: 3975,
    modelManifestSha256: "64686e89d2d844ea5e4547861afb2a3e99489aa64d523389567ebafc57293cbc",
    relativePath, runtimePath: `/home/jl_fs/ComfyUI/models/${relativePath}`,
  }));
  return { workflowName: "studio-ernie-character-reference-v1", profileId: "ernie-image", graph, models,
    settings: { "5": { text: negative }, "7": { steps: 50, cfg: 4 } }, loras: [] };
}
