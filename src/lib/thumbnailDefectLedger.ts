/**
 * SELF-WRITING CRITIC DOCTRINE.
 *
 * `criticDoctrine` is read from `channel.identity.creativeBrief.criticDoctrine`
 * — a hand-authored field. Nothing derives it. So when the QA grader rejects
 * the same defect on a channel for the fifth time, the channel has learned
 * nothing: the next video re-rolls the identical mistake, pays for the
 * identical rejection, and the operator is the only memory in the loop.
 *
 * `priorIssues` already feeds rejections back — but only WITHIN one video. The
 * moment that video ships, the lesson is discarded.
 *
 * This accumulates rejections per channel and promotes the ones that keep
 * recurring into standing doctrine. Two deliberate constraints:
 *
 *  - Promotion needs REPETITION, not a single bad roll. One rejection is noise;
 *    a defect that survives three separate videos is a channel-level blind spot.
 *  - Doctrine DECAYS. A rule that stops recurring stops being cited, so the
 *    brief cannot silently accumulate a hundred stale commandments that crowd
 *    out the identity contract and the golden bar.
 *
 * Without both, this becomes a prompt that grows forever and quietly degrades
 * every render — which is worse than not learning at all.
 */

/** Recurring defect families, matched from free-text QA rejection reasons. */
const DEFECT_PATTERNS: readonly { id: string; test: RegExp; doctrine: string }[] = [
  {
    id: "hero-too-small",
    test: /hero (is )?too small|subject too small|not dominant|lost in the frame|too much background/i,
    doctrine: "Stage the hero far larger than feels natural — it has repeatedly shipped too small on this channel.",
  },
  {
    id: "copy-illegible",
    test: /illegible|unreadable|cannot be read|too small to read|hard to read/i,
    doctrine: "Oversize the headline and raise its contrast against whatever sits behind it; copy has repeatedly been unreadable at browse size on this channel.",
  },
  {
    id: "instruction-leak",
    test: /instruction words|renders art-direction|leaked/i,
    doctrine: "Render ONLY the planned headline words. This channel has repeatedly baked art-direction language into the artwork.",
  },
  {
    id: "misspelled",
    test: /misspell|should read/i,
    doctrine: "Spell every visible word exactly as quoted; misspelled copy has repeatedly shipped on this channel.",
  },
  {
    id: "identity-breach",
    test: /identity contract|must show|must not show|prohibited/i,
    doctrine: "Re-read the channel identity contract before inventing the scene; this channel has repeatedly broken its own must-show rules.",
  },
  {
    id: "muddy-at-browse",
    test: /muddy blur|browse size|120px/i,
    doctrine: "Build one forceful contrast system; this channel's frames have repeatedly collapsed into mush at browse size.",
  },
  {
    id: "generic-subject",
    test: /inert|weak subject|no consequence|not the hero|trivia/i,
    doctrine: "Lead with the consequence and the thing the viewer actually came for; this channel has repeatedly chosen a weak subject.",
  },
  {
    id: "cliche",
    test: /cliché|cliche|generic|stock|render aesthetic|game art/i,
    doctrine: "Reject the first idea that arrives; this channel has repeatedly produced generic or stock-looking imagery.",
  },
];

export interface DefectObservation {
  /** Which video produced it, so repeats across videos can be distinguished. */
  videoKey: string;
  /** Free-text QA rejection reason. */
  reason: string;
  at: number;
}

export interface ChannelDefectLedger {
  channelName: string;
  observations: DefectObservation[];
}

export interface PromotedDoctrine {
  defectId: string;
  doctrine: string;
  /** Distinct videos on which this defect was seen. */
  videoCount: number;
}

export function classifyThumbnailDefects(reason: string): string[] {
  return DEFECT_PATTERNS.filter((pattern) => pattern.test.test(reason)).map((pattern) => pattern.id);
}

export function recordThumbnailDefect(
  ledger: ChannelDefectLedger,
  observation: DefectObservation,
  /** Keep the ledger bounded; doctrine is about recent behaviour. */
  maxObservations = 200,
): ChannelDefectLedger {
  const observations = [...ledger.observations, observation].slice(-maxObservations);
  return { ...ledger, observations };
}

/**
 * Promote defects that recur across DISTINCT videos into standing doctrine.
 *
 * Counting distinct videos rather than raw rejections matters: the critique
 * loop can reject the same candidate three times in one run, and that is one
 * bad video, not a channel-level pattern.
 */
export function deriveCriticDoctrine(args: {
  ledger: ChannelDefectLedger;
  /** Distinct videos a defect must appear on before it becomes doctrine. */
  minVideos?: number;
  /** Ignore observations older than this, so doctrine decays. */
  windowMs?: number;
  now?: number;
  /** Cap the doctrine so it cannot crowd out the identity contract. */
  maxRules?: number;
}): { rules: PromotedDoctrine[]; doctrine: string } {
  const minVideos = args.minVideos ?? 3;
  const windowMs = args.windowMs ?? 90 * 24 * 60 * 60 * 1000;
  const now = args.now ?? Date.now();
  const maxRules = args.maxRules ?? 4;

  const videosByDefect = new Map<string, Set<string>>();
  for (const observation of args.ledger.observations) {
    if (now - observation.at > windowMs) continue;
    for (const defectId of classifyThumbnailDefects(observation.reason)) {
      const seen = videosByDefect.get(defectId) ?? new Set<string>();
      seen.add(observation.videoKey);
      videosByDefect.set(defectId, seen);
    }
  }

  const rules: PromotedDoctrine[] = [];
  for (const pattern of DEFECT_PATTERNS) {
    const videoCount = videosByDefect.get(pattern.id)?.size ?? 0;
    if (videoCount >= minVideos) {
      rules.push({ defectId: pattern.id, doctrine: pattern.doctrine, videoCount });
    }
  }
  // Most persistent first, so the cap keeps the worst offenders.
  rules.sort((left, right) => right.videoCount - left.videoCount);
  const kept = rules.slice(0, maxRules);
  return {
    rules: kept,
    doctrine: kept.map((rule) => rule.doctrine).join(" "),
  };
}
