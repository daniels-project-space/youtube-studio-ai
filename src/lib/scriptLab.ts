/**
 * SCRIPT LAB — the writing analogue of the Thumbnail Lab.
 *
 * Generic scripts come from generic guidance. This lab WATCHES the verified
 * top competitor videos (Gemini takes YouTube URLs directly — first ~75s
 * window, where retention is decided) and deconstructs how their openings
 * actually work: the exact opening device, what's promised vs withheld, the
 * sentence-level pacing to first payoff, person/tense, claim↔visual coupling,
 * and retention devices. A showrunner then distills a persistent per-channel
 * SCRIPT PLAYBOOK: hook rules + 3 named opening devices (rotated per video for
 * anti-repetition) + retention devices + voice rules. scriptGen executes it.
 */
import { geminiAnalyzeYouTube, parseJsonLoose, hasGeminiKey } from "@/lib/gemini";
import { claudeJson, hasAnthropicKey } from "@/lib/anthropic";
import type { StyleDNA } from "@/engine/creative/types";

type Logger = (msg: string, extra?: Record<string, unknown>) => void;

export interface OpeningDevice {
  name: string;
  /** When this device fits (topic shapes). */
  when: string;
  /** Executable template with <PLACEHOLDERS> — the writer fills, never copies. */
  template: string;
}

export interface ScriptPlaybook {
  hookRules: string[];
  openingDevices: OpeningDevice[];
  retentionDevices: string[];
  voiceRules: string[];
  avoid: string[];
  studied: { videoId: string; title: string; views: number }[];
  distilledAt: number;
  /** REAL-audience rules appended by the retention-analyst loop (newest first). */
  retentionLearnings?: { rule: string; evidence?: string; confidence?: string }[];
}

/** Deconstruct ONE winner's opening (first ~75s) by actually watching it. */
async function deconstructOpening(
  videoId: string,
  title: string,
  log: Logger,
): Promise<Record<string, unknown> | null> {
  try {
    const raw = await geminiAnalyzeYouTube(
      `https://www.youtube.com/watch?v=${videoId}`,
      `Deconstruct the OPENING of this video ("${title}") as a retention engineer. Return STRICT JSON:\n` +
        `{"openingDevice":"<name the device: cold-open scene / counterintuitive claim / dollar-figure scenario / ` +
        `question stack / in-medias-res story / promise-of-proof / other>",` +
        `"firstLine":"<the actual first spoken line, verbatim-ish>",` +
        `"promised":"<what the opening promises the viewer>",` +
        `"withheld":"<what it deliberately withholds to force watching>",` +
        `"sentencesToFirstPayoff":number,` +
        `"personTense":"<narration person + tense>",` +
        `"visualCoupling":"<how the first visuals relate to the first claims>",` +
        `"retentionDevices":["<devices used in the first 75s: open loops, countdown, stakes escalation, ` +
        `pattern interrupt, direct address...>"],` +
        `"pacing":"<sentence length + delivery energy observation>"}`,
      { json: true, maxTokens: 900, windowSec: 75 },
    );
    return parseJsonLoose<Record<string, unknown>>(raw);
  } catch (e) {
    log(`scriptLab: could not watch ${videoId} (${e instanceof Error ? e.message : e}) — skipping`);
    return null;
  }
}

export async function distillScriptPlaybook(args: {
  /** Verified top competitor videos (highest views first). */
  refs: { videoId: string; title: string; views: number }[];
  dna: StyleDNA | null;
  channelName: string;
  positioning: string;
  log?: Logger;
}): Promise<ScriptPlaybook> {
  const log = args.log ?? (() => {});
  if (!hasGeminiKey() || !hasAnthropicKey()) {
    throw new Error("scriptLab: GEMINI_API_KEY + ANTHROPIC_API_KEY required");
  }
  const targets = args.refs.slice(0, 3);
  if (targets.length === 0) throw new Error("scriptLab: no reference videos to study");

  const decons: Record<string, unknown>[] = [];
  const studied: ScriptPlaybook["studied"] = [];
  for (const t of targets) {
    const d = await deconstructOpening(t.videoId, t.title, log);
    if (d) {
      decons.push({ ...d, _title: t.title, _views: t.views });
      studied.push(t);
      log(`scriptLab: studied "${t.title.slice(0, 50)}" (${t.views.toLocaleString()} views) — device: ${String(d["openingDevice"] ?? "?")}`);
    }
  }
  if (decons.length === 0) throw new Error("scriptLab: could not deconstruct any reference video");

  const play = await claudeJson<{
    hookRules?: string[];
    openingDevices?: { name?: string; when?: string; template?: string }[];
    retentionDevices?: string[];
    voiceRules?: string[];
    avoid?: string[];
  }>({
    maxTokens: 2600,
    temperature: 0.5,
    system: "You are an elite YouTube retention engineer and head writer. Return ONLY JSON.",
    prompt:
      `Build the SCRIPT PLAYBOOK for "${args.channelName}" (${args.positioning}).\n\n` +
      `EVIDENCE — opening deconstructions of ${decons.length} top-view videos in this exact space ` +
      `(observed by WATCHING them):\n${JSON.stringify(decons).slice(0, 5500)}\n\n` +
      `CHANNEL NARRATIVE DNA: ${JSON.stringify(args.dna?.narrative ?? {})}\n\n` +
      `Synthesize a playbook the channel's writer executes EVERY video:\n` +
      `1. hookRules: 5-7 hard rules for the first 30 seconds, derived from the evidence (be specific: ` +
      `sentence counts, what to promise/withhold, when the first concrete payoff must land).\n` +
      `2. openingDevices: EXACTLY 3 named devices (distinct mechanics, rotated across videos so openings ` +
      `never feel same-y). Each: name, when (topic shapes it fits), template (2-4 sentence skeleton with ` +
      `<PLACEHOLDERS> — the shape of the device, never copyable text).\n` +
      `3. retentionDevices: 4-6 devices for the BODY (open loops, midpoint re-hooks, stakes resets…) with ` +
      `WHERE to deploy them (timestamps/positions).\n` +
      `4. voiceRules: 3-5 sentence-level voice rules consistent with the DNA register.\n` +
      `5. avoid: 4-6 anti-patterns (LLM-tells, openings the evidence channels never use, this channel's ` +
      `banned energies).\n` +
      `Return STRICT JSON {"hookRules":string[],"openingDevices":[{"name","when","template"}],` +
      `"retentionDevices":string[],"voiceRules":string[],"avoid":string[]}.`,
  });

  const devices = (play.openingDevices ?? [])
    .filter((d) => d.name && d.template)
    .map((d) => ({ name: d.name!, when: d.when ?? "", template: d.template! }))
    .slice(0, 3);
  if (devices.length === 0) throw new Error("scriptLab: synthesis produced no opening devices");

  log(`scriptLab: playbook — ${play.hookRules?.length ?? 0} hook rules, devices: ${devices.map((d) => d.name).join(" / ")}`);
  return {
    hookRules: play.hookRules ?? [],
    openingDevices: devices,
    retentionDevices: play.retentionDevices ?? [],
    voiceRules: play.voiceRules ?? [],
    avoid: play.avoid ?? [],
    studied,
    distilledAt: Date.now(),
  };
}

/** Render the playbook as prompt guidance, with ONE device selected per video. */
export function scriptPlaybookDigest(playbook: ScriptPlaybook, deviceIdx: number): string {
  const device = playbook.openingDevices[deviceIdx % playbook.openingDevices.length];
  return [
    `CHANNEL SCRIPT PLAYBOOK (distilled from watching this niche's top-view videos — EXECUTE it):`,
    `HOOK RULES:\n- ${playbook.hookRules.join("\n- ")}`,
    `THIS VIDEO'S OPENING DEVICE (assigned for variety — use THIS one): "${device.name}" — ${device.when}\nSkeleton: ${device.template}`,
    playbook.retentionDevices.length ? `BODY RETENTION DEVICES:\n- ${playbook.retentionDevices.join("\n- ")}` : "",
    // Real-audience rules outrank theory: distilled from THIS channel's actual
    // retention curves by the retention-analyst loop (high/medium confidence).
    (() => {
      const learned = (playbook.retentionLearnings ?? [])
        .filter((l) => l.rule && l.confidence !== "low")
        .slice(0, 6)
        .map((l) => `- ${l.rule}`);
      return learned.length
        ? `MEASURED ON THIS CHANNEL (real audience retention — these OUTRANK conflicting rules above):\n${learned.join("\n")}`
        : "";
    })(),
    playbook.voiceRules.length ? `VOICE RULES:\n- ${playbook.voiceRules.join("\n- ")}` : "",
    playbook.avoid.length ? `NEVER:\n- ${playbook.avoid.join("\n- ")}` : "",
  ].filter(Boolean).join("\n\n");
}
