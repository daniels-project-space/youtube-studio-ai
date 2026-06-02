/**
 * Narrated-archetype text blocks (Stage 3a) — the "brain" shared by essay /
 * crime / shorts / meditation:
 *   script_gen  → script + narrationText   (Gemini)
 *   hook_craft  → hook + narrationText'     (Gemini; prepends a punchy opener)
 *   qa_script   → scriptApproved            (Claude critique; soft gate)
 *
 * All degrade gracefully on a missing key so the pipeline never hard-fails.
 */
import type { Block, StageContext } from "@/engine/types";
import { synthScript } from "@/lib/scriptGen";
import { geminiJson, hasGeminiKey } from "@/lib/gemini";
import { claudeJson, hasAnthropicKey } from "@/lib/anthropic";

function str(ctx: StageContext, key: string): string {
  const v = ctx.store[key];
  if (typeof v !== "string" || v.length === 0) {
    throw new Error(`narrated: expected non-empty string store["${key}"]`);
  }
  return v;
}
function opt(ctx: StageContext, key: string): string | undefined {
  const v = ctx.store[key];
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

export const scriptGen: Block = {
  id: "script_gen",
  consumes: ["topic"],
  produces: ["script", "narrationText"],
  run: async (ctx) => {
    const topic = str(ctx, "topic");
    const script = await synthScript(
      {
        topic,
        channelName: opt(ctx, "channelName"),
        persona: opt(ctx, "persona"),
        styleGrammar: opt(ctx, "styleGrammar"),
        niche: opt(ctx, "niche"),
        style: ctx.params["style"] as string | undefined,
        maxSeconds: ctx.params["maxSeconds"] as number | undefined,
      },
      ctx.log,
    );
    ctx.log(`script_gen: ${script.sections.length} sections, ~${script.estDurationSec}s`);
    return { script, narrationText: script.narrationText };
  },
};

export const hookCraft: Block = {
  id: "hook_craft",
  consumes: ["narrationText"],
  produces: ["hook"],
  run: async (ctx) => {
    // A punchy STANDALONE hook for the title / thumbnail / shorts opener. The
    // spoken narration already opens with script_gen's hook; this does not
    // modify narrationText (single-producer rule).
    const narration = str(ctx, "narrationText");
    const firstLine = () => narration.split(/\n+/)[0].slice(0, 140);
    if (!hasGeminiKey()) return { hook: firstLine() };
    let hook = "";
    try {
      const out = await geminiJson<{ hook?: string }>({
        prompt:
          "Write ONE scroll-stopping hook line for this video (for the title/thumbnail). " +
          'Return STRICT JSON {"hook": string}. No markdown.\n\n' +
          narration.slice(0, 2000),
        maxTokens: 200,
        temperature: 0.9,
      });
      hook = typeof out.hook === "string" ? out.hook.trim() : "";
    } catch (e) {
      ctx.log(`hook_craft: gemini failed (${e instanceof Error ? e.message : e})`);
    }
    if (!hook) hook = firstLine();
    ctx.log(`hook_craft: "${hook.slice(0, 60)}…"`);
    return { hook };
  },
};

export const qaScript: Block = {
  id: "qa_script",
  consumes: ["narrationText"],
  produces: ["scriptApproved"],
  run: async (ctx) => {
    const narration = str(ctx, "narrationText");
    if (!hasAnthropicKey()) {
      ctx.log("qa_script: no Anthropic key — skipping critique (approved)");
      return { scriptApproved: true };
    }
    try {
      const persona = opt(ctx, "persona") ?? "";
      const res = await claudeJson<{ pass?: boolean; issues?: string[] }>({
        prompt:
          `Critique this YouTube narration for quality and on-brand voice` +
          (persona ? ` (channel persona: ${persona})` : "") +
          `. Flag dull sections, off-brand language, factual hedging, or weak structure. ` +
          `Return STRICT JSON {"pass": boolean, "issues": string[]}.\n\n` +
          narration.slice(0, 6000),
        maxTokens: 800,
        temperature: 0.3,
      });
      const issues = Array.isArray(res.issues) ? res.issues : [];
      ctx.log(`qa_script: pass=${res.pass !== false}`, { issues: issues.slice(0, 5) });
      return { scriptApproved: res.pass !== false };
    } catch (e) {
      ctx.log(`qa_script: critique failed (non-fatal): ${e instanceof Error ? e.message : e}`);
      return { scriptApproved: true };
    }
  },
};

export const narratedBlocks: Block[] = [scriptGen, hookCraft, qaScript];
