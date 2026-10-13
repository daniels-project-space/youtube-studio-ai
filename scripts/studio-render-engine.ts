import { StudioRenderEngineClient, STUDIO_ENGINE_PROJECT, STUDIO_ENGINE_BUCKET, type StudioEngineAudioModel } from "../src/lib/studioRenderEngineClient";
import { executeStudioEngineAudio, type StudioEngineAudioRecovery } from "../src/lib/studioRenderEngineAudio";
import { readFile, writeFile, stat } from "node:fs/promises";
import { setTimeout } from "node:timers/promises";
import { studioErnieReferenceComfyProfile, STUDIO_ERNIE_REFERENCE_COMFY } from "../src/engine/studioErnieComfyProfile";
import { StudioZImageRequestSchema } from "../src/engine/studioZImageRequest";
import { createHash } from "node:crypto";
import { bootstrapSecrets } from "../src/lib/bootstrap";

function summarizeProfile(profile: Record<string, unknown>) {
  const summarizeAction = (value: unknown) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    const action = value as Record<string, unknown>;
    return Object.fromEntries(["owner", "code", "callerAction", "blockers"].flatMap((key) =>
      Object.hasOwn(action, key) ? [[key, action[key]]] : [],
    ));
  };
  const routes = Array.isArray(profile.sources) ? profile.sources.map((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    const route = value as Record<string, unknown>;
    return Object.fromEntries([
      "provider", "state", "dispatchable", "executorReady", "gpuCapacityFree", "blockers",
      "modelPresent", "runtimeInstalled", "finalQualified", "physicalRuntimeReady", "capacityState",
    ].flatMap((key) => Object.hasOwn(route, key) ? [[key, route[key]]] : []).concat(
      summarizeAction(route.nextAction) ? [["nextAction", summarizeAction(route.nextAction)]] : [],
    ));
  }).filter(Boolean) : undefined;
  return {
    profileId: profile.profileId,
    acceptsRequests: profile.acceptsRequests,
    executorReady: profile.executorReady,
    setupStatus: profile.setupStatus,
    admissionStatus: profile.admissionStatus,
    gpuCapacityFree: profile.gpuCapacityFree,
    routeResolutionOwner: profile.routeResolutionOwner,
    ...(summarizeAction(profile.nextAction) ? { nextAction: summarizeAction(profile.nextAction) } : {}),
    ...(routes ? { routes } : {}),
  };
}

async function main() {
  const [command, value, ...extra] = process.argv.slice(2);
  if (extra.length || !["inspect", "prepare-audio", "prepare-zimage", "stage-zimage", "observe", "render-audio", "register-comfy", "prepare-reference-comfy", "import-voice-reference"].includes(command)) {
    throw new Error("Usage: studio-render-engine.ts inspect | prepare-audio MODEL | prepare-zimage | stage-zimage REQUEST_JSON | observe JOB_ID | render-audio REQUEST_JSON | register-comfy SPEC_JSON | prepare-reference-comfy | import-voice-reference SOURCE_JSON");
  }
  await bootstrapSecrets(() => undefined, { services: ["render-engine"], required: ["RENDER_MANAGEMENT_API_KEY"] });
  const client = new StudioRenderEngineClient(process.env.RENDER_MANAGEMENT_API_KEY ?? "");
  if (command === "prepare-zimage") {
    console.log(JSON.stringify({ project: STUDIO_ENGINE_PROJECT, bucket: STUDIO_ENGINE_BUCKET, ...await client.prepareZImage() }));
  } else if (command === "stage-zimage") {
    const source = JSON.parse(await readFile(value, "utf8")), request = StudioZImageRequestSchema.parse(source.request);
    const requestSha256 = createHash("sha256").update(JSON.stringify(request)).digest("hex");
    const recoveryFile = `${value}.engine-admission.json`;
    let saved;
    try { saved = JSON.parse(await readFile(recoveryFile, "utf8")); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    if (saved) {
      if (saved.schema !== "studio-engine-zimage-admission/v1" || saved.workflowId !== source.workflowId ||
        saved.requestSha256 !== requestSha256 || saved.admission?.manifestSha256 !== requestSha256) throw new Error("Z-Image recovery input changed");
      console.log(JSON.stringify({ phase: "observed", ...await client.observeZImage(saved.admission, saved.workflowId) }));
    } else {
      const admission = await client.submitZImage(source.workflowId, request);
      await writeFile(recoveryFile, JSON.stringify({ schema: "studio-engine-zimage-admission/v1", workflowId: source.workflowId,
        requestSha256, admission }), { flag: "wx", mode: 0o600 });
      console.log(JSON.stringify({ phase: "staged-not-rendered", ...admission }));
    }
  } else if (command === "prepare-reference-comfy") {
    if (value !== undefined) throw new Error("Reference Comfy registration takes no override");
    const registered = await client.registerComfy(studioErnieReferenceComfyProfile());
    if (registered.workflowId !== STUDIO_ERNIE_REFERENCE_COMFY.workflowId ||
      registered.sourceSha256 !== STUDIO_ERNIE_REFERENCE_COMFY.sourceSha256 ||
      registered.specificationSha256 !== STUDIO_ERNIE_REFERENCE_COMFY.specificationSha256 ||
      registered.readback.effectiveGraphSha256 !== STUDIO_ERNIE_REFERENCE_COMFY.effectiveGraphSha256) {
      throw new Error("Registered Studio reference profile changed; revise its immutable version explicitly");
    }
    const modelFilesVerified = registered.readback.modelFilesVerified === true;
    console.log(JSON.stringify({
      phase: "registered-awaiting-live-dispatch-check",
      renderQualification: {
        executionReady: registered.executionReady,
        modelFilesVerified,
        dispatchNotAttempted: true,
      },
      ...registered,
    }));
  } else if (command === "import-voice-reference") {
    const source = JSON.parse(await readFile(value, "utf8"));
    if (!source || source.consentConfirmed !== true || typeof source.audioPath !== "string") {
      throw new Error("Voice reference import requires an owned audioPath and consentConfirmed: true");
    }
    const info = await stat(source.audioPath);
    if (!info.isFile() || info.size < 88_244 || info.size > 2_646_044) throw new Error("Invalid reference source size");
    const receipt = await client.importVoiceReference(await readFile(source.audioPath), {
      consentConfirmed: true, authorize: async () => undefined,
    });
    console.log(JSON.stringify(receipt));
  } else if (command === "register-comfy") {
    const registered = await client.registerComfy(JSON.parse(await readFile(value, "utf8")));
    console.log(JSON.stringify({
      phase: "registered-awaiting-live-dispatch-check",
      renderQualification: {
        executionReady: registered.executionReady,
        modelFilesVerified: registered.readback.modelFilesVerified === true,
        dispatchNotAttempted: true,
      },
      ...registered,
    }));
  } else if (command === "render-audio") {
    const input = JSON.parse(await readFile(value, "utf8"));
    const recoveryFile = `${value}.engine-admission.json`;
    let recovery: StudioEngineAudioRecovery | undefined;
    try { recovery = JSON.parse(await readFile(recoveryFile, "utf8")); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    const result = await executeStudioEngineAudio(input, { client, recovery,
      // Invoking this operator command with the management credential is the
      // manual submission authority. Pipeline callers must pass their live lease.
      authorize: async () => undefined,
      wait: async seconds => { await setTimeout(seconds * 1000); },
      onAccepted: async accepted => {
        if (!recovery) await writeFile(recoveryFile, JSON.stringify(accepted), { flag: "wx", mode: 0o600 });
        console.log(JSON.stringify({ phase: "accepted", ...accepted }));
      },
    });
    const { bytes, nativeArtifactBytes, ...receipt } = result;
    void bytes; void nativeArtifactBytes;
    console.log(JSON.stringify({ phase: "verified", ...receipt }));
  } else if (command === "prepare-audio") {
    const workflow = await client.prepareAudio(value as StudioEngineAudioModel);
    const storage = await client.modelStorage() as { profiles?: Record<string, unknown>[] };
    const profile = storage.profiles?.find((candidate) => candidate.profileId === value);
    if (!profile) throw new Error(`Engine model-storage has no ${value} profile`);
    const readiness = summarizeProfile(profile);
    console.log(JSON.stringify({
      project: STUDIO_ENGINE_PROJECT,
      bucket: STUDIO_ENGINE_BUCKET,
      model: value,
      phase: profile.executorReady === true ? "workflow-registered-awaiting-live-dispatch-check" : "workflow-registered-executor-not-ready",
      readiness,
      ...workflow,
    }));
  } else if (command === "observe") {
    console.log(JSON.stringify(await client.observe(value)));
  } else {
    const integration = await client.integration();
    if (!integration || typeof integration !== "object" || Array.isArray(integration)) throw new Error("Invalid integration response");
    const storage = await client.modelStorage();
    if (!storage || typeof storage !== "object" || !Array.isArray((storage as { profiles?: unknown }).profiles)) {
      throw new Error("Invalid Engine model storage response");
    }
    const profiles = (storage as { profiles: Record<string, unknown>[] }).profiles.map(summarizeProfile);
    console.log(JSON.stringify({ project: STUDIO_ENGINE_PROJECT, bucket: STUDIO_ENGINE_BUCKET,
      authenticated: true, sections: Object.keys(integration), profiles }));
  }
}
main().catch(() => { console.error("Studio Render Engine operation failed; no provider fallback or paid retry was attempted."); process.exitCode = 1; });
