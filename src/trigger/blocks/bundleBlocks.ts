/**
 * `emit_bundle` — render-group reuse. On a GROUP BASE channel's run, after the base
 * video is uploaded, persist the reusable assets (footage clips + music + the
 * script/topic) to a DURABLE group-bundle path in R2 (the run prefix gets cleaned;
 * this path does not), then fan out a localized run to each language sibling that
 * reuses those assets. Sibling runs only redo narration/captions/text/metadata.
 *
 * No-op (bundleEmitted:false) for ungrouped channels and for siblings.
 */
import type { Block, StageContext } from "@/engine/types";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { putObject, getObjectBytes } from "@/lib/storage";
import { readBytes } from "@/lib/files";

function convex(): ConvexHttpClient {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
  if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL is not configured");
  return new ConvexHttpClient(url);
}

export const emitBundle: Block = {
  id: "emit_bundle",
  consumes: [], // tolerant: reads what's present (narrated has footage+script; lofi differs)
  produces: ["bundleEmitted"],
  run: async (ctx: StageContext) => {
    const c = convex();
    const channel = await c
      .query(api.channels.getChannel, { channelId: ctx.channelId as Id<"channels"> })
      .catch(() => null);
    const groupId = channel?.groupId;
    if (!channel || !groupId || channel.groupRole !== "base") {
      return { bundleEmitted: false };
    }

    const topic = ctx.store["topic"] as string | undefined;
    const script = ctx.store["script"];
    const narrationText = ctx.store["narrationText"] as string | undefined;
    const musicKey = ctx.store["musicKey"] as string | undefined;
    const footageClips = (ctx.store["footageClips"] as string[] | undefined) ?? [];
    const bundleDir = `owner/${ctx.ownerId}/group/${groupId}/bundle/${ctx.runId}/`;

    // Persist footage clips (local → durable R2). These survive run cleanup.
    const footageKeys: string[] = [];
    for (let i = 0; i < footageClips.length; i++) {
      try {
        const key = `${bundleDir}clip_${i}.mp4`;
        await putObject(key, await readBytes(footageClips[i]), { contentType: "video/mp4" });
        footageKeys.push(key);
      } catch (e) {
        ctx.log(`emit_bundle: footage ${i} copy failed: ${e instanceof Error ? e.message : e}`);
      }
    }
    // Copy the music track into the durable bundle path.
    let durableMusicKey: string | undefined;
    if (musicKey) {
      try {
        durableMusicKey = `${bundleDir}music.mp3`;
        await putObject(durableMusicKey, await getObjectBytes(musicKey), { contentType: "audio/mpeg" });
      } catch (e) {
        ctx.log(`emit_bundle: music copy failed: ${e instanceof Error ? e.message : e}`);
        durableMusicKey = musicKey; // fall back to the run key (best-effort)
      }
    }

    const bundle = { baseRunId: ctx.runId, topic, script, narrationText, footageKeys, musicKey: durableMusicKey };
    try {
      await putObject(`${bundleDir}bundle.json`, new TextEncoder().encode(JSON.stringify(bundle)), {
        contentType: "application/json",
      });
    } catch (e) {
      ctx.log(`emit_bundle: bundle.json write failed: ${e instanceof Error ? e.message : e}`);
    }

    // Fan out a localized, asset-reusing run to each sibling.
    let fanned = 0;
    try {
      const { tasks } = await import("@trigger.dev/sdk");
      const group = await c.query(api.channels.listGroup, { groupId });
      // Only ACTIVE siblings — a draft/disabled sibling (e.g. YouTube not yet
      // connected) shouldn't burn a render that would fail at upload. Enable a
      // sibling (Settings → ON) once it's ready and the next base run fans out to it.
      const siblings = group.filter((g) => g.groupRole === "sibling" && g.status === "active");
      for (const sib of siblings) {
        try {
          const runId = await c.mutation(api.runs.createRun, { ownerId: ctx.ownerId, channelId: sib._id });
          await tasks.trigger("run-pipeline", {
            channelId: sib._id,
            runId,
            reuse: { language: sib.language ?? "en", topic, script, footageKeys, musicKey: durableMusicKey },
          }, { concurrencyKey: String(sib._id) }); // per-channel queue; siblings render in parallel
          fanned++;
        } catch (e) {
          ctx.log(`emit_bundle: fan-out to ${sib.slug} failed: ${e instanceof Error ? e.message : e}`);
        }
      }
    } catch (e) {
      ctx.log(`emit_bundle: fan-out skipped: ${e instanceof Error ? e.message : e}`);
    }

    ctx.log(`emit_bundle: ${footageKeys.length} clips + music persisted; fanned out ${fanned} sibling run(s)`);
    return { bundleEmitted: true };
  },
};
