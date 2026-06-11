/**
 * PIPELINE DOCTOR — the nightly meta-loop over everything the system produced.
 *
 * Every other loop works inside one run. The Doctor reads ACROSS runs:
 *  - failed runs since the last sweep → classifies what the healer could not
 *    fix (each unmatched failure is a heal-rule candidate, e.g. the Fish-429),
 *  - heal activity (superseded stages) → which defects keep recurring,
 *  - published videos past the 7-day metric lag → queues retention-analyst,
 *  - the architects' missingCapabilities → the standing build queue.
 * A diagnosis (Claude) turns it into a prioritized action list; the report is
 * persisted to R2 and summarized to Telegram. The Doctor PROPOSES — risky
 * changes stay operator decisions; the only thing it auto-fires is analysis.
 */
import { task, schedules, tasks } from "@trigger.dev/sdk";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { bootstrapSecrets } from "@/lib/bootstrap";
import { claudeJson } from "@/lib/anthropic";
import { putObject } from "@/lib/storage";
import { sendMessage } from "@/lib/telegram";

const DAY = 86_400_000;

async function sweep(ownerId: string, log: (m: string) => void) {
  await bootstrapSecrets(log, { required: ["ANTHROPIC_API_KEY"] });
  const url = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
  if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL is not configured");
  const convex = new ConvexHttpClient(url);

  const channels = await convex.query(api.channels.listChannels, { ownerId });
  const failures: { channel: string; runId: string; error: string; at: number }[] = [];
  const healed: { channel: string; runId: string; superseded: string[] }[] = [];
  const retentionQueued: string[] = [];
  const missingCaps = new Map<string, string>();
  const publishCandidates: { channel: string; videoId: string; title: string; topic: string }[] = [];

  for (const ch of channels) {
    const report = (ch as { architectReport?: { missingCapabilities?: { name: string; description: string }[] } }).architectReport;
    for (const m of report?.missingCapabilities ?? []) missingCaps.set(m.name, m.description);

    const runs = await convex.query(api.runs.listRunsByChannel, { channelId: ch._id });
    const recent = runs.filter((r) => (r._creationTime ?? 0) > Date.now() - 3 * DAY);

    for (const r of recent) {
      if (r.status === "failed") {
        failures.push({
          channel: ch.name,
          runId: r._id,
          error: String((r as { error?: string }).error ?? "").slice(0, 220),
          at: r._creationTime ?? 0,
        });
      }
      // Heal activity: superseded stages mark an in-run self-heal. Same pass
      // collects publish candidates for the engagement sweep below.
      try {
        const stages = await convex.query(api.runStages.listRunStages, { runId: r._id as Id<"runs"> });
        const sup = stages.filter((s: { status: string }) => s.status === "superseded").map((s: { block: string }) => s.block);
        if (sup.length) healed.push({ channel: ch.name, runId: r._id, superseded: [...new Set(sup)] as string[] });
        if (r.status === "ok") {
          const sOut = (block: string) =>
            (stages.find((s: { block: string; status: string }) => s.block === block && s.status === "ok") as
              | { outputs?: Record<string, unknown> }
              | undefined)?.outputs ?? {};
          const vid = String(sOut("upload_draft")["youtubeVideoId"] ?? "");
          if (vid) {
            publishCandidates.push({
              channel: ch.name,
              videoId: vid,
              title: String(sOut("metadata")["title"] ?? ""),
              topic: String(sOut("topic_select")["topic"] ?? ""),
            });
          }
        }
      } catch { /* stage read is best-effort */ }
    }

    // Retention sweep: published ok-runs past the 7-day lag, not yet analyzed.
    const analyzed = new Set(
      (((ch as { scriptPlaybook?: { retentionLearnings?: { runId?: string }[] } }).scriptPlaybook)?.retentionLearnings ?? [])
        .map((l) => l.runId)
        .filter(Boolean),
    );
    const due = runs.filter(
      (r) =>
        r.status === "ok" &&
        (r._creationTime ?? 0) < Date.now() - 7 * DAY &&
        (r._creationTime ?? 0) > Date.now() - 60 * DAY &&
        !analyzed.has(r._id),
    );
    for (const r of due.slice(0, 2)) {
      try {
        await tasks.trigger("retention-analyst", { runId: r._id });
        retentionQueued.push(`${ch.name}:${r._id}`);
      } catch (e) {
        log(`retention queue failed for ${r._id}: ${e instanceof Error ? e.message : e}`);
      }
    }

    // LEARNING → STRUCTURE: when real-audience evidence accumulates (≥3
    // high-confidence retention rules newer than the last architect pass),
    // re-run the architect so the data re-tunes pacing/inserts/structure —
    // not just the script playbook.
    try {
      const playbook = (ch as { scriptPlaybook?: { retentionLearnings?: { confidence?: string; at?: number }[] } }).scriptPlaybook;
      const lastArch = Number((ch as { architectReport?: { at?: number } }).architectReport?.at ?? 0);
      const freshHigh = (playbook?.retentionLearnings ?? []).filter(
        (l) => l.confidence === "high" && (l.at ?? 0) > lastArch,
      );
      if (freshHigh.length >= 3) {
        await tasks.trigger("architect-pipeline", { channelId: ch._id });
        log(`re-architect queued for "${ch.name}" — ${freshHigh.length} high-confidence retention rules since last pass`);
      }
    } catch (e) {
      log(`re-architect check failed for ${ch.name}: ${e instanceof Error ? e.message : e}`);
    }
  }

  log(`sweep: ${failures.length} failure(s), ${healed.length} healed run(s), ${retentionQueued.length} retention job(s), ${missingCaps.size} missing capability(ies)`);

  // ENGAGEMENT: post the owner HOOK-QUESTION comment on freshly PUBLIC videos
  // (an engagement signal the algorithm rewards). Dedupe = the channel already
  // commented. NOTE: pinning has no public API — pin manually in Studio.
  let commentsPosted = 0;
  try {
    const { getMyChannelId, getVideoPrivacy, hasChannelComment, postComment } = await import("@/lib/youtube");
    const myId = await getMyChannelId();
    if (myId) {
      for (const pc of publishCandidates.slice(0, 10)) {
        if (commentsPosted >= 5) break;
        try {
          if ((await getVideoPrivacy(pc.videoId)) !== "public") continue;
          if (await hasChannelComment(pc.videoId, myId)) continue;
          const q = await claudeJson<{ comment?: string }>({
            maxTokens: 200,
            temperature: 0.8,
            system: "You write ONE engaging creator comment. Return ONLY JSON.",
            prompt:
              `Video: "${pc.title || pc.topic}" (${pc.channel}). Write the channel's own pinned-style comment: ` +
              `ONE genuine discussion question viewers will want to answer (≤25 words, no hashtags, no emoji spam — ` +
              `max one emoji, no "smash subscribe"). Return STRICT JSON {"comment":string}.`,
          });
          if (q.comment) {
            await postComment(pc.videoId, q.comment);
            commentsPosted++;
            log(`engagement: hook comment posted on ${pc.videoId} (${pc.channel}): "${q.comment.slice(0, 60)}"`);
          }
        } catch (e) {
          log(`engagement: ${pc.videoId} failed: ${e instanceof Error ? e.message : e}`);
        }
      }
    }
  } catch (e) {
    log(`engagement sweep skipped: ${e instanceof Error ? e.message : e}`);
  }

  // Diagnosis — only when there is something to diagnose.
  let diagnosis: { summary?: string; actions?: { priority?: string; kind?: string; detail?: string }[] } = {};
  if (failures.length || healed.length || missingCaps.size) {
    try {
      diagnosis = await claudeJson({
        maxTokens: 1400,
        temperature: 0.3,
        system: "You are the Pipeline Doctor for a YouTube automation studio. Return ONLY JSON.",
        prompt:
          `Nightly sweep of the render fleet.\n\n` +
          `FAILED RUNS (72h):\n${failures.map((f) => `- [${f.channel}] ${f.error}`).join("\n") || "none"}\n\n` +
          `SELF-HEALED RUNS (superseded blocks):\n${healed.map((h) => `- [${h.channel}] ${h.superseded.join(",")}`).join("\n") || "none"}\n\n` +
          `ARCHITECT MISSING CAPABILITIES (standing build queue):\n${[...missingCaps.keys()].join(", ") || "none"}\n\n` +
          `Diagnose: which failures are SYSTEMIC (same root cause recurring) vs one-off? Which failure classes have ` +
          `no heal rule and deserve one (quote the matching error text)? Which recurring heals indicate the defect ` +
          `should be fixed at the SOURCE block instead of healed every run? ` +
          `Return STRICT JSON {"summary":string,"actions":[{"priority":"P0"|"P1"|"P2","kind":"heal_rule"|"source_fix"|"build_module"|"investigate","detail":string}]}.`,
      });
    } catch (e) {
      log(`diagnosis failed (report ships raw): ${e instanceof Error ? e.message : e}`);
    }
  }

  const report = {
    at: Date.now(),
    failures,
    healedRuns: healed,
    retentionQueued,
    missingCapabilities: Object.fromEntries(missingCaps),
    diagnosis,
  };
  const key = `doctor/${new Date().toISOString().slice(0, 10)}.json`;
  try {
    await putObject(key, Buffer.from(JSON.stringify(report, null, 2)), { contentType: "application/json" });
  } catch (e) {
    log(`report persist failed: ${e instanceof Error ? e.message : e}`);
  }

  // Telegram digest — only when there's signal (no 3am "all fine" spam).
  const actions = diagnosis.actions ?? [];
  if (failures.length || actions.length) {
    try {
      await sendMessage(
        [
          `🩺 Pipeline Doctor`,
          diagnosis.summary ? diagnosis.summary.slice(0, 350) : `${failures.length} failure(s), ${healed.length} heal(s).`,
          ...actions.slice(0, 5).map((a) => `• [${a.priority}] ${a.kind}: ${a.detail?.slice(0, 160)}`),
          retentionQueued.length ? `📈 ${retentionQueued.length} retention analysis job(s) queued` : "",
        ].filter(Boolean).join("\n"),
      );
    } catch (e) {
      log(`telegram digest failed: ${e instanceof Error ? e.message : e}`);
    }
  }
  return { ok: true, reportKey: key, failures: failures.length, healedRuns: healed.length, retentionQueued: retentionQueued.length, commentsPosted, actions };
}

export const pipelineDoctorSchedule = schedules.task({
  id: "pipeline-doctor",
  cron: "30 7 * * *", // daily, after learning-refresh (07:00) so metrics are settled
  run: async () => sweep(process.env.STUDIO_OWNER_ID ?? "owner_daniel", (m) => console.log(`[doctor] ${m}`)),
});

/** Manual / on-demand sweep (same logic, operator-invokable). */
export const pipelineDoctorTask = task({
  id: "pipeline-doctor-now",
  maxDuration: 900,
  run: async (payload: { ownerId?: string }) =>
    sweep(payload.ownerId ?? process.env.STUDIO_OWNER_ID ?? "owner_daniel", (m) => console.log(`[doctor] ${m}`)),
});
