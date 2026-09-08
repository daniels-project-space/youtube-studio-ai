/** Read-only inventory. Never creates/starts/stops GPUs or submits inference jobs. */
import { createHash } from "node:crypto";
import { loadEnvConfig } from "@next/env";
import { GetObjectCommand, ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import { bootstrapSecrets } from "../src/lib/bootstrap";
import { saladCloudClientFromVault, saladOccupiedGpuSlots, selectSaladGpu, type SaladGpuModel } from "../src/lib/saladCloud";

const bucket = "salad-render-infra";
const specs = [
  {
    route: "ernie-sft-3090", gpu: "RTX 3090" as SaladGpuModel,
    prefix: "ernie-image-sft-v1", manifestSha256: "4147d735ed0663a83460034da391f5a4c081aefef44ef2f37ad7163f7e275637",
    imageEnv: "SALAD_ERNIE_WORKER_IMAGE", cpu: 4, memoryMb: 32768, storageGiB: 48,
    qualifications: ["salad_3090_image_output_quality_unverified", "worker_job_deduplication_and_resume_unverified"],
    countryCodes: undefined as string[] | undefined,
  },
  {
    route: "music3-bf16-3090", gpu: "RTX 3090" as SaladGpuModel,
    prefix: "minimax-music3-bf16-v1", manifestSha256: "fde881bc3a6fe11fecb6c2211967038093766f9db2ca0c07e89e846117e1c32a",
    imageEnv: "SALAD_MUSIC3_WORKER_IMAGE", cpu: 8, memoryMb: 65536, storageGiB: 80,
    qualifications: ["full_bf16_3090_vram_fit_unverified", "worker_returns_wav_without_durable_r2_receipt", "salad_3090_music_quality_unverified"],
    countryCodes: undefined as string[] | undefined,
  },
  {
    route: "minimax-h3-turbo8-5090", gpu: "RTX 5090" as SaladGpuModel,
    prefix: "minimax-h3-turbo8-5090-v1", manifestSha256: "eca7ade81afd2edd4b912275a8657b9504cab71ca7e538aed7ce12f27acc90c9",
    imageEnv: "SALAD_H3_WORKER_IMAGE", cpu: 8, memoryMb: 131072, storageGiB: 100,
    qualifications: ["h3_license_scope_review_required", "salad_5090_native_turbo8_output_quality_unverified", "worker_job_deduplication_and_resume_unverified"],
    countryCodes: ["cn"],
  },
];

async function main() {
  loadEnvConfig(process.cwd());
  const salad = await saladCloudClientFromVault();
  await bootstrapSecrets(undefined, { services: ["cloudflare"], required: ["R2_ENDPOINT", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"] });
  const s3 = new S3Client({ region: "auto", endpoint: process.env.R2_ENDPOINT,
    credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID!, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY! } });
  const [gpuClasses, groups, quotas] = await Promise.all([salad.listGpuClasses(), salad.listContainerGroups(), salad.getQuotas()]);
  const instances = new Map(await Promise.all(groups.map(async (group) => [group.name, await salad.listContainerInstances(group.name)] as const)));
  const occupiedGpuSlots = saladOccupiedGpuSlots(groups, instances);
  const reports: Array<Record<string, unknown>> = [];
  for (const spec of specs) {
    const blockers = [...spec.qualifications];
    const key = `${spec.prefix}/immutable-manifest.json`;
    const gpu = selectSaladGpu(gpuClasses, spec.gpu);
    let manifestVerified = false;
    let modelFiles = 0;
    let modelBytes = 0;
    try {
      const object = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      if (!object.Body || !object.ContentLength || object.ContentLength > 1_000_000) throw new Error("invalid_manifest_size");
      const text = await object.Body.transformToString();
      if (createHash("sha256").update(text).digest("hex") !== spec.manifestSha256) throw new Error("manifest_hash_mismatch");
      const manifest = JSON.parse(text) as { route?: unknown; files?: unknown };
      if (manifest.route !== spec.route || !Array.isArray(manifest.files) || !manifest.files.length || manifest.files.length > 1000) throw new Error("manifest_contract_mismatch");
      const listed = await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: `${spec.prefix}/files/`, MaxKeys: 1000 }));
      if (listed.IsTruncated) throw new Error("model_listing_requires_pagination");
      const objects = new Map(listed.Contents?.map((item) => [item.Key, item.Size]));
      const seen = new Set<string>();
      for (const file of manifest.files) {
        if (!file || typeof file !== "object" || typeof file.key !== "string" || !file.key.startsWith(`${spec.prefix}/files/`)
          || /(?:^|\/)\.\.(?:\/|$)/.test(file.key) || seen.has(file.key)
          || !/^[a-f0-9]{64}$/.test(file.sha256) || !Number.isSafeInteger(file.bytes) || file.bytes <= 0
          || objects.get(file.key) !== file.bytes) throw new Error("model_file_missing_or_invalid");
        seen.add(file.key); modelFiles += 1; modelBytes += file.bytes;
      }
      manifestVerified = true;
    } catch {
      blockers.push("r2_manifest_or_file_inventory_not_verified");
    }
    const image = process.env[spec.imageEnv]?.trim();
    const imagePinned = !!image && /^[a-z0-9][a-z0-9./_-]+@sha256:[a-f0-9]{64}$/.test(image);
    if (!imagePinned) blockers.push("digest_pinned_worker_image_not_configured");
    else blockers.push("worker_registry_digest_and_runtime_receipt_not_verified");
    const availability = await salad.getGpuAvailability({
      cpu: spec.cpu, memory: spec.memoryMb, storage_amount: spec.storageGiB * 1024 ** 3, gpu_classes: [gpu.id],
    }, spec.countryCodes);
    if (availability.available_gpu_medium === undefined || availability.available_gpu_medium < 1) blockers.push("exact_medium_priority_gpu_capacity_unavailable");
    if (occupiedGpuSlots >= 3) blockers.push("global_three_gpu_capacity_full");
    if (quotas.container_groups_quotas.container_replicas_quota <= quotas.container_groups_quotas.container_replicas_used) blockers.push("salad_organization_replica_quota_full");
    reports.push({ route: spec.route, readyForPaidDispatch: false, modelInventory: {
      bucket, manifestKey: key, manifestSha256: spec.manifestSha256, manifestAndByteLengthsVerified: manifestVerified,
      modelFiles, modelBytes, note: "GPU worker must still verify every model file SHA-256 after hydration",
    }, imagePinned, gpu, resources: { cpu: spec.cpu, memoryMb: spec.memoryMb, storageGiB: spec.storageGiB, countryCodes: spec.countryCodes },
    availableMediumGpus: availability.available_gpu_medium ?? null, blockers });
  }
  reports.push({ route: "qwen3-tts-3090", readyForPaidDispatch: false,
    blockers: ["qwen_tts_r2_pack_not_located", "qwen_tts_salad_worker_image_not_located", "existing_youtube_qwen_receipt_is_novita_4090_only"] });
  console.log(JSON.stringify({ observedAt: new Date().toISOString(), mode: "read-only", gpuMutations: 0,
    organization: salad.organization, project: salad.project, priority: "medium", globalGpuLimit: 3,
    occupiedGpuSlots, providerQuota: quotas.container_groups_quotas, routes: reports }, null, 2));
}

void main().catch(() => {
  console.error("Salad preflight could not complete; check vault access, provider access and the pinned R2 inventory. No GPU mutation was requested.");
  process.exitCode = 1;
});
