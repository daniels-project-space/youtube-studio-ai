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

export interface HealPlan {
  /** Blocks to supersede (owner blocks + downstream closure), pipeline order. */
  rerunBlocks: string[];
  /** Human-readable diagnosis for logs/alerts. */
  reason: string;
  /** Per-block guidance derived from the defect text (seeded as store.healHints). */
  hints: Record<string, string[]>;
}

interface HealRule {
  /** Matches against the QA failure message. */
  match: RegExp;
  /** The block that owns this defect class. */
  owner: string;
  label: string;
}

/**
 * Defect catalog — built from REAL observed failures, not speculation. Order
 * matters only for labeling; all matching rules contribute owners.
 */
const HEAL_RULES: HealRule[] = [
  {
    match: /(title|intro)\s*card[^|]*?(incomplete|faded|illegible|unreadable|blank|cut[\s-]?off|missing|grey|gray|garbled)/i,
    owner: "intro_card",
    label: "intro card defect → re-render card + re-compose",
  },
  {
    match: /outro[^|]*?(blank|empty|missing|garbled|unreadable)/i,
    owner: "timeline_assemble",
    label: "outro card defect → re-compose timeline",
  },
  {
    match: /dead air|black (at|screen|segment)|frozen frame/i,
    owner: "timeline_assemble",
    label: "dead-air/black segment → rebuild body (black-guard re-cuts)",
  },
  {
    match: /quotes missing: \d+ generated but 0 composited|data inserts missing/i,
    owner: "timeline_assemble",
    label: "overlays not composited → re-compose timeline",
  },
  {
    // New deterministic QA gates (2026-07): captions burned, intro/outro
    // presence, and audible music are now hard-gated — each is owned by a
    // cheap re-run, never a reason to discard the paid store.
    match: /captions missing: \d+ cues prepared/i,
    owner: "timeline_assemble",
    label: "caption burn failed → re-finish timeline",
  },
  {
    match: /intro card missing: intro_card render failed/i,
    owner: "intro_card",
    label: "intro card render failed → re-render card + re-compose",
  },
  {
    match: /outro card missing: outro render\/compose failed/i,
    owner: "timeline_assemble",
    label: "outro card failed → re-compose timeline",
  },
  {
    match: /music missing from mix/i,
    owner: "timeline_assemble",
    label: "music inaudible in final mix → re-compose with the produced track",
  },
  {
    match: /audio loudness .* outside the sane band/i,
    owner: "timeline_assemble",
    label: "mix loudness out of band → re-finish (loudnorm pass)",
  },
  {
    // Watch-caught OFF-WORLD footage (subject fits, grade/world doesn't —
    // "hands untying a journal on a plain white surface… contradicts the
    // channel's visual world"). Re-source footage with the stricter gate; the
    // heal hint makes the gate harder on exactly this defect.
    match: /footage[^|]*?(contradicts|clash|jarring|irrelevant|out of place)|contradicts the channel'?s visual world/i,
    owner: "stock_footage",
    label: "off-world footage → re-source clips with a stricter grade gate",
  },
  {
    match: /thumbnail (missing|score \d)|thumbnail[^|]*?(illegible|cluttered|overlaps|amateur)/i,
    owner: "thumbnail_gen",
    label: "thumbnail defect → regenerate thumbnail",
  },
  {
    // The engine's own loud gate rejection (banana/fal judge) — the message
    // never contains the word "thumbnail", so the rule above missed it and a
    // fully rendered run died unhealed (observed live).
    match: /both attempts failed the gate/i,
    owner: "thumbnail_gen",
    label: "thumbnail judge rejection → regenerate thumbnail",
  },
  {
    match: /seo score \d|title \d+ chars|description too (short|long)/i,
    owner: "metadata",
    label: "metadata defect → regenerate SEO",
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
 * Diagnose a failed run and plan the surgical re-run. Returns null when the
 * failure isn't in the catalog (or is explicitly unhealable) — the caller
 * must then fail the run honestly.
 */
export function planHeal(
  failureMsg: string,
  blocks: HealableBlock[],
  log: (msg: string) => void = () => {},
): HealPlan | null {
  if (!failureMsg) return null;

  const owners = new Set<string>();
  const labels: string[] = [];
  const hints: Record<string, string[]> = {};

  for (const rule of HEAL_RULES) {
    const m = failureMsg.match(rule.match);
    if (!m) continue;
    if (!blocks.some((b) => b.id === rule.owner)) continue; // block not in this pipeline
    owners.add(rule.owner);
    labels.push(rule.label);
    (hints[rule.owner] ??= []).push(m[0].slice(0, 200));
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

  return {
    rerunBlocks,
    reason: labels.join("; "),
    hints,
  };
}
