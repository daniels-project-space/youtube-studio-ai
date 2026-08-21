/**
 * Compliance gates (Phase 4) — protect against YouTube's existential
 * "inauthentic content" demonetization (channel-wide) + the synthetic-content
 * disclosure rule.
 *
 *   originality_gate  → performs a deterministic local lexical-shingle check
 *                       against the channel's own R2 corpus; HARD-FAILS
 *                       near-duplicates so the channel never ships literally
 *                       templated/repetitive narration.
 *   compliance_check  → classifies topic sensitivity + realistic synthetic
 *                       depiction; flags disclosure; HARD-FAILS sensitive +
 *                       realistic-synthetic (refuse to auto-publish).
 *
 * The local script comparison does not use a model key and never calls an
 * embedding provider. It intentionally makes no semantic or visual originality
 * claim beyond the retained lexical corpus it actually measured.
 */
import type { Block, StageContext } from "@/engine/types";
import { putObject, getObjectBytes } from "@/lib/storage";
import { claudeJson, hasAnthropicKey } from "@/lib/anthropic";
import { StudioConvexHttpClient } from "@/lib/studioConvexHttpClient";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import {
  appendScriptSelfDedupCorpusEntry,
  assertLocalScriptSelfDedupPass,
  createLocalScriptLexicalCorpusEntry,
  evaluateLocalScriptSelfDedup,
  parseScriptSelfDedupCorpusDocument,
  serializeScriptSelfDedupCorpus,
  type ParsedScriptSelfDedupCorpus,
  type ScriptSelfDedupCorpusSource,
} from "@/lib/scriptSelfDedup";

const LOCAL_SCRIPT_SELF_DEDUP_INDEX = "compliance/script-self-dedup.json";
const LEGACY_EMBEDDING_INDEX = "compliance/embeddings.json";
const LOCAL_SCRIPT_SELF_DEDUP_LOCK_WAIT_MS = 20_000;
const LOCAL_SCRIPT_SELF_DEDUP_LOCK_MAX_RETRIES = 40;

export type LocalScriptSelfDedupObjectReader = (key: string) => Promise<Uint8Array>;
export type LocalScriptSelfDedupObjectWriter = (key: string, body: Uint8Array) => Promise<unknown>;

export type LocalScriptSelfDedupLeaseArgs = {
  ownerId: string;
  channelId: string;
  runId: string;
  leaseToken: string;
};

export type LocalScriptSelfDedupLeaseClaim =
  | { kind: "acquired"; leaseExpiresAt: number }
  | { kind: "busy"; retryAfterMs: number };

/**
 * Production implementation is backed by serializable Convex mutations. This
 * narrow interface only makes the critical section testable without a live
 * Convex deployment; it is not a local-process lock.
 */
export interface LocalScriptSelfDedupReservationAuthority {
  acquire: (args: LocalScriptSelfDedupLeaseArgs) => Promise<LocalScriptSelfDedupLeaseClaim>;
  renew: (args: LocalScriptSelfDedupLeaseArgs) => Promise<boolean>;
  release: (args: LocalScriptSelfDedupLeaseArgs) => Promise<boolean>;
}

function selfDedupConvex(): StudioConvexHttpClient {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
  if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL is not configured");
  return new StudioConvexHttpClient(url);
}

function convexLocalScriptSelfDedupReservationAuthority(): LocalScriptSelfDedupReservationAuthority {
  const client = selfDedupConvex();
  const mutationArgs = (args: LocalScriptSelfDedupLeaseArgs) => ({
    ...args,
    channelId: args.channelId as Id<"channels">,
  });
  return {
    acquire: async (args) => await client.mutation(api.scriptSelfDedupLeases.acquire, mutationArgs(args)),
    renew: async (args) => await client.mutation(api.scriptSelfDedupLeases.renew, mutationArgs(args)),
    release: async (args) => await client.mutation(api.scriptSelfDedupLeases.release, mutationArgs(args)),
  };
}

function defaultLeaseToken(ctx: StageContext): string {
  const nonce = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
  return `originality_gate:${ctx.runId}:${nonce}`;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function acquireLocalScriptSelfDedupLease(args: {
  authority: LocalScriptSelfDedupReservationAuthority;
  lease: LocalScriptSelfDedupLeaseArgs;
  log: (message: string) => void;
  sleep: (ms: number) => Promise<void>;
}): Promise<void> {
  let waitedMs = 0;
  for (let attempt = 0; attempt < LOCAL_SCRIPT_SELF_DEDUP_LOCK_MAX_RETRIES; attempt += 1) {
    const claim = await args.authority.acquire(args.lease);
    if (claim.kind === "acquired") return;
    const retryAfterMs = Math.max(20, Math.min(claim.retryAfterMs, 1_000));
    if (waitedMs + retryAfterMs > LOCAL_SCRIPT_SELF_DEDUP_LOCK_WAIT_MS) break;
    args.log(
      `originality_gate: waiting ${retryAfterMs}ms for the channel's durable lexical self-dedup reservation (attempt ${attempt + 1})`,
    );
    await args.sleep(retryAfterMs);
    waitedMs += retryAfterMs;
  }
  throw new Error(
    "originality_gate: could not acquire the channel's durable lexical self-dedup reservation before timeout",
  );
}

export function localScriptSelfDedupIndexKey(ctx: Pick<StageContext, "keyPrefix">): string {
  return `${ctx.keyPrefix}${LOCAL_SCRIPT_SELF_DEDUP_INDEX}`;
}

function legacyEmbeddingIndexKey(ctx: Pick<StageContext, "keyPrefix">): string {
  return `${ctx.keyPrefix}${LEGACY_EMBEDDING_INDEX}`;
}

function isMissingR2Object(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const status = (error as { $metadata?: { httpStatusCode?: unknown } }).$metadata?.httpStatusCode;
  const name = String((error as { name?: unknown }).name ?? "");
  return status === 404 || name === "NoSuchKey" || name === "NotFound";
}

async function readCorpusDocumentIfPresent(
  key: string,
  readObject: LocalScriptSelfDedupObjectReader,
): Promise<unknown | undefined> {
  let bytes: Uint8Array;
  try {
    bytes = await readObject(key);
  } catch (error) {
    if (isMissingR2Object(error)) return undefined;
    throw new Error(
      `originality_gate: could not read the local script self-dedup corpus at "${key}": ${error instanceof Error ? error.message : error}`,
    );
  }
  try {
    return JSON.parse(Buffer.from(bytes).toString("utf8"));
  } catch (error) {
    throw new Error(
      `originality_gate: local script self-dedup corpus at "${key}" is not valid JSON: ${error instanceof Error ? error.message : error}`,
    );
  }
}

export async function loadLocalScriptSelfDedupCorpus(
  ctx: Pick<StageContext, "keyPrefix">,
  readObject: LocalScriptSelfDedupObjectReader = getObjectBytes,
): Promise<{ corpus: ParsedScriptSelfDedupCorpus; source: ScriptSelfDedupCorpusSource }> {
  const localKey = localScriptSelfDedupIndexKey(ctx);
  const localDocument = await readCorpusDocumentIfPresent(localKey, readObject);
  if (localDocument !== undefined) {
    return {
      corpus: parseScriptSelfDedupCorpusDocument(localDocument),
      source: "local_script_index",
    };
  }

  const legacyDocument = await readCorpusDocumentIfPresent(legacyEmbeddingIndexKey(ctx), readObject);
  if (legacyDocument !== undefined) {
    return {
      corpus: parseScriptSelfDedupCorpusDocument(legacyDocument),
      source: "legacy_embedding_index",
    };
  }

  return {
    corpus: parseScriptSelfDedupCorpusDocument([]),
    source: "empty",
  };
}

export async function saveLocalScriptSelfDedupCorpus(
  ctx: Pick<StageContext, "keyPrefix">,
  corpus: ParsedScriptSelfDedupCorpus,
  writeObject: LocalScriptSelfDedupObjectWriter = async (key, body) => putObject(key, body, {
    contentType: "application/json",
  }),
): Promise<void> {
  await writeObject(
    localScriptSelfDedupIndexKey(ctx),
    Buffer.from(serializeScriptSelfDedupCorpus(corpus), "utf8"),
  );
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
  if (!hasAnthropicKey()) return;
  try {
    const out = await claudeJson<{ violation?: boolean; category?: string; reason?: string }>({
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

export interface LocalScriptSelfDedupRuntime {
  readObject?: LocalScriptSelfDedupObjectReader;
  writeObject?: LocalScriptSelfDedupObjectWriter;
  now?: () => number;
  reservationAuthority?: LocalScriptSelfDedupReservationAuthority;
  sleep?: (ms: number) => Promise<void>;
  createLeaseToken?: (ctx: StageContext) => string;
}

/**
 * The provider-free portion of originality_gate, kept injectable so its R2
 * corpus behavior can be tested without treating unavailable storage as a
 * successful comparison.
 */
export async function runLocalScriptSelfDedup(
  ctx: StageContext,
  runtime: LocalScriptSelfDedupRuntime = {},
): Promise<{
  originalityOk: true;
  maxLexicalShingleSimilarity: number;
  scriptSelfDedupReceipt: ReturnType<typeof evaluateLocalScriptSelfDedup>["receipt"];
}> {
  const authority = runtime.reservationAuthority ?? convexLocalScriptSelfDedupReservationAuthority();
  const lease: LocalScriptSelfDedupLeaseArgs = {
    ownerId: ctx.ownerId,
    channelId: ctx.channelId,
    runId: ctx.runId,
    leaseToken: (runtime.createLeaseToken ?? defaultLeaseToken)(ctx),
  };
  await acquireLocalScriptSelfDedupLease({
    authority,
    lease,
    log: ctx.log,
    sleep: runtime.sleep ?? delay,
  });

  try {
    const text = str(ctx, "narrationText");
    const loaded = await loadLocalScriptSelfDedupCorpus(ctx, runtime.readObject);
    const evaluation = evaluateLocalScriptSelfDedup({
      script: text,
      corpus: loaded.corpus,
      corpusSource: loaded.source,
      threshold: Number(ctx.params["threshold"] ?? 0.92),
    });
    const receipt = evaluation.receipt;
    ctx.log(
      `originality_gate: local lexical self-dedup measured ${receipt.highestLexicalShingleSimilarity.toFixed(3)} against ${receipt.comparableCorpusEntries} comparable R2 scripts; ${receipt.legacyUnmeasuredCorpusEntries} legacy embedding entries remain unmeasured/non-comparable`,
    );
    assertLocalScriptSelfDedupPass(receipt);

    // A holder that cannot renew may have expired or been fenced by a later
    // Convex transaction. Never write a corpus snapshot after that point.
    if (!await authority.renew(lease)) {
      throw new Error("originality_gate: lost the durable lexical self-dedup reservation before R2 persistence");
    }

    // Reserve this lexical fingerprint in the channel corpus only after it passes.
    const topic = typeof ctx.store["topic"] === "string" ? ctx.store["topic"] : "";
    const nextCorpus = appendScriptSelfDedupCorpusEntry(
      loaded.corpus,
      createLocalScriptLexicalCorpusEntry({
        candidate: evaluation.candidate,
        runId: ctx.runId,
        topic,
        recordedAtMs: (runtime.now ?? Date.now)(),
      }),
    );
    await saveLocalScriptSelfDedupCorpus(ctx, nextCorpus, runtime.writeObject);
    return {
      originalityOk: true,
      maxLexicalShingleSimilarity: receipt.highestLexicalShingleSimilarity,
      scriptSelfDedupReceipt: receipt,
    };
  } finally {
    try {
      const released = await authority.release(lease);
      if (!released) {
        ctx.log("originality_gate: lexical self-dedup reservation was already released or fenced; it will not be treated as a pass without the persisted receipt");
      }
    } catch (error) {
      // The persisted R2 receipt is already durable; a best-effort release may
      // fail transiently and the bounded Convex lease will recover safely.
      ctx.log(`originality_gate: could not release lexical self-dedup reservation: ${error instanceof Error ? error.message : error}`);
    }
  }
}

export const originalityGate: Block = {
  id: "originality_gate",
  consumes: ["narrationText"],
  produces: ["originalityOk", "maxLexicalShingleSimilarity", "scriptSelfDedupReceipt"],
  run: async (ctx) => {
    const text = str(ctx, "narrationText");
    // Policy-scan the ACTUAL spoken lines (the pre-engine gate saw only the topic).
    await scanSpokenLines(text, (m) => ctx.log(m));
    return runLocalScriptSelfDedup(ctx);
  },
};

export const complianceCheck: Block = {
  id: "compliance_check",
  consumes: ["topic"],
  produces: ["disclosureRequired", "sensitiveTopic", "complianceNote"],
  run: async (ctx) => {
    const topic = str(ctx, "topic");
    const niche = (ctx.store["niche"] as string | undefined) ?? "";
    if (!hasAnthropicKey()) {
      return { disclosureRequired: false, sensitiveTopic: false, complianceNote: "" };
    }
    let sensitive = false;
    let synthRealistic = false;
    let reason = "";
    try {
      const out = await claudeJson<{
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
