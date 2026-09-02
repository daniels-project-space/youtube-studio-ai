/**
 * `regroundChannel` — the NARROW repair for legacy channels that predate Style
 * DNA and therefore carry no `styleDNA` / `qaRubric`.
 *
 * WHY THIS EXISTS
 * ---------------
 * `architectPipelineTask` hard-refuses to re-architect a channel with no
 * `styleDNA` ("the architect refuses to design blind"). The only producer of
 * that field is `designChannelInception`, which re-runs the ENTIRE inception —
 * it renames the channel, re-writes persona/identity/creative brief, re-casts
 * the voice and regenerates channel art, at meaningful LLM + image cost. For a
 * channel whose brand is already live and already correct, that is the wrong
 * tool: it would replace a working identity to fix a missing derivative of it.
 *
 * This module does the opposite. It treats the channel's ALREADY-STORED
 * identity (persona, niche, styleGrammar, palette, name) as CANON and derives
 * ONLY the two missing artefacts from it:
 *
 *      styleDNA  = synthStyleDNA(<existing identity> + read-only research)
 *      qaRubric  = buildQualityBar(family, styleDNA, now)
 *
 * Nothing else is ever written. `name`, `persona`, `identity`, `creativeBrief`,
 * `voiceId`, `pipeline`, `template`, `schedule` and every other field are
 * untouched inputs, never outputs. That invariant is not a convention here — it
 * is enforced structurally by `buildRegroundPatch`, which throws if the computed
 * patch ever grows a key outside `REGROUND_PATCH_FIELDS`, and is covered by
 * `src/engine/__tests__/regroundChannel.test.ts`.
 *
 * PERSONA IS SAFE BY CONSTRUCTION
 * -------------------------------
 * `synthStyleDNA` takes `persona` as an INPUT it is told to treat as canon
 * ("OPERATOR PERSONA — CANON, not a suggestion") and its return type is
 * `StyleDNA` — a visual/audio/narrative spec. It has no code path that emits a
 * replacement persona, and even if it grew one, `buildRegroundPatch` selects
 * fields explicitly (never spreads) so it could not reach the channel row.
 *
 * FAMILY MUST BE EXPLICIT
 * -----------------------
 * `family` drives both the DNA prompt (narrated vs not, engine motion limits)
 * and the quality-bar dimensions. Legacy rows have no stored `family`, and the
 * legacy `template` letter collapses whiteboard/shorts/comic into
 * `narrated_stock` — guessing would silently grade a channel against the wrong
 * scorecard forever. So the caller MUST pass it, and if the row DOES have a
 * stored family the argument has to agree with it.
 *
 * DEFAULT IS REFUSE-IF-ALREADY-SET
 * --------------------------------
 * A channel that already has `styleDNA` is left alone (`reason:
 * "already-grounded"`, zero writes) unless the caller passes `force: true`.
 * Re-grounding an established channel would re-roll its frozen visual identity,
 * which every shipped video was generated against.
 *
 * This file is the PURE core: every side effect arrives via `RegroundDeps`, so
 * it is fully unit-testable against fakes and never needs a real channel row.
 * The Trigger.dev wrapper lives in `src/trigger/regroundChannel.ts`.
 */
import { FAMILY_KEYS, type FamilyKey } from "@/engine/families";
import {
  assertPersistedProgramBriefIdentity,
  type ChannelProgramBrief,
} from "@/engine/channelProgramBrief";
import type { QualityBar, StyleDNA } from "./types";
import type {
  DatabankSignals,
  StyleDNAInput,
  ThumbnailStyleGuide,
} from "./styleDNA";

export type RegroundLogger = (msg: string, extra?: Record<string, unknown>) => void;

/**
 * The ONLY channel fields this operation may ever write. Widening this list is
 * a deliberate scope change: the whole point of the task is that a legacy
 * channel's brand survives it untouched.
 */
export const REGROUND_PATCH_FIELDS = ["styleDNA", "qaRubric"] as const;
export type RegroundPatchField = (typeof REGROUND_PATCH_FIELDS)[number];

/** Exactly the two derived artefacts — nothing else is representable. */
export interface RegroundPatch {
  styleDNA: StyleDNA;
  qaRubric: QualityBar;
}

/** The subset of a channel row this operation READS. All of it is input-only. */
export interface RegroundChannelRecord {
  _id: string;
  ownerId: string;
  name: string;
  family?: string;
  template?: string;
  styleDNA?: StyleDNA | null;
  qaRubric?: QualityBar | null;
  identity?: {
    programBrief?: ChannelProgramBrief;
    nicheKey?: string;
    niche?: string;
    persona?: string;
    styleGrammar?: string;
    palette?: string[];
  } | null;
}

/** Read-only niche research used to ground the DNA (never written back). */
export interface RegroundGrounding {
  titles?: string[];
  powerWords?: string[];
  thumbnailStyleGuide?: ThumbnailStyleGuide;
  databank?: DatabankSignals;
}

export interface RegroundArgs {
  channelId: string;
  /** REQUIRED. Never inferred from `template` — see the header note. */
  family: FamilyKey;
  /** Overwrite an existing styleDNA. Off by default; re-rolls a frozen identity. */
  force?: boolean;
  /** Compute and return the patch without writing anything. */
  dryRun?: boolean;
}

export interface RegroundDeps {
  loadChannel: (channelId: string) => Promise<RegroundChannelRecord | null>;
  /** Read-only competitor/SEO signals for the channel's niche. */
  loadGrounding: (ownerId: string, niche?: string) => Promise<RegroundGrounding>;
  synth: (input: StyleDNAInput) => Promise<StyleDNA>;
  buildBar: (family: FamilyKey, dna: StyleDNA, now: number) => QualityBar;
  /** Applies the patch. Receives ONLY `REGROUND_PATCH_FIELDS`. */
  patchChannel: (channelId: string, patch: RegroundPatch) => Promise<unknown>;
  now: () => number;
  log?: RegroundLogger;
}

export type RegroundSkipReason = "already-grounded" | "channel-not-found" | "channel-locked";

export type RegroundResult =
  | { ok: false; reason: RegroundSkipReason; wrote: false }
  | {
      ok: true;
      wrote: boolean;
      dryRun: boolean;
      forced: boolean;
      family: FamilyKey;
      fields: RegroundPatchField[];
      confidence: number;
      groundingGaps: string[];
      /** Whatever the write path returned (e.g. Convex's accepted update). */
      writeOutcome?: unknown;
    };

/**
 * Guard the invariant. Throws unless `patch` carries EXACTLY the allowlisted
 * fields — no extras (a leaked `name`/`identity` would be caught here) and no
 * omissions.
 */
export function assertRegroundPatch(patch: Record<string, unknown>): void {
  const got = Object.keys(patch).sort();
  const want = [...REGROUND_PATCH_FIELDS].sort();
  const same = got.length === want.length && got.every((k, i) => k === want[i]);
  if (!same) {
    throw new Error(
      `reground patch may write ONLY [${want.join(", ")}] — got [${got.join(", ") || "nothing"}]`,
    );
  }
}

/**
 * Build the patch by EXPLICIT selection (never a spread of the channel or of
 * the synth result), then assert the invariant. Both halves matter: selection
 * makes a leak impossible, the assertion makes a future edit that breaks the
 * selection fail loudly instead of silently widening the blast radius.
 */
export function buildRegroundPatch(styleDNA: StyleDNA, qaRubric: QualityBar): RegroundPatch {
  const patch: RegroundPatch = { styleDNA, qaRubric };
  assertRegroundPatch(patch as unknown as Record<string, unknown>);
  return patch;
}

/**
 * Validate that a REAL family was supplied. Deliberately has no `template`
 * parameter and no default — there is no code path here that can guess.
 */
export function assertExplicitFamily(family: unknown): FamilyKey {
  if (typeof family !== "string" || family.trim().length === 0) {
    throw new Error(
      "reground-channel requires an EXPLICIT `family` — it is never inferred " +
        `from template. Pass one of: ${FAMILY_KEYS.join(", ")}`,
    );
  }
  if (!(FAMILY_KEYS as readonly string[]).includes(family)) {
    throw new Error(
      `unknown family "${family}" — expected one of: ${FAMILY_KEYS.join(", ")}`,
    );
  }
  return family as FamilyKey;
}

/**
 * Reground a channel: derive `styleDNA` + `qaRubric` from its existing stored
 * identity and write ONLY those two fields.
 */
export async function regroundChannelCore(
  args: RegroundArgs,
  deps: RegroundDeps,
): Promise<RegroundResult> {
  const log = deps.log ?? (() => {});
  // Validate BEFORE any I/O so a bad call cannot even read a channel.
  const family = assertExplicitFamily(args.family);

  const channel = await deps.loadChannel(args.channelId);
  if (!channel) {
    log("reground: channel not found — nothing written", { channelId: args.channelId });
    return { ok: false, reason: "channel-not-found", wrote: false };
  }

  // A stored family is authoritative; the caller must agree with it. This stops
  // a mistyped mapping from grading a channel against the wrong scorecard.
  const stored = typeof channel.family === "string" ? channel.family.trim() : "";
  if (stored && stored !== family) {
    throw new Error(
      `channel ${args.channelId} has family "${stored}" but "${family}" was passed — ` +
        "reground never changes a channel's family; fix the argument",
    );
  }

  if (channel.styleDNA && !args.force) {
    log("reground: channel already has styleDNA — refusing (pass force to re-ground)", {
      channelId: args.channelId,
    });
    return { ok: false, reason: "already-grounded", wrote: false };
  }

  const identity = channel.identity ?? {};
  const programBrief = assertPersistedProgramBriefIdentity(identity, {
    context: "reground channel identity",
    expectedFamily: family,
  });
  const researchNiche = programBrief?.nicheKey ?? identity.nicheKey ?? identity.niche;
  const grounding = await deps.loadGrounding(channel.ownerId, researchNiche);
  const now = deps.now();

  // EVERY creative input below is read straight off the existing row. Nothing
  // here invents a name, persona or brief — `persona` in particular is handed
  // to the distiller as canon it must embody, not something it may replace.
  const styleDNA = await deps.synth({
    family,
    name: channel.name,
    programBrief,
    niche: identity.niche,
    persona: identity.persona,
    styleGrammar: identity.styleGrammar,
    palette: identity.palette,
    competitorTitles: grounding.titles,
    powerWords: grounding.powerWords,
    thumbnailStyleGuide: grounding.thumbnailStyleGuide,
    databank: grounding.databank,
    now,
    log,
  });
  const qaRubric = deps.buildBar(family, styleDNA, now);
  const patch = buildRegroundPatch(styleDNA, qaRubric);

  const base = {
    ok: true as const,
    dryRun: Boolean(args.dryRun),
    forced: Boolean(args.force),
    family,
    fields: [...REGROUND_PATCH_FIELDS],
    confidence: styleDNA.confidence,
    groundingGaps: styleDNA.groundingGaps,
  };

  if (args.dryRun) {
    log("reground: DRY RUN — nothing written", {
      confidence: styleDNA.confidence,
      gaps: styleDNA.groundingGaps.length,
    });
    return { ...base, wrote: false };
  }

  const writeOutcome = await deps.patchChannel(args.channelId, patch);
  if (
    typeof writeOutcome === "object" &&
    writeOutcome !== null &&
    (writeOutcome as { state?: unknown }).state === "channel_locked"
  ) {
    log("reground: skipped because the owner locked this channel", {
      channelId: args.channelId,
    });
    return { ok: false, reason: "channel-locked", wrote: false };
  }
  log("reground: wrote styleDNA + qaRubric ONLY", {
    channelId: args.channelId,
    confidence: styleDNA.confidence,
    gaps: styleDNA.groundingGaps.length,
  });
  return { ...base, wrote: true, writeOutcome };
}
