/**
 * VERIFY & HEAL — assess a finished video against the channel rubric and, when it
 * misses the bar, apply HEAL actions cheapest-first, re-assessing each round,
 * until it passes or the budget runs out. Then hard-gate the ship.
 *
 * Effort (product decision = "balanced"): always auto-apply CHEAP fixes (re-mix
 * audio, re-slow narration); re-render at most 1–2 of the weakest shots; then
 * ship if it passes, else FLAG with the blocking reasons (never silently ship a
 * hard-gate failure). Heal actions are provided by the engine as hooks — the
 * loop just decides which to call, in what order, against the report's defects.
 */
import { assessVideo, type QualityReport, type QualityMeters } from "./assess";
import type { ChannelQualitySpec, QualityDimension } from "./rubric";

type Logger = (m: string) => void;
export type HealEffort = "conservative" | "balanced" | "aggressive";

/** Engine-supplied fixers. Each returns a NEW video path, or null if it can't help. */
export interface HealHooks {
  /** Re-balance the audio (VO dominant, bed quiet, gentle duck) — the cheapest fix. */
  remixAudio?: (video: string, report: QualityReport) => Promise<string | null>;
  /** Re-synthesize narration slower / re-time — for pace defects. */
  reslowNarration?: (video: string, report: QualityReport) => Promise<string | null>;
  /** Re-render the N weakest shots (production value / coherence) — the expensive fix. */
  rerenderWeakShots?: (video: string, report: QualityReport, maxShots: number) => Promise<string | null>;
}

export interface VerifyHealResult {
  videoPath: string;
  report: QualityReport;
  rounds: number;
  healed: string[]; // actions applied
  shipped: boolean; // passed the hard gate
}

const blocksDim = (r: QualityReport, d: QualityDimension) => r.blocking.includes(d);

export async function verifyAndHeal(args: {
  videoPath: string;
  script?: string;
  spec: ChannelQualitySpec;
  engineMeters?: Partial<QualityMeters>;
  hooks?: HealHooks;
  effort?: HealEffort;
  maxRounds?: number;
  framesDir?: string;
  log?: Logger;
}): Promise<VerifyHealResult> {
  const log = args.log ?? (() => {});
  const effort = args.effort ?? "balanced";
  const maxRounds = args.maxRounds ?? (effort === "aggressive" ? 3 : effort === "conservative" ? 1 : 2);
  const hooks = args.hooks ?? {};
  const healed: string[] = [];
  let video = args.videoPath;
  let report = await assessVideo({ videoPath: video, script: args.script, spec: args.spec, engineMeters: args.engineMeters, framesDir: args.framesDir, log });

  for (let round = 1; round <= maxRounds && !report.gatePass; round++) {
    let fixed: string | null = null;

    // 1) cheapest: audio re-mix when the audio dimensions block (or just score low)
    if (!fixed && hooks.remixAudio && (blocksDim(report, "audio_mix") || blocksDim(report, "audio_dialogue"))) {
      log(`quality HEAL r${round}: re-mixing audio (${report.blocking.join(", ")})`);
      fixed = await hooks.remixAudio(video, report);
      if (fixed) healed.push("remix_audio");
    }
    // 2) cheap: re-slow narration for a pace defect
    if (!fixed && hooks.reslowNarration && report.defects.some((d) => /pace|wpm|fast/i.test(d))) {
      log(`quality HEAL r${round}: re-pacing narration`);
      fixed = await hooks.reslowNarration(video, report);
      if (fixed) healed.push("reslow_narration");
    }
    // 3) expensive (balanced/aggressive only): re-render the weakest shots
    if (!fixed && effort !== "conservative" && hooks.rerenderWeakShots && (blocksDim(report, "production_value") || blocksDim(report, "coherence"))) {
      const maxShots = effort === "aggressive" ? 3 : 2;
      log(`quality HEAL r${round}: re-rendering up to ${maxShots} weak shots (${report.blocking.join(", ")})`);
      fixed = await hooks.rerenderWeakShots(video, report, maxShots);
      if (fixed) healed.push("rerender_weak_shots");
    }

    if (!fixed) { log(`quality HEAL r${round}: no applicable auto-fix for [${report.blocking.join(", ")}] — flagging`); break; }
    video = fixed;
    report = await assessVideo({ videoPath: video, script: args.script, spec: args.spec, engineMeters: args.engineMeters, framesDir: args.framesDir, log });
  }

  const shipped = report.gatePass;
  if (shipped) log(`quality: PASS — overall ${report.overall.toFixed(1)}/10${healed.length ? ` after ${healed.join(", ")}` : ""}`);
  else log(`quality: FLAGGED — below the bar on [${report.blocking.join(", ")}]. Defects: ${report.defects.slice(0, 5).join(" | ")}`);
  return { videoPath: video, report, rounds: 1, healed, shipped };
}
