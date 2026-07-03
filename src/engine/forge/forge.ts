/**
 * MODULE FORGE — the authoring agent. Given a missing capability + the
 * channel's identity, Claude writes a ForgedModuleSpec (declarative, over the
 * trusted primitives). The zod schema is the gate: an invalid spec never
 * exists. One retry with the validation errors fed back.
 */
import { claudeJson } from "@/lib/anthropic";
import { forgedModuleSchema, type ForgedModuleSpec } from "./spec";
import type { StyleDNA } from "@/engine/creative/types";

const DSL_REFERENCE = `
SPEC FORMAT (JSON):
{
 "id": "forged_<slug>", "label": "...", "description": "...", "whenToUse": "...",
 "consumes": [<store keys you read: "topic"|"script"|"narrationText"|"sentenceTimings"|"styleDNA"|"visualBrief"|"structure"|"introSec"|"narrationDurationSec"|"title">],
 "produces": "extraOverlays",
 "anchorAfter": ["visual_inserts","quote_overlays","intro_card","narration_tts"],
 "params": [{"key","min","max","default","describe"}] (numbers only, ≤4),
 "maxCostUsd": <ceiling for paid media steps, ≤5>,
 "steps": [ ... ≤12 steps ... ]
}
STEP TYPES (the ONLY operations that exist):
- {"op":"llm_json","prompt":"... \${store.topic} ... Return STRICT JSON {...}","maxTokens":1500}
  → plan things. Refs: \${store.X} \${params.X} \${item} \${item.field} \${steps.N} \${steps.N.field}.
- {"op":"image","prompt":"..."} → flux still, returns {url}. Text-free enforced.
- {"op":"i2v","imageFrom":"$steps.N","prompt":"motion ...","durationSec":5} → clip, returns {path}.
- {"op":"remotion","comp":"DataInsert"|"TitleCard"|"QuoteOverlay"|"ThumbText","props":{...},"durationSec":5}
  → branded alpha overlay (returns {path}). DataInsert props: kind/title/value/label/series/bars/events/palette/accent.
  TitleCard props: title/subtitle. QuoteOverlay props: quote/highlights. ThumbText props: lines/numberCallout/accentColor.
- {"op":"emit_overlays","overlays":[{"pathFrom":"$steps.N","startSec":"$item.startSec","durSec":5,"noBlur":true,"text":"..."}]}
  → place media on the video timeline (composited by the proven finisher; noBlur=true for badges, false = blur-under card).
- {"op":"foreach","overFrom":"$steps.0.plan","max":6,"steps":[...inner steps; $item = current element...]}
RULES: timings come from sentenceTimings/introSec (plan with llm_json against them — overlays must land when the
narration speaks the related words); honesty gates: never invent facts/numbers — only visualize what's in the script;
every paid step costs (~$0.04 image, ~$0.13 i2v) — stay under maxCostUsd; fewer, stronger moments beat wallpaper.`;

export async function authorForgedModule(args: {
  capability: { name: string; description: string; wouldEnable?: string };
  channelName: string;
  niche?: string;
  dna?: StyleDNA | null;
  log?: (m: string) => void;
}): Promise<{ spec: ForgedModuleSpec } | { error: string }> {
  const log = args.log ?? (() => {});
  const dnaLine = args.dna
    ? `CHANNEL VISUAL WORLD: ${args.dna.recurringSubject}; ${args.dna.setting}; grade ${args.dna.colorGrade}; palette ${(args.dna.palette ?? []).join(",")}`
    : "";
  let feedback = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const out = await claudeJson<{ specJson?: string }>({
        tier: "pro",
        maxTokens: 4000,
        temperature: 0.4,
        system: "You are the MODULE FORGE: you author new pipeline modules as declarative specs. Return ONLY JSON.",
        prompt:
          `A channel needs a capability no module provides. AUTHOR a new module spec for it.\n\n` +
          `CAPABILITY: ${args.capability.name} — ${args.capability.description}\n` +
          (args.capability.wouldEnable ? `WOULD ENABLE: ${args.capability.wouldEnable}\n` : "") +
          `CHANNEL: "${args.channelName}" (${args.niche ?? "?"})\n${dnaLine}\n` +
          DSL_REFERENCE +
          (feedback ? `\n\nYOUR PREVIOUS ATTEMPT FAILED VALIDATION:\n${feedback}\nFix every error.` : "") +
          `\n\nDesign judgment: is this capability EXPRESSIBLE with these primitives? If NOT (needs audio mixing, ` +
          `new render targets, external data), return {"specJson":"IMPOSSIBLE: <one-line reason>"}. Otherwise return ` +
          `STRICT JSON {"specJson":"<the complete spec as a JSON-encoded string>"}.`,
      });
      const raw = out.specJson ?? "";
      if (raw.startsWith("IMPOSSIBLE")) return { error: raw };
      const parsed = forgedModuleSchema.safeParse(JSON.parse(raw));
      if (parsed.success) {
        log(`forge: authored ${parsed.data.id} (${parsed.data.steps.length} steps, ceiling $${parsed.data.maxCostUsd})`);
        return { spec: parsed.data };
      }
      feedback = parsed.error.issues.slice(0, 8).map((i) => `${i.path.join(".")}: ${i.message}`).join("\n");
      log(`forge: attempt ${attempt + 1} failed validation (${parsed.error.issues.length} issue(s)) — retrying`);
    } catch (e) {
      feedback = e instanceof Error ? e.message : String(e);
      log(`forge: attempt ${attempt + 1} errored — ${feedback.slice(0, 120)}`);
    }
  }
  return { error: `spec failed validation after 2 attempts: ${feedback.slice(0, 300)}` };
}
