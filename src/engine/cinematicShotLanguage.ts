/**
 * A deterministic visual-language layer for every Story Spine consumer.
 *
 * The old planner alternated camera moves and scales by shot number. That
 * creates motion on paper but not a reason to cut. This module instead ties a
 * shot to the narrated beat: establish a world, investigate evidence, tighten
 * on a contradiction, accelerate a threat, or let a consequence breathe.
 * It is deliberately provider-free: generation models receive the direction,
 * while the planner remains reproducible and inspectable.
 */

export type CinematicCameraMove =
  | "dolly_push"
  | "truck_left"
  | "static"
  | "dolly_pull"
  | "handheld_drift";

export type CinematicShotScale =
  | "establishing"
  | "wide"
  | "medium"
  | "close"
  | "extreme_close";

export type CinematicNarrativeIntent =
  | "establish"
  | "investigate"
  | "reveal"
  | "escalate"
  | "consequence"
  | "human"
  | "advance";

export interface CinematicShotLanguage {
  intent: CinematicNarrativeIntent;
  coveragePurpose: string;
  cutRationale: string;
  cameraMove: CinematicCameraMove;
  shotScale: CinematicShotScale;
  lens: string;
  motionDirection: string;
}

export interface PlanCinematicShotLanguageInput {
  literalContent: string;
  beatPurpose: string;
  shotIndex: number;
  chunkIndex: number;
  chunksInBeat: number;
  previous?: Pick<CinematicShotLanguage, "cameraMove" | "shotScale">;
}

type Grammar = Omit<CinematicShotLanguage, "cameraMove" | "shotScale" | "lens"> & {
  cameraMoves: readonly CinematicCameraMove[];
  shotScales: readonly CinematicShotScale[];
};

const GRAMMAR: Record<CinematicNarrativeIntent, Grammar> = {
  establish: {
    intent: "establish",
    coveragePurpose: "place the viewer in the specific time, geography, and stakes before the action tightens",
    cutRationale: "open on spatial context so the next cut can reveal what matters inside it",
    motionDirection: "Let the environment resolve first; keep movement patient and observational.",
    cameraMoves: ["static", "dolly_push", "truck_left"],
    shotScales: ["establishing", "wide", "medium"],
  },
  investigate: {
    intent: "investigate",
    coveragePurpose: "make the evidence, document, trace, or physical detail readable before the narration draws a conclusion",
    cutRationale: "cut from the wider situation to the evidence that changes the audience’s understanding",
    motionDirection: "Move with controlled forensic attention; let a prop, document, trace, or spatial clue become legible.",
    cameraMoves: ["truck_left", "static", "dolly_push"],
    shotScales: ["close", "extreme_close", "medium"],
  },
  reveal: {
    intent: "reveal",
    coveragePurpose: "land the contradiction or newly understood fact with an unmistakable visual turn",
    cutRationale: "tighten exactly where the narration overturns the previous assumption",
    motionDirection: "Begin restrained, then visibly resolve into the new fact; do not merely drift decoratively.",
    cameraMoves: ["dolly_push", "static", "handheld_drift"],
    shotScales: ["medium", "close", "extreme_close"],
  },
  escalate: {
    intent: "escalate",
    coveragePurpose: "increase urgency through motivated action, unstable space, or narrowing options without inventing facts",
    cutRationale: "change shot language as the stakes rise, rather than holding the same visual through the threat",
    motionDirection: "Carry the action forward with contained urgency; movement must show pressure, pursuit, or loss of control.",
    cameraMoves: ["handheld_drift", "dolly_push", "truck_left"],
    shotScales: ["medium", "wide", "close"],
  },
  consequence: {
    intent: "consequence",
    coveragePurpose: "give the outcome emotional and spatial weight after the preceding action or discovery",
    cutRationale: "release from the previous pressure into the image that makes the consequence understandable",
    motionDirection: "Let the image breathe and show the changed state; avoid a second unmotivated surge of motion.",
    cameraMoves: ["dolly_pull", "static", "truck_left"],
    shotScales: ["wide", "medium", "close"],
  },
  human: {
    intent: "human",
    coveragePurpose: "show the human relationship, decision, or reaction that makes the causal beat matter",
    cutRationale: "move from abstract information to the person-level consequence or decision",
    motionDirection: "Prioritise readable posture, role, wardrobe silhouette, and relationship over spectacle.",
    cameraMoves: ["truck_left", "dolly_push", "static"],
    shotScales: ["medium", "close", "wide"],
  },
  advance: {
    intent: "advance",
    coveragePurpose: "advance the narrated cause-and-effect with a concrete changing visual state",
    cutRationale: "cut because the narration advances to a different causal state, not because a timer expired",
    motionDirection: "Show one clear action developing from the first frame to the last frame.",
    cameraMoves: ["dolly_push", "truck_left", "dolly_pull", "static"],
    shotScales: ["medium", "wide", "close", "establishing"],
  },
};

function stableIndex(text: string, length: number): number {
  let value = 2166136261;
  for (let index = 0; index < text.length; index++) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 16777619);
  }
  return Math.abs(value >>> 0) % length;
}

function selectDistinct<T>(
  candidates: readonly T[],
  previous: T | undefined,
  seed: string,
): T {
  const distinct = previous === undefined
    ? candidates
    : candidates.filter((candidate) => candidate !== previous);
  const pool = distinct.length ? distinct : candidates;
  return pool[stableIndex(seed, pool.length)]!;
}

export function classifyCinematicNarrativeIntent(
  literalContent: string,
  beatPurpose: string,
  isOpening: boolean,
): CinematicNarrativeIntent {
  const text = `${literalContent} ${beatPurpose}`.toLowerCase();
  if (isOpening) {
    return "establish";
  }
  if (/\b(but|however|instead|actually|truth|revealed|reveal|discovered|discovery|found out|turns out|contradiction|not what)\b/.test(text)) {
    return "reveal";
  }
  if (/\b(evidence|document|record|records|file|files|footage|phone|call log|report|forensic|trace|clue|camera)\b/.test(text)) {
    return "investigate";
  }
  if (/\b(threat|danger|risk|raced|escape|escaped|pursuit|attack|arrest|missing|vanished|pressure|deadline|before it was too late)\b/.test(text)) {
    return "escalate";
  }
  if (/\b(afterward|aftermath|result|consequence|convicted|sentenced|charged|finally|changed everything|left behind|ended)\b/.test(text)) {
    return "consequence";
  }
  if (/\b(she|he|they|family|friend|witness|detective|officer|mother|father|decision|refused|chose|realised|realized|reaction)\b/.test(text)) {
    return "human";
  }
  if (/\b(in the|at the|on the|during|before dawn|that night|years? earlier|inside|outside|across|beneath|between)\b/.test(text)) {
    return "establish";
  }
  return "advance";
}

function lensFor(scale: CinematicShotScale): string {
  if (scale === "extreme_close") return "100mm macro detail";
  if (scale === "close") return "85mm intimate portrait";
  if (scale === "medium") return "50mm natural perspective";
  if (scale === "wide") return "35mm environmental perspective";
  return "24mm spatial establishing lens";
}

export function planCinematicShotLanguage(input: PlanCinematicShotLanguageInput): CinematicShotLanguage {
  const isOpening = input.shotIndex === 1 || input.chunkIndex === 0 && input.shotIndex <= 2;
  const intent = classifyCinematicNarrativeIntent(input.literalContent, input.beatPurpose, isOpening);
  const grammar = GRAMMAR[intent];
  const seed = `${input.literalContent}\n${input.beatPurpose}\n${input.chunkIndex}/${input.chunksInBeat}`;
  const cameraMove = selectDistinct(grammar.cameraMoves, input.previous?.cameraMove, `${seed}\ncamera`);
  const shotScale = selectDistinct(grammar.shotScales, input.previous?.shotScale, `${seed}\nscale`);
  return {
    intent,
    coveragePurpose: grammar.coveragePurpose,
    cutRationale: grammar.cutRationale,
    motionDirection: grammar.motionDirection,
    cameraMove,
    shotScale,
    lens: lensFor(shotScale),
  };
}
