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
import { StudioConvexHttpClient as ConvexHttpClient } from "@/lib/studioConvexHttpClient";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { bootstrapSecrets } from "@/lib/bootstrap";
import { claudeJson } from "@/lib/anthropic";
import { putObject } from "@/lib/storage";
import { sendMessage } from "@/lib/telegram";
import {
  requireInternalQuerySecret,
  requireYouTubeConnector,
} from "@/lib/youtubeConnector";
import { YOUTUBE_WRITE_SCOPES } from "@/lib/publishingPolicy";
import { enqueueFailedPipelineResume } from "@/trigger/publishRetry";
import { syncChannelPipelines } from "@/lib/goldenChannelSync";
import { listRunHistorySince } from "@/lib/runHistory";

const DAY = 86_400_000;

async function recoverPendingPublishContinuations(
  convex: ConvexHttpClient,
  ownerId: string,
  log: (m: string) => void,
): Promise<number> {
  const pending = await convex.query(api.runs.listPendingPublishContinuations, {
    ownerId,
    limit: 50,
  });
  const secret = requireInternalQuerySecret();
  let queued = 0;
  for (const run of pending) {
    const intentId = run.publishContinuationIntentId ?? run.blockedPublishIntentId;
    if (!intentId) {
      log(`publish continuation recovery skipped corrupt run ${run._id}: missing intent id`);
      continue;
    }
    try {
      const intent = await convex.query(api.publishIntents.get, {
        secret,
        intentId,
      });
      if (!intent) throw new Error(`publish intent not found: ${intentId}`);
      const resumed = await enqueueFailedPipelineResume(
        {
          ...intent,
          _id: String(intent._id),
          channelId: String(intent.channelId),
          runId: intent.runId ? String(intent.runId) : undefined,
        },
        {
          ...run,
          _id: String(run._id),
          channelId: String(run.channelId),
          blockedPublishIntentId: run.blockedPublishIntentId
            ? String(run.blockedPublishIntentId)
            : undefined,
          publishContinuationIntentId: run.publishContinuationIntentId
            ? String(run.publishContinuationIntentId)
            : undefined,
          planItemId: run.planItemId ? String(run.planItemId) : undefined,
        },
      );
      if (!resumed || !intent.runId || !intent.youtubeVideoId) {
        throw new Error("pending failed-run continuation did not produce an enqueue request");
      }
      await convex.mutation(api.runs.markPublishContinuationQueued, {
        ownerId,
        channelId: run.channelId,
        runId: run._id,
        intentId: intent._id,
        artifactId: intent.videoArtifactId,
        youtubeVideoId: intent.youtubeVideoId,
        triggerRunId: resumed.runId,
        queuedAt: Date.now(),
      });
      queued++;
      log(`publish continuation recovery queued ${run._id} (${resumed.runId})`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      try {
        if (
          run.blockedPublishIntentId &&
          run.blockedPublishArtifactId &&
          run.publishContinuationVideoId
        ) {
          await convex.mutation(api.runs.recordPublishContinuationEnqueueFailure, {
            ownerId,
            channelId: run.channelId,
            runId: run._id,
            intentId: run.blockedPublishIntentId,
            artifactId: run.blockedPublishArtifactId,
            youtubeVideoId: run.publishContinuationVideoId,
            error: message,
            failedAt: Date.now(),
          });
        }
      } catch (stateError) {
        log(
          `publish continuation recovery state write failed for ${run._id}: ${
            stateError instanceof Error ? stateError.message : String(stateError)
          }`,
        );
      }
      log(`publish continuation recovery failed for ${run._id}: ${message}`);
    }
  }
  return queued;
}

async function sweep(ownerId: string, log: (m: string) => void) {
  await bootstrapSecrets(log);
  const url = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
  if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL is not configured");
  const convex = new ConvexHttpClient(url);

  const channels = await convex.query(api.channels.listChannels, { ownerId });
  // Persist the exact catalog/compiler completion the runtime would otherwise
  // repeat on every invocation. This is deterministic and provider-free: it
  // preserves specialist choices, removes only proven retired rows, and never
  // spends model/render tokens.
  let channelPipelineSync = {
    checked: channels.length,
    changed: 0,
    applied: 0,
    conflicts: 0,
    verified: false,
    verification: "skipped" as "dry-run" | "skipped" | "verified",
  };
  try {
    const sync = await syncChannelPipelines({
      convex,
      ownerId,
      channels,
      verify: false,
      log: (message) => log(`pipeline sync: ${message}`),
    });
    channelPipelineSync = {
      checked: sync.checked,
      changed: sync.changed,
      applied: sync.applied,
      conflicts: sync.conflicts,
      verified: sync.verified,
      verification: sync.verification,
    };
  } catch (error) {
    log(
      `pipeline sync failed closed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  const failures: { channel: string; runId: string; error: string; at: number }[] = [];
  const healed: { channel: string; runId: string; superseded: string[] }[] = [];
  const retentionQueued: string[] = [];
  const missingCaps = new Map<string, string>();
  const publishCandidates: {
    channel: string;
    channelId: Id<"channels">;
    videoId: string;
    title: string;
    topic: string;
  }[] = [];
  // NEW EYES (2026-07): the Doctor used to be blind to (a) advisory QA data on
  // PASSED runs (low feel/audio/thumbnail scores living in qaReport), and
  // (b) the styleDNA groundingGaps the distiller explicitly deferred to it.
  const defectTrends = new Map<string, number>(); // defect class → occurrences across ok runs
  const groundingGapChannels: { channel: string; niche?: string; gaps: string[] }[] = [];
  let researchTriggered = 0;

  for (const ch of channels) {
    const report = (ch as { architectReport?: { missingCapabilities?: { name: string; description: string }[] } }).architectReport;
    for (const m of report?.missingCapabilities ?? []) missingCaps.set(m.name, m.description);

    // GROUNDING GAPS → repair action: a channel whose Style DNA recorded its
    // own thin grounding gets its niche research auto-refreshed (bounded per
    // sweep) so the next re-architect/distill pass has real evidence.
    try {
      const gaps = ((ch as { styleDNA?: { groundingGaps?: string[] } }).styleDNA?.groundingGaps ?? []).filter(Boolean);
      if (gaps.length) {
        const niche = (ch.identity as { niche?: string } | undefined)?.niche;
        groundingGapChannels.push({ channel: ch.name, niche, gaps: gaps.slice(0, 4) });
        if (niche && researchTriggered < 3) {
          await tasks.trigger("refresh-niche-research", { ownerId, niche, channelId: ch._id });
          researchTriggered++;
          log(`grounding repair: niche research queued for "${ch.name}" (${gaps.length} gap(s))`);
        }
      }
    } catch (e) {
      log(`grounding-gap check failed for ${ch.name}: ${e instanceof Error ? e.message : e}`);
    }

    // One indexed 60-day cursor feeds both the 72h diagnosis and 7–60d
    // retention pass. Typical channels fit one 100-row page; high-volume
    // channels paginate without ever asking Convex for an unbounded collect.
    const runs = await listRunHistorySince(convex, ch._id, Date.now() - 60 * DAY);
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
              channelId: ch._id,
              videoId: vid,
              title: String(sOut("metadata")["title"] ?? ""),
              topic: String(sOut("topic_select")["topic"] ?? ""),
            });
          }
          // ADVISORY MINING on PASSED runs: qa_visual's report carries the
          // signals that never gate (low thumbnail/seo scores, watch defects,
          // partial overlays). Recurring ones ARE the systemic defects — they
          // used to evaporate the moment the run passed.
          try {
            const qa = sOut("qa_visual")["qaReport"] as
              | {
                  thumbnail?: { score?: number };
                  seo?: { score?: number };
                  video?: { score?: number };
                  watch?: { defects?: { severity?: string; category?: string; issue?: string }[] };
                }
              | undefined;
            if (qa) {
              const bump = (k: string) => defectTrends.set(k, (defectTrends.get(k) ?? 0) + 1);
              if ((qa.thumbnail?.score ?? 10) < 6) bump(`${ch.name}: low thumbnail score`);
              if ((qa.seo?.score ?? 10) < 6) bump(`${ch.name}: low SEO score`);
              if ((qa.video?.score ?? 10) < 6) bump(`${ch.name}: low visual-frame score`);
              for (const d of qa.watch?.defects ?? []) {
                if (d.severity === "major" || d.severity === "critical") {
                  bump(`${ch.name}: watch ${String(d.category ?? d.issue ?? "defect").slice(0, 60)}`);
                }
              }
            }
            const ta = sOut("timeline_assemble");
            const dropped = Number(ta["overlaysDropped"] ?? 0);
            if (dropped > 0) defectTrends.set(`${ch.name}: overlays dropped at compose`, (defectTrends.get(`${ch.name}: overlays dropped at compose`) ?? 0) + dropped);
          } catch { /* advisory mining is best-effort */ }
        }
      } catch { /* stage read is best-effort */ }
    }

    // Retention sweep: published ok-runs past the 7-day lag with no durable
    // recommendation yet. Proposed/rejected recommendations both count as
    // analyzed, preventing daily re-billing while keeping active policy clean.
    const due = runs.filter(
      (r) =>
        r.status === "ok" &&
        Boolean(r.youtubeVideoId) &&
        (r._creationTime ?? 0) < Date.now() - 7 * DAY &&
        (r._creationTime ?? 0) > Date.now() - 60 * DAY,
    );
    let channelRetentionQueued = 0;
    for (const r of due) {
      if (channelRetentionQueued >= 2) break;
      try {
        const recommendationKey = `retention:${String(ch._id)}:${r.youtubeVideoId}`;
        const existing = await convex.query(api.learningGovernance.getByKey, {
          secret: requireInternalQuerySecret(),
          ownerId,
          recommendationKey,
        });
        if (existing) continue;
        await tasks.trigger("retention-analyst", { runId: r._id });
        retentionQueued.push(`${ch.name}:${r._id}`);
        channelRetentionQueued++;
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

  // Low-frequency durable outbox recovery. This only re-enqueues the exact
  // failed run; it never calls YouTube and reuses the same global idempotency
  // key as the immediate handoff.
  let publishContinuationsQueued = 0;
  try {
    publishContinuationsQueued = await recoverPendingPublishContinuations(
      convex,
      ownerId,
      log,
    );
  } catch (error) {
    log(
      `publish continuation recovery sweep failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  log(`sweep: ${failures.length} failure(s), ${healed.length} healed run(s), ${retentionQueued.length} retention job(s), ${publishContinuationsQueued} publish continuation(s), ${missingCaps.size} missing capability(ies)`);

  // ENGAGEMENT: post the owner HOOK-QUESTION comment on freshly PUBLIC videos
  // (an engagement signal the algorithm rewards). Dedupe = the channel already
  // commented. NOTE: pinning has no public API — pin manually in Studio.
  let commentsPosted = 0;
  if (process.env.STUDIO_ENGAGEMENT_AUTOMATION !== "on") {
    log("engagement: external comment automation disabled (set STUDIO_ENGAGEMENT_AUTOMATION=on to authorize)");
  } else try {
    const { getMyChannelId, getVideoPrivacy, hasChannelComment, postComment } = await import("@/lib/youtube");
    for (const pc of publishCandidates.slice(0, 10)) {
      if (commentsPosted >= 5) break;
      try {
        const connector = await requireYouTubeConnector(convex, {
          channelId: pc.channelId,
          ownerId,
          requiredScopes: YOUTUBE_WRITE_SCOPES,
        });
        const refreshToken = connector.refreshToken;
        const myId = await getMyChannelId(refreshToken);
        if (!myId) continue;
        if ((await getVideoPrivacy(pc.videoId, refreshToken)) !== "public") continue;
        if (await hasChannelComment(pc.videoId, myId, refreshToken)) continue;
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
            await postComment(pc.videoId, q.comment, refreshToken);
            commentsPosted++;
            log(`engagement: hook comment posted on ${pc.videoId} (${pc.channel}): "${q.comment.slice(0, 60)}"`);
          }
      } catch (e) {
        log(`engagement: ${pc.videoId} failed: ${e instanceof Error ? e.message : e}`);
      }
    }
  } catch (e) {
    log(`engagement sweep skipped: ${e instanceof Error ? e.message : e}`);
  }

  // Diagnosis — only when there is something to diagnose. Now includes the
  // advisory defect TRENDS from passed runs and the grounding gaps: quality
  // rot that never fails a run is exactly what the nightly meta-loop is for.
  const trendLines = [...defectTrends.entries()]
    .filter(([, n]) => n >= 2) // recurring only — one-offs are noise
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([k, n]) => `- ${k} ×${n}`);
  let diagnosis: { summary?: string; actions?: { priority?: string; kind?: string; detail?: string }[] } = {};
  if (failures.length || healed.length || missingCaps.size || trendLines.length || groundingGapChannels.length) {
    try {
      diagnosis = await claudeJson({
        maxTokens: 1400,
        temperature: 0.3,
        system: "You are the Pipeline Doctor for a YouTube automation studio. Return ONLY JSON.",
        prompt:
          `Nightly sweep of the render fleet.\n\n` +
          `FAILED RUNS (72h):\n${failures.map((f) => `- [${f.channel}] ${f.error}`).join("\n") || "none"}\n\n` +
          `SELF-HEALED RUNS (superseded blocks):\n${healed.map((h) => `- [${h.channel}] ${h.superseded.join(",")}`).join("\n") || "none"}\n\n` +
          `RECURRING ADVISORY DEFECTS on PASSED runs (quality rot that never gates):\n${trendLines.join("\n") || "none"}\n\n` +
          `CHANNELS WITH STYLE-DNA GROUNDING GAPS (research auto-queued):\n${groundingGapChannels.map((g) => `- ${g.channel}: ${g.gaps.join("; ")}`).join("\n") || "none"}\n\n` +
          `ARCHITECT MISSING CAPABILITIES (standing build queue):\n${[...missingCaps.keys()].join(", ") || "none"}\n\n` +
          `Diagnose: which failures are SYSTEMIC (same root cause recurring) vs one-off? Which failure classes have ` +
          `no heal rule and deserve one (quote the matching error text)? Which recurring heals indicate the defect ` +
          `should be fixed at the SOURCE block instead of healed every run? Which advisory trends have crossed from ` +
          `noise into a systemic quality defect? ` +
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
    defectTrends: Object.fromEntries(defectTrends),
    groundingGapChannels,
    researchTriggered,
    publishContinuationsQueued,
    channelPipelineSync,
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
  return { ok: true, reportKey: key, failures: failures.length, healedRuns: healed.length, retentionQueued: retentionQueued.length, publishContinuationsQueued, channelPipelineSync, commentsPosted, actions };
}

export const pipelineDoctorSchedule = schedules.task({
  id: "pipeline-doctor",
  // RE-ENABLED 2026-07-04: the Doctor is the root-cause loop — paused, every
  // defect class it exists to catch (advisory rot, grounding gaps, heal
  // treadmills) accumulated unseen. Daily, after learning-refresh (07:00).
  cron: "30 7 * * *",
  run: async () => sweep(process.env.STUDIO_OWNER_ID ?? "owner_daniel", (m) => console.log(`[doctor] ${m}`)),
});

/** Manual / on-demand sweep (same logic, operator-invokable). */
export const pipelineDoctorTask = task({
  id: "pipeline-doctor-now",
  maxDuration: 900,
  run: async (payload: { ownerId?: string }) =>
    sweep(payload.ownerId ?? process.env.STUDIO_OWNER_ID ?? "owner_daniel", (m) => console.log(`[doctor] ${m}`)),
});
