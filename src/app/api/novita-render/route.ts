import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { NextResponse } from "next/server";
import { z } from "zod";
import { generationProfile } from "@/engine/generationProfiles";
import {
  NOVITA_HARD_GPU_LIMIT,
  requireNovitaFleetReadiness,
  type NovitaFleetReadiness,
} from "@/lib/novitaFleet";
import {
  getNovitaRenderStatus,
  launchImages,
  launchVideo,
  toNovitaPhaseProfile,
  type NovitaBridgeStatus,
  type NovitaRenderCfg,
  type Shot,
} from "@/lib/novitaRenderFarm";
import {
  requireStudioActor,
  StudioAuthError,
} from "@/lib/operatorSession";
import { getOne } from "@/lib/vault";

/**
 * Operator-only control plane for the signed Novita bridge.
 *
 * POST compiles a browser shot list into one approved immutable generation
 * profile, signs it server-side, and returns the bridge job ID immediately.
 * GET polls that job ID and revalidates its approved profile before returning
 * status, or returns a sanitized live fleet attestation for `health=1`. No
 * provider credential, bridge URL, or bridge token reaches the browser.
 */
export const runtime = "nodejs";

const profileIdSchema = z.enum(["draft", "production", "hero"]);
const cameraMoveSchema = z.enum([
  "static",
  "dolly_push",
  "dolly_pull",
  "crane_up",
  "crane_down",
  "orbit_left",
  "orbit_right",
  "truck_left",
  "truck_right",
  "handheld_drift",
]);
const shotScaleSchema = z.enum([
  "wide",
  "medium",
  "close",
  "extreme_close",
  "establishing",
]);
const stillKeySchema = z.string().min(1).max(1024).refine(
  (value) =>
    /^[A-Za-z0-9][A-Za-z0-9._/-]*\.(?:png|jpe?g|webp)$/i.test(value) &&
    !value.split("/").some((part) => part === "." || part === ".."),
  "stillKey must be a safe image object key",
);
const shotSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/),
  prompt: z.string().trim().min(1).max(8_000),
  cameraMove: cameraMoveSchema,
  shotScale: shotScaleSchema,
  lens: z.string().trim().min(1).max(80),
  seconds: z.number().finite().min(1).max(30),
  motion: z.string().trim().max(8_000),
  negative: z.string().trim().max(8_000).optional(),
  seed: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
  stillKey: stillKeySchema.optional(),
}).strict();
const requestSchema = z.object({
  action: z.enum(["image", "video"]),
  profileId: profileIdSchema,
  shots: z.array(shotSchema).min(1).max(48),
  style: z.string().trim().max(8_000).optional(),
  negative: z.string().trim().max(8_000).optional(),
  director: z.string().trim().max(8_000).optional(),
  nshard: z.number().int().min(1).max(3),
}).strict();

const NOVITA_HEALTH_SECRET_KEYS = [
  "NOVITA_RENDER_FARM_API",
  "NOVITA_RENDER_FARM_TOKEN",
] as const;

async function novitaHealthCredentials(): Promise<{ baseUrl: string; token: string }> {
  const [rawBaseUrl, token] = await Promise.all(
    NOVITA_HEALTH_SECRET_KEYS.map(async (key) => {
      const configured = process.env[key]?.trim();
      return configured || (await getOne("novita", key)).trim();
    }),
  );
  if (!rawBaseUrl) throw new Error("Novita fleet health endpoint is not configured");
  if (!token || token.length < 32) throw new Error("Novita fleet health credential is invalid");

  const url = new URL(rawBaseUrl);
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(loopback && url.protocol === "http:")) {
    throw new Error("Novita fleet health endpoint must use HTTPS");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("Novita fleet health endpoint is invalid");
  }
  return { baseUrl: url.toString().replace(/\/$/, ""), token };
}

function sanitizedFleetHealth(readiness: NovitaFleetReadiness) {
  const attestation = readiness.attestation;
  if (!attestation) throw new Error("Novita fleet attestation is unavailable");

  return {
    ok: true,
    ready: readiness.ready,
    checkedAt: new Date().toISOString(),
    architecturalGpuCeiling: NOVITA_HARD_GPU_LIMIT,
    verifiedGpuQuota: attestation.provider.verifiedGpuQuota,
    effectiveGpuLimit: readiness.effectiveGpuLimit,
    activeGpuCount: attestation.provider.activeInstanceCount,
    blockers: readiness.blockers,
    contract: {
      version: attestation.contractVersion,
      dispatchReady: attestation.dispatchReady,
      workerImageReady: attestation.registry.authConfigured && attestation.registry.imagePrewarmed,
    },
    models: {
      gemma: {
        name: attestation.models.gemma.model,
        localCacheVerified: attestation.models.gemma.localCacheVerified,
      },
      zImage: {
        name: attestation.models.zImage.model,
        localCacheVerified: attestation.models.zImage.localCacheVerified,
      },
      ltx: {
        name: attestation.models.ltx.model,
        localCacheVerified: attestation.models.ltx.localCacheVerified,
        twoStageHqVerified: attestation.models.ltx.twoStageHqVerified,
      },
    },
    storage: {
      persistentModelVolumeVerified:
        attestation.storage.volumeName === "ai-infra-models" &&
        attestation.storage.volumeSizeGb > 0 &&
        /^[a-f0-9]{64}$/.test(attestation.storage.modelManifestSha256),
      volumeSizeGb: attestation.storage.volumeSizeGb,
    },
    controls: {
      capacityAwareWaves: attestation.controls.capacityAwareWaves,
      r2CheckpointRecovery:
        attestation.controls.checkpointStore === "r2" &&
        attestation.controls.interruptionRecovery,
      idleShutdownSeconds: attestation.controls.idleShutdownSeconds,
      verifiedReaper:
        attestation.controls.reaperEnabled && attestation.controls.deleteVerification,
      statusBatchSeconds: attestation.controls.statusBatchSeconds,
    },
  };
}

function sanitizedHealthBlockers(error: unknown): string[] {
  const message = error instanceof Error ? error.message : "";
  const suffix = message.match(/not production-ready:\s*([a-z0-9_,]+)/i)?.[1];
  const blockers = suffix
    ?.split(",")
    .filter((blocker) => /^[a-z0-9_]+$/.test(blocker));
  return blockers?.length ? blockers : ["fleet_readiness_unavailable"];
}

async function renderFleetHealth() {
  try {
    const credentials = await novitaHealthCredentials();
    const readiness = await requireNovitaFleetReadiness(credentials);
    return NextResponse.json(sanitizedFleetHealth(readiness), {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      ready: false,
      checkedAt: new Date().toISOString(),
      architecturalGpuCeiling: NOVITA_HARD_GPU_LIMIT,
      verifiedGpuQuota: null,
      effectiveGpuLimit: null,
      activeGpuCount: null,
      blockers: sanitizedHealthBlockers(error),
      contract: null,
      models: null,
      storage: null,
      controls: null,
    }, {
      status: 503,
      headers: { "cache-control": "no-store" },
    });
  }
}

export async function POST(request: Request) {
  try {
    await requireStudioActor(request);
    const parsed = requestSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: "invalid render request", issues: parsed.error.issues },
        { status: 400 },
      );
    }

    const input = parsed.data;
    const profile = generationProfile(input.profileId);
    const cfg: NovitaRenderCfg = {
      prefix: `novita-render-console/${randomUUID()}`,
      shots: input.shots as Shot[],
      profile: toNovitaPhaseProfile(profile, input.action),
      style: input.style,
      negative: input.negative,
      director: input.director,
      nshard: input.nshard,
      maxConcurrent: input.nshard,
      jobs: "full",
    };
    const launch = input.action === "image"
      ? await launchImages(cfg)
      : await launchVideo(cfg);

    return NextResponse.json({
      ok: true,
      jobId: launch.jobId,
      phase: launch.phase,
      profileId: input.profileId,
      status: "queued",
    }, { status: 202 });
  } catch (error) {
    return renderError(error, "render launch failed");
  }
}

export async function GET(request: Request) {
  try {
    await requireStudioActor(request);
    const { searchParams } = new URL(request.url);
    if (searchParams.get("health") === "1") return renderFleetHealth();

    const jobId = z.string().regex(/^(image|video)-[a-f0-9]{32}$/).safeParse(searchParams.get("jobId"));
    const profileId = profileIdSchema.safeParse(searchParams.get("profileId"));
    if (!jobId.success || !profileId.success) {
      return NextResponse.json({ ok: false, error: "invalid render status query" }, { status: 400 });
    }

    const status = await getNovitaRenderStatus(jobId.data);
    const expectedProfile = toNovitaPhaseProfile(
      generationProfile(profileId.data),
      status.phase,
    );
    if (!isDeepStrictEqual(status.profile, expectedProfile)) {
      throw new Error("render status profile does not match the requested immutable profile");
    }
    validateTerminalStatus(status);
    return NextResponse.json(status);
  } catch (error) {
    return renderError(error, "render status request failed");
  }
}

function validateTerminalStatus(status: NovitaBridgeStatus): void {
  if (status.status !== "done") return;
  const outputs = status.phase === "image" ? status.stillKeys : status.footageKeys;
  if (
    status.ok !== true ||
    status.failedIds.length > 0 ||
    status.missingKeys.length > 0 ||
    !outputs ||
    status.n_outputs !== status.n_jobs ||
    outputs.length !== status.n_jobs ||
    new Set(outputs).size !== status.n_jobs ||
    new Set(status.expectedKeys).size !== status.n_jobs ||
    outputs.some((key) => !status.expectedKeys.includes(key))
  ) {
    throw new Error(`render job ${status.jobId} reported an incomplete terminal result`);
  }
}

function renderError(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : fallback;
  const status = error instanceof StudioAuthError
    ? error.status
    : message.includes("validate(")
      ? 400
      : 502;
  return NextResponse.json({ ok: false, error: message }, { status });
}
