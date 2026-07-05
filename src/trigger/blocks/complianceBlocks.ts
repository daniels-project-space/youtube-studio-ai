/**
 * Compliance gates (Phase 4) — protect against YouTube's existential
 * "inauthentic content" demonetization (channel-wide) + the synthetic-content
 * disclosure rule.
 *
 *   originality_gate  → embeds the script, compares cosine vs the channel's
 *                       prior uploads (R2 index); HARD-FAILS near-duplicates so
 *                       the channel never ships templated/repetitive content.
 *   compliance_check  → classifies topic sensitivity + realistic synthetic
 *                       depiction; flags disclosure; HARD-FAILS sensitive +
 *                       realistic-synthetic (refuse to auto-publish).
 *
 * Both degrade gracefully without a model key.
 */
import type { Block, StageContext } from "@/engine/types";
import { embedText, cosine, hasEmbedKey } from "@/lib/embeddings";
import { putObject, getObjectBytes } from "@/lib/storage";
import { geminiJson, hasGeminiKey } from "@/lib/gemini";

interface EmbeddingEntry {
  ts: number;
  runId: string;
  topic: string;
  vector: number[];
}

function indexKey(ctx: StageContext): string {
  return `${ctx.keyPrefix}compliance/embeddings.json`;
}

async function loadIndex(ctx: StageContext): Promise<EmbeddingEntry[]> {
  try {
    const bytes = await getObjectBytes(indexKey(ctx));
    const arr = JSON.parse(Buffer.from(bytes).toString("utf8"));
    return Array.isArray(arr) ? arr : [];
  } catch {
    return []; // first run for the channel — no index yet
  }
}

async function saveIndex(ctx: StageContext, entries: EmbeddingEntry[]): Promise<void> {
  // Cap history so the index stays small + fast (last 200 uploads).
  const trimmed = entries.slice(-200);
  await putObject(indexKey(ctx), Buffer.from(JSON.stringify(trimmed), "utf8"), {
    contentType: "application/json",
  });
}

function str(ctx: StageContext, key: string): string {
  const v = ctx.store[key];
  if (typeof v !== "string" || v.length === 0) {
    throw new Error(`compliance: expected non-empty string store["${key}"]`);
  }
  return v;
}

/**
 * SPOKEN-LINE compliance — the pre-engine compliance_check only sees the TOPIC;
 * the actual narration/dialogue the self-scripting engines write (comic, sleep,
 * whiteboard) was never policy-scanned. A benign topic ("Spartacus's revolt")
 * can still yield lines that glorify violence, give real-world harm instructions,
 * or otherwise risk advertiser-hostility/demonetization. This scans the words
 * that will actually be SPOKEN and hard-fails clear violations. Degrades to a
 * pass without a model key (the topic-level gate already ran).
 */
async function scanSpokenLines(text: string, log: (m: string) => void): Promise<void> {
  if (!hasGeminiKey()) return;
  try {
    const out = await geminiJson<{ violation?: boolean; category?: string; reason?: string }>({
      prompt:
        `You are a YouTube advertiser-safety reviewer reading the SPOKEN NARRATION of a faceless video. ` +
        `Flag ONLY clear policy violations in the words themselves: glorification/encouragement of violence or ` +
        `self-harm, hateful/demeaning content toward a protected group, real actionable instructions for harm ` +
        `(weapons, drugs, hacking), graphic sexual content, or dangerous misinformation stated as fact. ` +
        `Historical/educational description of violence is NOT a violation unless it glorifies or instructs.\n\n` +
        `NARRATION:\n"""${text.slice(0, 6000)}"""\n\n` +
        `Return STRICT JSON {"violation":boolean,"category":string,"reason":string}.`,
      maxTokens: 200,
      temperature: 0.1,
    });
    if (out.violation === true) {
      throw new Error(
        `spoken-line compliance FAILED: ${out.category || "policy"} — ${out.reason || "the narration violates advertiser-safety policy"} (refusing to auto-publish)`,
      );
    }
    log("originality_gate: spoken-line compliance PASS");
  } catch (e) {
    // A thrown compliance failure must propagate; a model/parse error must not.
    if (e instanceof Error && e.message.startsWith("spoken-line compliance FAILED")) throw e;
    log(`originality_gate: spoken-line scan skipped (non-fatal): ${e instanceof Error ? e.message : e}`);
  }
}

export const originalityGate: Block = {
  id: "originality_gate",
  consumes: ["narrationText"],
  produces: ["originalityOk", "maxSimilarity"],
  run: async (ctx) => {
    const text = str(ctx, "narrationText");
    // Policy-scan the ACTUAL spoken lines (the pre-engine gate saw only the topic).
    await scanSpokenLines(text, (m) => ctx.log(m));
    if (!hasEmbedKey()) {
      ctx.log("originality_gate: no GEMINI_API_KEY — skipping self-dedup");
      return { originalityOk: true, maxSimilarity: 0 };
    }
    const threshold = Number(ctx.params["threshold"] ?? 0.92);
    const vector = await embedText(text);
    const index = await loadIndex(ctx);

    let maxSim = 0;
    let nearest = "";
    for (const e of index) {
      const s = cosine(vector, e.vector);
      if (s > maxSim) {
        maxSim = s;
        nearest = e.topic;
      }
    }
    ctx.log(`originality_gate: maxSimilarity=${maxSim.toFixed(3)} vs ${index.length} prior (nearest: "${nearest}")`);
    if (maxSim >= threshold) {
      throw new Error(
        `originality_gate FAILED: script is ${(maxSim * 100).toFixed(0)}% similar to a prior upload ("${nearest}") — too templated/repetitive (YouTube inauthentic-content risk). Vary the angle/structure.`,
      );
    }

    // Reserve this content in the index (so future runs dedup against it).
    const topic = (ctx.store["topic"] as string | undefined) ?? "";
    index.push({ ts: Date.now(), runId: ctx.runId, topic, vector });
    await saveIndex(ctx, index);
    return { originalityOk: true, maxSimilarity: Number(maxSim.toFixed(3)) };
  },
};

export const complianceCheck: Block = {
  id: "compliance_check",
  consumes: ["topic"],
  produces: ["disclosureRequired", "sensitiveTopic", "complianceNote"],
  run: async (ctx) => {
    const topic = str(ctx, "topic");
    const niche = (ctx.store["niche"] as string | undefined) ?? "";
    if (!hasGeminiKey()) {
      return { disclosureRequired: false, sensitiveTopic: false, complianceNote: "" };
    }
    let sensitive = false;
    let synthRealistic = false;
    let reason = "";
    try {
      const out = await geminiJson<{
        sensitive?: boolean;
        depictsRealPeopleRealistically?: boolean;
        reason?: string;
      }>({
        prompt:
          `Classify a faceless, AI-generated YouTube video about "${topic}"${niche ? ` (${niche})` : ""}. ` +
          `It uses an AI voiceover, stock/generative B-roll, and real public-domain photos of historical figures.\n` +
          `Return STRICT JSON {"sensitive":boolean,"depictsRealPeopleRealistically":boolean,"reason":string}.\n` +
          `- "sensitive" = health/medical, breaking news, elections/politics, or financial advice.\n` +
          `- "depictsRealPeopleRealistically" = realistic SYNTHETIC depiction of a real recent/living person or real event (deepfake-like). Historical public-domain portraits and generic stock are NOT this.`,
        maxTokens: 200,
        temperature: 0.1,
      });
      sensitive = out.sensitive === true;
      synthRealistic = out.depictsRealPeopleRealistically === true;
      reason = out.reason ?? "";
    } catch (e) {
      ctx.log(`compliance_check: classify failed (continuing): ${e instanceof Error ? e.message : e}`);
    }

    // Hard gate: sensitive topic + realistic synthetic depiction → manual review.
    if (sensitive && synthRealistic) {
      throw new Error(
        `compliance_check FAILED: sensitive topic + realistic synthetic depiction needs manual disclosure/review — refusing to auto-publish (${reason})`,
      );
    }
    const complianceNote = synthRealistic
      ? "Note: may require YouTube 'altered or synthetic content' disclosure (set in Studio)."
      : "";
    ctx.log(`compliance_check: sensitive=${sensitive} disclosureRequired=${synthRealistic}`);
    return { disclosureRequired: synthRealistic, sensitiveTopic: sensitive, complianceNote };
  },
};

export const complianceBlocks: Block[] = [originalityGate, complianceCheck];
