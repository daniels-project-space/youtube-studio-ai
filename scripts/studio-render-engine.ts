import { StudioRenderEngineClient, STUDIO_ENGINE_PROJECT, STUDIO_ENGINE_BUCKET, type StudioEngineAudioModel } from "../src/lib/studioRenderEngineClient";
import { executeStudioEngineAudio, type StudioEngineAudioRecovery } from "../src/lib/studioRenderEngineAudio";
import { readFile, writeFile } from "node:fs/promises";
import { setTimeout } from "node:timers/promises";

async function main() {
  const [command, value, ...extra] = process.argv.slice(2);
  if (extra.length || !["inspect", "prepare-audio", "observe", "render-audio", "register-comfy"].includes(command)) {
    throw new Error("Usage: studio-render-engine.ts inspect | prepare-audio MODEL | observe JOB_ID | render-audio REQUEST_JSON | register-comfy SPEC_JSON");
  }
  const client = new StudioRenderEngineClient(process.env.RENDER_MANAGEMENT_API_KEY ?? "");
  if (command === "register-comfy") {
    const registered = await client.registerComfy(JSON.parse(await readFile(value, "utf8")));
    console.log(JSON.stringify(registered));
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
    console.log(JSON.stringify({ project: STUDIO_ENGINE_PROJECT, bucket: STUDIO_ENGINE_BUCKET, model: value, ...workflow }));
  } else if (command === "observe") {
    console.log(JSON.stringify(await client.observe(value)));
  } else {
    const integration = await client.integration();
    if (!integration || typeof integration !== "object" || Array.isArray(integration)) throw new Error("Invalid integration response");
    const storage = await client.modelStorage();
    if (!storage || typeof storage !== "object" || !Array.isArray((storage as { profiles?: unknown }).profiles)) {
      throw new Error("Invalid Engine model storage response");
    }
    const profiles = (storage as { profiles: Record<string, unknown>[] }).profiles.map(profile => ({
      profileId: profile.profileId, acceptsRequests: profile.acceptsRequests, executorReady: profile.executorReady,
    }));
    console.log(JSON.stringify({ project: STUDIO_ENGINE_PROJECT, bucket: STUDIO_ENGINE_BUCKET,
      authenticated: true, sections: Object.keys(integration), profiles }));
  }
}
main().catch(() => { console.error("Studio Render Engine operation failed; no provider fallback or paid retry was attempted."); process.exitCode = 1; });
