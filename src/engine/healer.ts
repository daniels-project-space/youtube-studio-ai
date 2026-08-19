/**
 * SELF-HEALER — the run-level organ of the Pipeline Doctor.
 *
 * When a run fails its QA gate, the old behavior discarded every paid artifact
 * (footage, narration, music, inserts) over a defect that one cheap block
 * could fix — a render died over an intro-card title while ~$1 of good work
 * sat in the store. The healer:
 *
 *   1. DIAGNOSES the failure against a catalog of known, bounded defect
 *      classes (our own QA strings — deterministic matching, no LLM guessing),
 *   2. maps each defect to the BLOCK THAT OWNS it,
 *   3. computes the downstream closure (every block consuming a re-produced
 *      key, transitively, by the declared produces/consumes contract),
 *   4. supersedes exactly those stage rows so the engine's resume re-runs
 *      them from the cached store — paid upstream blocks are never re-spent.
 *
 * Unmatched or explicitly unhealable failures (e.g. narration length — fixing
 * it means regenerating paid speech) return null: the run fails HONESTLY.
 */

export interface HealableBlock {
  id: string;
  produces: string[];
  consumes: string[];
  paid?: boolean;
}

/**
 * TYPED HEAL CLASS — the repair STRATEGY a defect implies, DECLARED once at the
 * defect catalog instead of re-derived downstream by grepping the hint prose.
 *
 * This exists because of a real production incident: `timeline_assemble` chose
 * between a ~4-min surgical re-finish and a ~40-min full rebuild by running a
 * regex over the free-text heal hints. The hints are human prose whose wording
 * is not a contract, so the match silently stopped firing and every overlay
 * heal paid the full recompose — a permanent, invisible heal outage. A repair
 * strategy is a property of the DEFECT CLASS, so the catalog that already knows
 * the defect class must state it; a consumer must never infer it from wording.
 *
 * The three classes correspond to the three real repair surfaces:
 *   - `overlay_finish` — the defect lives in the FINISHING pass, which runs over
 *     the persisted pre-overlay master (overlay/caption/insert compositing and
 *     the final loudnorm). Repairable without rebuilding the body.
 *   - `body_rebuild`  — the defect lives in the BODY or the compose output that
 *     the pre-overlay master already baked in (footage choice, cuts, black/dead
 *     air, the folded outro, the music mix). The timeline must be rebuilt.
 *   - `asset_regen`   — the defect lives in a standalone artifact produced by
 *     another block (intro card, thumbnail, metadata), not in the timeline.
 *
 * Each rule's class below is taken from that rule's own declared label, so the
 * catalog stays self-consistent and reviewable.
 */
export type HealClass = "overlay_finish" | "body_rebuild" | "asset_regen";

export interface HealPlan {
  /** Blocks to supersede (owner blocks + downstream closure), pipeline order. */
  rerunBlocks: string[];
  /** Human-readable diagnosis for logs/alerts. */
  reason: string;
  /** Per-block guidance derived from the defect text (seeded as store.healHints). */
  hints: Record<string, string[]>;
  /**
   * Per-block DECLARED repair strategy (seeded as store.healClasses). A block
   * switches on this directly; it never has to pattern-match `hints`. Only
   * blocks with a matched rule/signal appear here — a block pulled in purely by
   * the downstream closure has no declared class, and its consumer must fall
   * back to its most conservative repair.
   */
  healClasses: Record<string, HealClass[]>;
  /** Structured, reviewer-grounded repair instructions for the next heal pass. */
  visualRepair?: VisualRepairSignal[];
}

/**
 * A visual reviewer may only request one of these bounded owner actions.  This
 * deliberately lives beside the healer rather than in a model prompt: free-form
 * model prose must never choose an arbitrary block to execute.
 */
export type VisualRepairOwner =
  | "motion_comic"
  | "timeline_assemble"
  | "stock_footage"
  | "intro_card";

export type VisualRepairAction =
  | "reflow_bubble"
  | "recompose_overlay"
  | "resample_footage"
  | "rerender_card"
  | "rebuild_timeline";

export interface VisualRepairSignal {
  schemaVersion: 1;
  owner: VisualRepairOwner;
  action: VisualRepairAction;
  category: string;
  severity: "critical" | "major" | "minor";
  startSec: number;
  endSec: number;
  observed: string;
  expected: string;
  confidence: number;
  evidenceKey?: string;
  frameIds?: string[];
  targetId?: string;
  /** Normalized panel rectangles that must not be reused by a comic reflow. */
  forbiddenRects?: Array<[number, number, number, number]>;
}

interface HealRule {
  /** Matches against the QA failure message. */
  match: RegExp;
  /** The block that owns this defect class. */
  owner: string;
  label: string;
  /** DECLARED repair strategy for this defect class — see `HealClass`. */
  healClass: HealClass;
}

/**
 * A bounded reviewer action already names its repair surface, so the class is a
 * total function of the action rather than a second thing to keep in sync.
 */
const VISUAL_REPAIR_HEAL_CLASS: Readonly<Record<VisualRepairAction, HealClass>> = {
  // A speech bubble / overlay is composited in the finishing pass.
  reflow_bubble: "overlay_finish",
  recompose_overlay: "overlay_finish",
  // New clips mean a new body.
  resample_footage: "body_rebuild",
  // A card is a standalone artifact its own block re-renders.
  rerender_card: "asset_regen",
  rebuild_timeline: "body_rebuild",
};

/**
 * Defect catalog — built from REAL observed failures, not speculation. Order
 * matters only for labeling; all matching rules contribute owners.
 */
const HEAL_RULES: HealRule[] = [
  {
    match: /(title|intro)\s*card[^|]*?(incomplete|faded|illegible|unreadable|blank|cut[\s-]?off|missing|grey|gray|garbled)/i,
    owner: "intro_card",
    label: "intro card defect → re-render card + re-compose",
    healClass: "asset_regen",
  },
  {
    match: /outro[^|]*?(blank|empty|missing|garbled|unreadable)/i,
    owner: "timeline_assemble",
    label: "outro card defect → re-compose timeline",
    // The outro is folded in during compose, so the pre-overlay master already
    // contains the broken card — re-finishing would preserve the defect.
    healClass: "body_rebuild",
  },
  {
    match: /dead air|black (at|screen|segment)|frozen frame/i,
    owner: "timeline_assemble",
    label: "dead-air/black segment → rebuild body (black-guard re-cuts)",
    healClass: "body_rebuild",
  },
  {
    match: /quotes missing: \d+ generated but 0 composited|data inserts missing/i,
    owner: "timeline_assemble",
    label: "overlays not composited → re-compose timeline",
    healClass: "overlay_finish",
  },
  {
    // New deterministic QA gates (2026-07): captions burned, intro/outro
    // presence, and audible music are now hard-gated — each is owned by a
    // cheap re-run, never a reason to discard the paid store.
    match: /captions missing: \d+ cues prepared/i,
    owner: "timeline_assemble",
    label: "caption burn failed → re-finish timeline",
    healClass: "overlay_finish",
  },
  {
    match: /intro card missing: intro_card render failed/i,
    owner: "intro_card",
    label: "intro card render failed → re-render card + re-compose",
    healClass: "asset_regen",
  },
  {
    match: /outro card missing: outro render\/compose failed/i,
    owner: "timeline_assemble",
    label: "outro card failed → re-compose timeline",
    healClass: "body_rebuild",
  },
  {
    match: /music missing from mix/i,
    owner: "timeline_assemble",
    label: "music inaudible in final mix → re-compose with the produced track",
    // Music is mixed during compose, upstream of the pre-overlay master.
    healClass: "body_rebuild",
  },
  {
    match: /audio loudness .* outside the sane band/i,
    owner: "timeline_assemble",
    label: "mix loudness out of band → re-finish (loudnorm pass)",
    // The loudnorm pass lives in the finishing stage, exactly as this rule's
    // label has always said. The prose regex it replaces could not see that
    // (the QA string carries no overlay/caption wording), so this defect class
    // silently paid a full recompose to redo a step the cheap path performs.
    healClass: "overlay_finish",
  },
  {
    // Watch-caught OFF-WORLD footage (subject fits, grade/world doesn't —
    // "hands untying a journal on a plain white surface… contradicts the
    // channel's visual world"). Re-source footage with the stricter gate; the
    // heal hint makes the gate harder on exactly this defect.
    match: /footage[^|]*?(contradicts|clash|jarring|irrelevant|out of place)|contradicts the channel'?s visual world/i,
    owner: "stock_footage",
    label: "off-world footage → re-source clips with a stricter grade gate",
    healClass: "body_rebuild",
  },
  {
    // A missing persisted artifact is recoverable: thumbnail_gen reuses its
    // immutable paid-generation checkpoint and retries only the storage/write
    // work. Quality rejection is deliberately excluded. The generation and QA
    // request identities do not change during self-heal, so replaying an
    // illegible/below-bar candidate would only re-read the identical rejected
    // checkpoint and waste Trigger/Convex cycles.
    match: /thumbnail missing/i,
    owner: "thumbnail_gen",
    label: "thumbnail artifact missing → restore checkpoint + persist",
    healClass: "asset_regen",
  },
  {
    match: /seo score \d|title \d+ chars|description too (short|long)/i,
    owner: "metadata",
    label: "metadata defect → regenerate SEO",
    healClass: "asset_regen",
  },
];

/**
 * Defects healing CANNOT fix without re-spending paid generation — fail
 * honestly instead of thrashing. (Length problems live in the paid script/TTS.)
 */
const UNHEALABLE =
  // NOTE: includes the REAL qa_visual length string ("(length): video 848s vs
  // target 660s") and the precheck — the old regex expected "video/target"
  // literally and let length failures through to a doomed paid heal cycle.
  /length_check|length_precheck|lengthRatio|duration_max|durationSec.*(<=|>=)|video\/target|\(length\): video \d+|narration.*(too )?(short|long)/i;

/** Transitive downstream closure over the declared produces/consumes graph. */
function downstreamClosure(ownerIds: Set<string>, blocks: HealableBlock[]): string[] {
  const set = new Set(ownerIds);
  let changed = true;
  while (changed) {
    changed = false;
    const produced = new Set(
      blocks.filter((b) => set.has(b.id)).flatMap((b) => b.produces),
    );
    for (const b of blocks) {
      if (set.has(b.id)) continue;
      if (b.consumes.some((c) => produced.has(c))) {
        set.add(b.id);
        changed = true;
      }
    }
  }
  // Preserve pipeline order.
  return blocks.filter((b) => set.has(b.id)).map((b) => b.id);
}

/**
 * PER-CHANNEL HEAL GROUNDING (P1-1).
 *
 * Deliberately bounded. Which blocks re-run stays a purely deterministic
 * function of the defect catalog and the produces/consumes graph — free-form
 * channel prose must never be able to elect a block for paid re-execution.
 * What the doctrine DOES do is travel with the hints: those strings are seeded
 * into `store.healHints` and land in the re-running block's own generation
 * prompt, so a repair regenerates toward THIS channel's standard instead of a
 * generic one.
 */
export interface HealChannelContext {
  contentLaneKey?: string;
  criticDoctrine?: string;
  styleGrammar?: string;
}

function boundedDoctrine(channel?: HealChannelContext): string | undefined {
  const doctrine = channel?.criticDoctrine?.replace(/\s+/g, " ").trim().slice(0, 240);
  return doctrine || undefined;
}

/**
 * Diagnose a failed run and plan the surgical re-run. Returns null when the
 * failure isn't in the catalog (or is explicitly unhealable) — the caller
 * must then fail the run honestly.
 */
export function planHeal(
  failureMsg: string,
  blocks: HealableBlock[],
  log: (msg: string) => void = () => {},
  visualRepair: readonly VisualRepairSignal[] = [],
  channel?: HealChannelContext,
): HealPlan | null {
  if (!failureMsg) return null;

  const owners = new Set<string>();
  const labels: string[] = [];
  const hints: Record<string, string[]> = {};
  const healClasses: Record<string, HealClass[]> = {};
  const declareClass = (owner: string, healClass: HealClass): void => {
    const declared = (healClasses[owner] ??= []);
    if (!declared.includes(healClass)) declared.push(healClass);
  };

  for (const rule of HEAL_RULES) {
    const m = failureMsg.match(rule.match);
    if (!m) continue;
    if (!blocks.some((b) => b.id === rule.owner)) continue; // block not in this pipeline
    owners.add(rule.owner);
    labels.push(rule.label);
    (hints[rule.owner] ??= []).push(m[0].slice(0, 200));
    declareClass(rule.owner, rule.healClass);
  }

  // Structured reviewer signals are intentionally handled separately from the
  // legacy regex catalog.  In particular, do not add a broad /overlay/ rule:
  // a model's vague aesthetic complaint must never start a paid rerender loop.
  const acceptedVisualRepair: VisualRepairSignal[] = [];
  for (const signal of visualRepair) {
    if (signal.severity === "minor") continue;
    if (!blocks.some((block) => block.id === signal.owner)) {
      log(`healer: visual repair owner ${signal.owner} is not in this pipeline; leaving it for human review`);
      continue;
    }
    owners.add(signal.owner);
    labels.push(`visual ${signal.category} → ${signal.action}`);
    const at = Number.isFinite(signal.startSec) ? ` @${signal.startSec.toFixed(1)}s` : "";
    (hints[signal.owner] ??= []).push(
      `[visual-review${at}] ${signal.category}: ${signal.observed}`.slice(0, 300),
    );
    declareClass(signal.owner, VISUAL_REPAIR_HEAL_CLASS[signal.action]);
    acceptedVisualRepair.push(signal);
  }

  // Structured reviewer signals are intentionally handled separately from the
  // legacy regex catalog.  In particular, do not add a broad /overlay/ rule:
  // a model's vague aesthetic complaint must never start a paid rerender loop.
  const acceptedVisualRepair: VisualRepairSignal[] = [];
  for (const signal of visualRepair) {
    if (signal.severity === "minor") continue;
    if (!blocks.some((block) => block.id === signal.owner)) {
      log(`healer: visual repair owner ${signal.owner} is not in this pipeline; leaving it for human review`);
      continue;
    }
    owners.add(signal.owner);
    labels.push(`visual ${signal.category} → ${signal.action}`);
    const at = Number.isFinite(signal.startSec) ? ` @${signal.startSec.toFixed(1)}s` : "";
    (hints[signal.owner] ??= []).push(
      `[visual-review${at}] ${signal.category}: ${signal.observed}`.slice(0, 300),
    );
    acceptedVisualRepair.push(signal);
  }

  if (owners.size === 0) {
    if (UNHEALABLE.test(failureMsg)) {
      log("healer: failure is in the UNHEALABLE class (length/duration — fixing means re-spending paid generation) — failing honestly");
    } else {
      log("healer: no catalog rule matches this failure — failing honestly (candidate for a new heal rule)");
    }
    return null;
  }

  // If the failure ALSO contains an unhealable defect, healing the cosmetic
  // part would still fail QA on the unhealable one — don't waste the cycles.
  if (UNHEALABLE.test(failureMsg)) {
    log(`healer: matched [${labels.join("; ")}] but the failure also contains an UNHEALABLE defect — failing honestly`);
    return null;
  }

  const rerunBlocks = downstreamClosure(owners, blocks);
  const paidReruns = blocks
    .filter((b) => rerunBlocks.includes(b.id) && b.paid && !owners.has(b.id))
    .map((b) => b.id);
  if (paidReruns.length) {
    log(`healer: closure re-runs paid block(s) [${paidReruns.join(", ")}] as downstream consumers (small spend, accepted)`);
  }

  // Attach the channel's own standard to every block that is about to
  // regenerate. This changes WHAT the repair aims at, never WHICH blocks run —
  // the rerun set above is already fixed by this point.
  const doctrine = boundedDoctrine(channel);
  const laneKey = channel?.contentLaneKey?.trim();
  if (doctrine || laneKey) {
    const grounding = [
      laneKey ? `content lane: ${laneKey}` : "",
      doctrine ? `channel critic doctrine: ${doctrine}` : "",
    ].filter(Boolean).join(" | ");
    for (const owner of owners) {
      (hints[owner] ??= []).push(`[channel-grounding] ${grounding}`.slice(0, 300));
    }
    log(`healer: heal hints grounded in ${doctrine ? "the channel's critic doctrine" : "the channel's content lane"}${laneKey ? ` (${laneKey})` : ""}`);
  }

  return {
    rerunBlocks,
    reason: labels.join("; "),
    hints,
    healClasses,
    ...(acceptedVisualRepair.length ? { visualRepair: acceptedVisualRepair } : {}),
  };
}
