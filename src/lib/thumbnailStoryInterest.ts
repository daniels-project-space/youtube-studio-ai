/**
 * STORY-INTEREST INTELLIGENCE.
 *
 * A thumbnail can be technically excellent and still fail, because the SUBJECT
 * it chose is not intrinsically interesting. The failing case this module was
 * built from: a heist thumbnail rendered a drill biting a vault door under the
 * headline "18 INCHES / OF CONCRETE". The craft was right — one-point
 * perspective, real practical light, a legible mechanism — but concrete is an
 * inert material, and a measurement of an inert material carries no human
 * stake. Compare the sibling candidate that worked: "THE SWITCH / 60 SECONDS",
 * where a person is caught mid-deception and the viewer instantly wants the
 * outcome.
 *
 * The existing gates all check EXECUTION (identity contract, safe zones, copy
 * fidelity, spelling). None of them ask whether the chosen story was worth
 * telling. This scores exactly that, deterministically, so a weak concept is
 * caught and lifted BEFORE any image is paid for.
 */

/** Raw materials, surfaces and containers that carry no stake on their own. */
const INERT_SUBJECTS = [
  "concrete", "cement", "brick", "mortar", "plaster", "drywall", "stone", "rock",
  "steel", "iron", "metal", "alloy", "glass", "wood", "timber", "plastic", "rubber",
  "dirt", "soil", "sand", "gravel", "asphalt", "tarmac",
  "wall", "floor", "ceiling", "slab", "panel", "sheet", "pipe", "cable", "wire",
  "surface", "material", "beam", "girder", "plank", "board", "block",
];

/** Evidence that a human being is present and acting. */
const HUMAN_AGENCY = [
  "hand", "hands", "finger", "fingers", "fist", "palm", "arm", "arms", "shoulder",
  "face", "faces", "eye", "eyes", "mouth", "body", "figure", "silhouette",
  "man", "woman", "men", "women", "person", "people", "child", "children", "crowd",
  "worker", "guard", "thief", "clerk", "driver", "family", "someone", "nobody",
  "gripping", "clutching", "staring", "reaching", "tearing", "running", "watching",
  "shouting", "holding", "pushing", "pulling", "kneeling", "sitting", "standing",
];

/** Consequence, reversal and jeopardy — the reason a viewer clicks. */
const STAKE_WORDS = [
  "vanish", "vanished", "gone", "empty", "lost", "stolen", "missing", "caught",
  "escape", "escaped", "betray", "betrayed", "wrong", "failed", "collapse",
  "ruin", "ruined", "debt", "evicted", "fired", "trapped", "exposed", "blamed",
  "warned", "mistake", "secret", "lie", "lied", "switch", "switched", "swap",
  "swapped", "double", "cross", "trick", "tricked", "fooled", "vanishing",
  "nobody", "never", "late", "quietly", "before", "after", "still", "already",
];

/** Audacity and scale — the "they actually did that?" multiplier. */
const AUDACITY_WORDS = [
  "first", "only", "record", "impossible", "entire", "whole", "daylight",
  "months", "years", "everyone", "alone", "twice", "again", "nobody", "never",
  "without", "inside", "under", "behind", "while",
];

/** Irony / reversal — the strongest single hook in this module's evidence. */
const REVERSAL_WORDS = [
  "empty", "already", "instead", "wrong", "backwards", "reversed", "returned",
  "gave back", "still there", "never was", "switch", "swap", "decoy", "twist",
];

/**
 * What the video is actually ABOUT, which decides who owns the hero slot.
 *
 * The first version of this gate had a single universal rule — a human being
 * carries the stake — and it was wrong for a whole class of video. Asked for
 * "Why The Burj Khalifa Is A Terrible Building" it scored the tower-only
 * concept as inert for having no human in the hero, re-planned, and produced a
 * sanitation worker in the foreground with the show-stopper reduced to haze in
 * the background. For an icon subject the icon IS the draw; a human belongs in
 * the frame as scale or consequence, never in the hero slot instead of it.
 *
 * - `icon`   the video is about a specific famous structure, object or place
 * - `person` the video is about a specific named person; their face is the draw
 * - `event`  a story, process or case; human agency carries the stake (default)
 */
export type SubjectClass = "icon" | "person" | "event";

/** Structures and landmarks that can legitimately own the hero slot. */
const ICON_SUBJECTS = [
  "tower", "skyscraper", "building", "spire", "bridge", "dam", "stadium",
  "cathedral", "monument", "statue", "pyramid", "temple", "palace", "castle",
  "ship", "liner", "aircraft", "jet", "rocket", "station", "terminal",
  "skyline", "structure", "facade", "megastructure",
];

/** Words that place a subject in the dominant hero slot rather than the set. */
const DOMINANCE_MARKERS = [
  "fills", "filling", "dominates", "dominating", "towers", "towering",
  "centred", "centered", "centre", "center", "head", "full", "entire",
  "vertical", "colossal", "immense", "looming", "looms", "soaring", "spanning",
];

/** A person occupying the hero slot. */
const PERSON_HERO = [
  "man", "woman", "worker", "guard", "driver", "figure", "person",
  "face", "portrait", "he", "she",
];

export interface StoryInterestVerdict {
  score: number;
  verdict: "compelling" | "weak" | "inert";
  reasons: string[];
  /** Concrete art-direction corrections that would raise the score. */
  liftPrompts: string[];
}

function tokens(value: string): string[] {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").split(" ").filter(Boolean);
}

function hasAny(list: readonly string[], words: readonly string[]): boolean {
  const set = new Set(words);
  return list.some((item) => set.has(item));
}

/**
 * Score a proposed thumbnail concept for intrinsic story interest.
 *
 * This deliberately reads the HEADLINE and the HERO separately: a strong hero
 * with a headline that only measures something inert is the exact failure this
 * module exists to catch.
 */
export function scoreThumbnailStoryInterest(args: {
  title: string;
  heroProp?: string;
  headlineWords: readonly string[];
  sceneSeed?: string;
  /** Declared by the channel identity. Defaults to the human-agency reading. */
  subjectClass?: SubjectClass;
}): StoryInterestVerdict {
  const headline = tokens(args.headlineWords.join(" "));
  const hero = tokens(args.heroProp ?? "");
  const scene = tokens(`${args.sceneSeed ?? ""} ${args.heroProp ?? ""} ${args.title}`);
  const subjectClass = args.subjectClass ?? "event";

  const reasons: string[] = [];
  const liftPrompts: string[] = [];
  let score = 50;

  // ICON AND PERSON SUBJECTS: the draw is the subject itself. Scoring these on
  // human agency demotes the very thing the viewer clicked for.
  if (subjectClass === "icon") {
    const heroIsIcon = hasAny(hero, ICON_SUBJECTS);
    const heroIsDominant = hasAny(hero, DOMINANCE_MARKERS);
    const personTookTheSlot = hasAny(hero, PERSON_HERO) && !heroIsIcon;
    if (heroIsIcon) {
      score += 20;
      reasons.push("the icon itself owns the hero slot");
    } else {
      score -= 30;
      reasons.push("the icon this video is about is not the hero");
      liftPrompts.push(
        "The subject of this video is the icon itself. Put it in the hero slot, centred and dominant, filling most " +
        "of the frame at full height. A person may appear for scale or consequence, but never in place of it.",
      );
    }
    if (heroIsDominant) {
      score += 10;
      reasons.push("the icon is staged at dominant scale");
    } else if (heroIsIcon) {
      liftPrompts.push("Stage the icon at genuinely dominant scale — filling the frame head-on, not sitting in the background.");
    }
    if (personTookTheSlot) {
      score -= 20;
      reasons.push("a supporting human has displaced the icon from the hero slot");
    }
    if (hasAny(headline, STAKE_WORDS)) {
      score += 15;
      reasons.push("the headline names a consequence, reversal or jeopardy");
    } else {
      score -= 10;
      reasons.push("the headline names no consequence — it describes rather than threatens");
    }
    if (hasAny(scene, AUDACITY_WORDS)) {
      score += 10;
      reasons.push("the concept carries an audacity or scale marker");
    }
    if (hasAny(scene, REVERSAL_WORDS)) {
      score += 15;
      reasons.push("the concept contains an irony or reversal");
    } else {
      liftPrompts.push(
        "Find the contradiction: the gap between what the icon is famous for and the unglamorous truth. Stage THAT " +
        "against the icon itself.",
      );
    }
    score = Math.max(0, Math.min(100, score));
    return {
      score,
      verdict: score >= 65 ? "compelling" : score >= 40 ? "weak" : "inert",
      reasons,
      liftPrompts,
    };
  }

  if (subjectClass === "person") {
    const heroIsPerson = hasAny(hero, PERSON_HERO) || hasAny(hero, HUMAN_AGENCY);
    if (heroIsPerson) {
      score += 25;
      reasons.push("the person this video is about owns the hero slot");
    } else {
      score -= 30;
      reasons.push("the person this video is about is not the hero — the draw is missing");
      liftPrompts.push(
        "This video is about a specific person. Their face is the draw and must be the hero: large, recognizable, " +
        "and holding the frame. Documents, locations and objects are supporting evidence around them, never the subject.",
      );
    }
    if (hasAny(hero, ["face", "eyes", "portrait", "expression", "stare", "mugshot"])) {
      score += 15;
      reasons.push("the face is explicitly staged, not merely implied");
    } else if (heroIsPerson) {
      liftPrompts.push("Bring the face itself forward — expression and eye line are what the viewer reads first at 120px.");
    }
    if (hasAny(headline, STAKE_WORDS)) {
      score += 15;
      reasons.push("the headline names a consequence, reversal or jeopardy");
    } else {
      score -= 10;
      reasons.push("the headline names no consequence — it describes rather than threatens");
    }
    if (hasAny(scene, REVERSAL_WORDS)) {
      score += 15;
      reasons.push("the concept contains an irony or reversal");
    }
    score = Math.max(0, Math.min(100, score));
    return {
      score,
      verdict: score >= 65 ? "compelling" : score >= 40 ? "weak" : "inert",
      reasons,
      liftPrompts,
    };
  }

  const heroHasHuman = hasAny(hero, HUMAN_AGENCY);
  const heroIsInert = hasAny(hero, INERT_SUBJECTS);
  const headlineHasStake = hasAny(headline, STAKE_WORDS);
  const headlineIsInert = hasAny(headline, INERT_SUBJECTS);
  const headlineHasNumber = headline.some((word) => /^\d/.test(word));
  const hasAudacity = hasAny(scene, AUDACITY_WORDS);
  const hasReversal = hasAny(scene, REVERSAL_WORDS);

  if (heroHasHuman) {
    score += 20;
    reasons.push("a human being is present and acting in the hero");
  } else {
    score -= 25;
    reasons.push("no human presence or agency in the hero");
    liftPrompts.push(
      "Put a person in the frame doing the decisive thing. A viewer reads human intent before they read an object; " +
      "an unattended object cannot carry jeopardy.",
    );
  }

  if (heroIsInert && !heroHasHuman) {
    score -= 25;
    reasons.push("the hero is an inert material or surface with nobody acting on it");
    liftPrompts.push(
      "Replace the raw material with the CONSEQUENCE it produced. The audience does not care about the barrier; " +
      "they care what it was protecting, who lost it, and who is about to find out.",
    );
  }

  if (headlineHasStake) {
    score += 15;
    reasons.push("the headline names a consequence, reversal or jeopardy");
  } else {
    score -= 10;
    reasons.push("the headline names no consequence — it describes rather than threatens");
  }

  // The signature failure: a quantity attached to an inert noun. "18 INCHES OF
  // CONCRETE" measures a barrier; it does not tell anyone what was at stake.
  if (headlineIsInert && headlineHasNumber && !headlineHasStake) {
    score -= 25;
    reasons.push("the headline is a measurement of an inert material, not a stake");
    liftPrompts.push(
      "Keep a specific number if it earns the click, but attach it to something a person can lose, risk or get away " +
      "with — a duration, a distance escaped, a sum taken, a count of people fooled — never to a building material.",
    );
  } else if (headlineIsInert && !headlineHasStake) {
    score -= 15;
    reasons.push("the headline's subject is an inert material");
    liftPrompts.push("Make the headline about the human outcome, not the substance involved.");
  }

  if (hasAudacity) {
    score += 10;
    reasons.push("the concept carries an audacity or scale marker");
  }

  if (hasReversal) {
    score += 15;
    reasons.push("the concept contains an irony or reversal");
  } else {
    liftPrompts.push(
      "Look for the reversal in this story — the thing that turned out to be the opposite of expected — and stage " +
      "THAT moment instead of the procedure.",
    );
  }

  score = Math.max(0, Math.min(100, score));
  const verdict = score >= 65 ? "compelling" : score >= 40 ? "weak" : "inert";
  return { score, verdict, reasons, liftPrompts };
}

/**
 * Standing doctrine for the art director. This runs BEFORE layout and scene
 * invention so a dull subject is never staged beautifully in the first place.
 */
export const STORY_INTEREST_DOCTRINE = [
  "STEP 0 — IS THIS STORY WORTH A THUMBNAIL? Before inventing any scene, decide what a viewer would actually care about in this video. Craft cannot rescue a boring subject.",
  "An inert material, a barrier, a tool, or a measurement is NEVER the story. Concrete, steel, walls, locks, cables and doors are obstacles in the story, not the subject of it.",
  "PICK THE MOST CONSEQUENTIAL ANGLE, not the most quotable trivia. When a video criticises something, rank the available criticisms by what actually harms people or breaks the promise — deaths, injuries, structural failure, money lost, people displaced, a lie exposed — and stage THAT. An odd operational quirk (how the bins are emptied, where the waste goes, how slow the lifts are) is a footnote, not a thumbnail: it makes the video look small and the critic look petty. If the only angle you can find is a curiosity, you have not looked hard enough at the subject.",
  "WHO OWNS THE HERO SLOT depends on what the video is about. If it is about a famous structure, object or place, THAT icon is the draw — stage it centred and dominant, filling the frame at full height, and let any human appear only as scale or consequence beside it. If it is about a specific named person, their face is the draw and must hold the frame. Otherwise the hero is a person at the moment of consequence. Never demote the thing the viewer clicked for into the background.",
  "Prefer, in order: a human being at the moment of consequence > an irony or reversal (the thing that turned out to be the opposite of expected) > an act of audacity at scale > a tactile object that a person is visibly acting on. Never a substance on its own.",
  "If a number is used, it must measure something a person can lose, risk, escape with, or get away with — a sum, a duration, a distance, a count of people fooled. A number attached to a building material measures a barrier and communicates nothing.",
  "Test: state the concept aloud in one sentence. If it describes a procedure ('drilling through a wall') rather than a stake ('they rented the shop next door for six months to reach it'), the concept is not finished.",
] as const;
