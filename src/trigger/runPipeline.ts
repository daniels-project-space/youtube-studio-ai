/**
 * `run-pipeline` Trigger task (MASTER-PLAN §D).
 *
 * Input: { channelId, runId }. It:
 *   1. loads the channel from Convex,
 *   2. resolves + validates its pipeline (topological consumes/produces),
 *   3. preflights (budget + required keys),
 *   4. runs the blocks via the engine runner, writing a runStage per block
 *      (Convex-backed sink), and
 *   5. marks the run ok/failed and fires a Telegram alert on failure.
 *
 * Idempotency: paid/heavy blocks carry `idempotencyKey = runId:block` so a
 * resumed run never double-spends (decision A.4). In P1 the blocks are trivial
 * and run inline; in P2 each heavy block becomes a child task triggered with
 * that key.
 */
import { task, idempotencyKeys } from "@trigger.dev/sdk";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { registerAllBlocks } from "@/engine/blocks";
import { validatePipeline, preflight } from "@/engine/validate";
import { runPipeline as runEngine } from "@/engine/runner";
import { renderBlockTask } from "@/trigger/render-block";
import { planHeal } from "@/engine/healer";
import { makeConvexSink } from "@/engine/convexSink";
import { makeRunLogSink, teeLog } from "@/engine/runLogSink";
import { channelPrefix } from "@/lib/storage";
import { alertFailure } from "@/lib/telegram";
import { bootstrapSecrets } from "@/lib/bootstrap";
import { rehydrateOutputs } from "@/lib/rehydrate";
import type { PipelineEntry } from "@/engine/types";

export interface RunPipelineInput {
  channelId: string;
  runId: string;
  /**
   * Optional one-off pipeline for THIS run only (e.g. a short test render).
   * When set, it is used instead of the channel's persisted pipeline so the
   * channel config is never clobbered and there is no read race. Identity/seed
   * still come from the channel.
   */
  pipelineOverride?: PipelineEntry[];
  /**
   * Render-group reuse: when a language sibling is fanned out by the base run's
   * emit_bundle, the base assets are passed here and seeded into the store so the
   * expensive blocks (topic_select / script_gen / stock_footage / music) reuse
   * them instead of regenerating. Only narration/captions/text/metadata re-run.
   */
  reuse?: {
    language?: string;
    topic?: string;
    script?: unknown;
    footageKeys?: string[];
    musicKey?: string;
  };
}

export const runPipelineTask = task({
  id: "run-pipeline",
  // P1→P2 SPLIT: the memory-heavy render (timeline_assemble) now runs on a
  // large-2x CHILD task (render-block); this orchestrator runs every other block
  // (LLM/TTS/footage/idle waits) and SUSPENDS during the render. So it no longer
  // pays the large-2x rate to sit idle ~50% of the run waiting on external APIs.
  // large-1x (8GB) comfortably handles footage gating + captions + qa_visual.
  machine: "large-1x",
  // Long-form (15-35 min) renders do many full-video re-encodes; allow up to ~2h.
  maxDuration: 4200, // was 7200; real successful renders p95=2817s/max=3634s, 4200s halves the hung-run ceiling without risking legit long-form
  // On a crash/OOM/timeout, retry the whole task — the runner's resume restores
  // completed blocks (no double-spend).
  retry: { maxAttempts: 2, minTimeoutInMs: 5000, maxTimeoutInMs: 30000, factor: 2 },
  // PER-CHANNEL serialization, CROSS-CHANNEL concurrency: every trigger site
  // passes concurrencyKey=channelId, so each channel renders one video at a
  // time (topic no-repeat + schedule stay race-free) while different channels
  // render fully in parallel (each run gets its own machine; the old global
  // limit of 3 throttled the whole fleet).
  queue: { concurrencyLimit: 1 },
  run: async (payload: RunPipelineInput) => {
    registerAllBlocks();
    // CRITICAL-KEY GATE: without the core model keys every creative block falls
    // back to generic output (the "basic and stale" failure mode). Fail the run
    // at minute 0 instead of silently producing a degraded video.
    await bootstrapSecrets(
      (m, x) => console.log(`[run-pipeline] ${m}`, x ?? ""),
      { required: ["GEMINI_API_KEY"] },
    );

    const url = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
    if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL is not configured");
    const convex = new ConvexHttpClient(url);

    const channel = await convex.query(api.channels.getChannel, {
      channelId: payload.channelId as Id<"channels">,
    });
    if (!channel) throw new Error(`channel not found: ${payload.channelId}`);

    const ownerId = channel.ownerId;
    const entries = (payload.pipelineOverride ?? channel.pipeline ?? []) as PipelineEntry[];
    if (payload.pipelineOverride) {
      console.log(`[run-pipeline] using one-off pipelineOverride (${entries.length} blocks) — channel config untouched`);
    }

    // Per-block idempotency keys (used when blocks become child tasks in P2).
    const blockKeys: Record<string, string> = {};
    for (const e of entries) {
      blockKeys[e.block] = await idempotencyKeys.create(
        `${payload.runId}:${e.block}`,
      );
    }

    await convex.mutation(api.runs.updateRun, {
      runId: payload.runId as Id<"runs">,
      status: "running",
    });

    // Live log sink — tees every ctx.log line into the runLogs table so the
    // run detail page can stream a console. Best-effort: never crashes the run.
    const logSink = makeRunLogSink(convex, ownerId, payload.runId);
    const log = teeLog(logSink, (msg, extra) =>
      console.log(`[run-pipeline] ${msg}`, extra ?? ""),
    );

    try {
      // FORGED modules: interpreter-backed blocks the architect authored. Load
      // their validated specs and register before pipeline resolution.
      const forgedIds = entries.filter((e) => e.block.startsWith("forged_")).map((e) => e.block);
      if (forgedIds.length) {
        const { registerForgedSpecs } = await import("@/engine/forge/runtime");
        const { forgedModuleSchema } = await import("@/engine/forge/spec");
        for (const id of forgedIds) {
          const row = await convex.query(api.forgedModules.getByBlock, { ownerId, blockId: id });
          if (!row || row.status !== "active") {
            throw new Error(`pipeline references unknown/disabled forged module "${id}"`);
          }
          registerForgedSpecs([forgedModuleSchema.parse(row.spec)]);
          log(`forge: registered ${id}`);
        }
      }

      const resolved = validatePipeline(entries);
      preflight(resolved, { budgetUsd: channel.budget ?? 0 });

      const paramsByBlock: Record<string, Record<string, unknown>> = {};
      for (const e of entries) {
        if (e.params) paramsByBlock[e.block] = e.params as Record<string, unknown>;
      }

      // Seed channel identity into the store so blocks can read style/topics.
      const seedStore: Record<string, unknown> = {
        topicPool: channel.identity?.topicPool ?? [],
        styleGrammar: channel.identity?.styleGrammar ?? "",
        channelName: channel.name,
        palette: channel.identity?.palette ?? [],
        persona: channel.identity?.persona ?? "",
        niche: channel.identity?.niche ?? "",
        // The channel's chosen narrator — previously identity.voiceId was set at
        // inception but never reached narration_tts, so most channels spoke in
        // the same default voice.
        ...(channel.identity?.voiceId ? { voiceId: channel.identity.voiceId } : {}),
        // Identity guardrails + brand art for blocks that consume them
        // (metadata tag screening; intro/chapter cards use the channel's own
        // avatar instead of the baked stoic bust).
        bannedWords: channel.identity?.bannedWords ?? [],
        ...(channel.identity?.imageKey ? { channelAvatarKey: channel.identity.imageKey } : {}),
        // Lab playbooks (evidence-distilled per-channel rules) — script_gen and
        // thumbnail_gen execute them when present.
        ...((channel as { scriptPlaybook?: unknown }).scriptPlaybook
          ? { scriptPlaybook: (channel as { scriptPlaybook?: unknown }).scriptPlaybook }
          : {}),
        // Phase 2 grounding: the frozen Style DNA + per-channel Quality Bar that
        // Inception distilled. Every block generates AGAINST these and the critic
        // scores conformance TO them (the channel's definition of "good").
        styleDNA: (channel as { styleDNA?: unknown }).styleDNA ?? null,
        qualityBar: (channel as { qaRubric?: unknown }).qaRubric ?? null,
      };

      // Render-group reuse: seed cached base assets so the expensive blocks reuse
      // them (see the reuse guards in topic_select / script_gen / stock_footage / music).
      if (payload.reuse) {
        if (payload.reuse.topic) seedStore["reuseTopic"] = payload.reuse.topic;
        if (payload.reuse.script) seedStore["reuseScript"] = payload.reuse.script;
        if (payload.reuse.footageKeys?.length) seedStore["reuseFootageKeys"] = payload.reuse.footageKeys;
        if (payload.reuse.musicKey) seedStore["reuseMusicKey"] = payload.reuse.musicKey;
        if (payload.reuse.language) seedStore["reuseLanguage"] = payload.reuse.language;
        log(`run-pipeline: render-group REUSE active (lang=${payload.reuse.language}, ${payload.reuse.footageKeys?.length ?? 0} clips)`);
      }

      const sink = makeConvexSink(convex, ownerId);
      const engineOpts = {
        ownerId,
        runId: payload.runId,
        channelId: payload.channelId,
        keyPrefix: channelPrefix(ownerId, channel.slug),
        budgetUsd: channel.budget ?? 0,
        paramsByBlock,
        sink,
        log,
        // Reliability (Phase 5): per-block retry on transient errors + resume —
        // if this task is retried (crash/OOM), skip blocks that already finished
        // and restore their outputs (re-download local files from R2) so paid
        // blocks never re-spend.
        resume: true,
        defaultRetries: 2,
        rehydrate: (block: string, outputs: Record<string, unknown>) =>
          rehydrateOutputs(block, outputs, payload.runId),
        // P1→P2 SPLIT: run the memory-heavy render on a large-2x child task so
        // this orchestrator (large-1x) suspends — unbilled — during the render
        // instead of paying the big-machine rate to wait on external APIs.
        remoteBlocks: new Set(["timeline_assemble"]),
        runRemoteBlock: async (blockId: string, params: Record<string, unknown>) => {
          const res = await renderBlockTask.triggerAndWait({
            runId: payload.runId,
            ownerId,
            channelId: payload.channelId,
            keyPrefix: channelPrefix(ownerId, channel.slug),
            blockId,
            params,
            budgetUsd: channel.budget ?? 0,
            seedStore,
          });
          if (!res.ok) {
            throw new Error(`render-block child failed: ${JSON.stringify(res.error)?.slice(0, 300)}`);
          }
          return (res.output as { patch: Record<string, unknown> }).patch;
        },
      };
      let result = await runEngine(resolved, { ...engineOpts, seedStore });

      // SELF-HEALER (Pipeline Doctor, run-level): a QA failure over a defect a
      // cheap block owns must not discard the run's paid artifacts. Diagnose →
      // supersede exactly the owning block + its downstream consumers → resume
      // (everything else restores from the stage cache). Max 2 heals; unknown
      // or unhealable failures fall through and fail honestly.
      const MAX_HEALS = 2;
      const healable = resolved.blocks.map((b) => ({
        id: b.id,
        produces: b.produces,
        consumes: b.consumes,
        paid: (b as { paid?: boolean }).paid,
      }));
      let heals = 0;
      while (!result.ok && heals < MAX_HEALS) {
        const plan = planHeal(result.error ?? "", healable, (m) => log(m));
        if (!plan) break;
        heals++;
        log(
          `SELF-HEAL ${heals}/${MAX_HEALS}: ${plan.reason} — superseding [${plan.rerunBlocks.join(", ")}] and resuming from the stage cache`,
        );
        await safeAlert(
          `self-heal ${heals} (${channel.slug})`,
          `${plan.reason} → re-running ${plan.rerunBlocks.length} block(s), paid artifacts preserved`,
        );
        for (const b of plan.rerunBlocks) {
          await convex.mutation(api.runStages.upsertRunStage, {
            ownerId,
            runId: payload.runId as Id<"runs">,
            block: b,
            status: "superseded",
            error: `superseded by self-heal #${heals}: ${plan.reason}`,
          });
        }
        result = await runEngine(resolved, {
          ...engineOpts,
          seedStore: { ...seedStore, healHints: plan.hints, healAttempt: heals },
        });
      }
      if (heals > 0 && result.ok) {
        log(`SELF-HEAL succeeded after ${heals} cycle(s) — run recovered without re-spending paid blocks`);
      }

      // Drain any buffered log lines before resolving the run state.
      await logSink.flush();

      if (!result.ok) {
        await convex.mutation(api.runs.updateRun, {
          runId: payload.runId as Id<"runs">,
          status: "failed",
          finishedAt: Date.now(),
          costTotal: result.costTotal,
          error: result.error,
        });
        await safeAlert(
          `run-pipeline failed (${channel.slug}/${result.failedBlock})`,
          result.error ?? "unknown error",
        );
        return { ok: false, failedBlock: result.failedBlock, error: result.error };
      }

      await convex.mutation(api.runs.updateRun, {
        runId: payload.runId as Id<"runs">,
        status: "ok",
        finishedAt: Date.now(),
        costTotal: result.costTotal,
      });
      // Budget guard: warn (don't block) when a run overshoots the channel's
      // per-video budget, so runaway spend surfaces immediately.
      if (channel.budget && result.costTotal > channel.budget) {
        await safeAlert(
          `budget exceeded (${channel.slug})`,
          `run cost $${result.costTotal.toFixed(2)} > budget $${channel.budget.toFixed(2)}`,
        );
      }
      return { ok: true, stages: result.stages, costTotal: result.costTotal };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log(`run aborted: ${message}`);
      await logSink.flush();
      await convex.mutation(api.runs.updateRun, {
        runId: payload.runId as Id<"runs">,
        status: "failed",
        finishedAt: Date.now(),
        error: message,
      });
      await safeAlert(`run-pipeline aborted (${payload.runId})`, message);
      throw err;
    }
  },
});

/** Fire a Telegram alert but never let alerting failures mask the real error. */
async function safeAlert(context: string, error: string): Promise<void> {
  try {
    await alertFailure(context, error);
  } catch (e) {
    console.error(
      "[run-pipeline] telegram alert failed:",
      e instanceof Error ? e.message : e,
    );
  }
}
