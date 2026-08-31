import { createHash } from "node:crypto";
import { z } from "zod";

import { TimedOnScreenTextCueSchema } from "@/lib/onScreenTextProof";

export type FootageOnScreenTextCue = z.infer<typeof TimedOnScreenTextCueSchema>;

export interface FootageTextPresentation {
  sceneId: string;
  durationSec: number;
  nameCardText?: string;
  evidenceOverlay?: {
    text: string;
    durationSec: number;
  };
}

function stableCueId(sceneId: string, kind: string, sampleIndex: number): string {
  const suffix = createHash("sha256")
    .update(`${sceneId}\u0000${kind}\u0000${sampleIndex}`)
    .digest("hex")
    .slice(0, 16);
  return `footage-${kind}-${suffix}`;
}

function requireVisibleText(value: string, label: string): string {
  const text = value.trim().replace(/\s+/g, " ");
  if (text.length < 3) {
    throw new Error(`${label} must contain at least three visible characters for final-master OCR verification`);
  }
  return text;
}

function sampleOffsets(durationSec: number, edgeInsetSec: number): number[] {
  if (!Number.isFinite(durationSec) || durationSec < 1.1) {
    throw new Error("on-screen text presentation duration is too short for entry/middle/exit verification");
  }
  const inset = Math.max(0.18, Math.min(edgeInsetSec, durationSec * 0.28));
  return [inset, durationSec / 2, Math.max(inset, durationSec - inset)];
}

/**
 * Create body-relative OCR obligations only after a deterministic text overlay
 * actually rendered.  Three samples prevent a card that exists at one lucky
 * moment from passing while it fades, pans, or crops away during the shot.
 */
export function footageOnScreenTextCues(
  presentations: readonly FootageTextPresentation[],
): FootageOnScreenTextCue[] {
  let sceneStartSec = 0;
  const cues: FootageOnScreenTextCue[] = [];
  for (const presentation of presentations) {
    const durationSec = Number(presentation.durationSec);
    if (!Number.isFinite(durationSec) || durationSec <= 0) {
      throw new Error(`scene ${presentation.sceneId} has an invalid duration for on-screen text verification`);
    }
    const add = (kind: "name-card" | "evidence", text: string, windowDurationSec: number, edgeInsetSec: number) => {
      const expectedText = requireVisibleText(text, `${kind} on scene ${presentation.sceneId}`);
      for (const [sampleIndex, offset] of sampleOffsets(windowDurationSec, edgeInsetSec).entries()) {
        cues.push({
          id: stableCueId(presentation.sceneId, kind, sampleIndex),
          sampleSec: Number((sceneStartSec + offset).toFixed(3)),
          expectedText,
          minTokenCoverage: 0.85,
        });
      }
    };
    if (presentation.nameCardText) {
      // The FFmpeg name-card compositor fades over 0.5s/0.6s at the clip
      // edges, so sample after the fade rather than treating an intentional
      // fade frame as failed typography.
      add("name-card", presentation.nameCardText, durationSec, 0.72);
    }
    if (presentation.evidenceOverlay) {
      add(
        "evidence",
        presentation.evidenceOverlay.text,
        presentation.evidenceOverlay.durationSec,
        0.24,
      );
    }
    sceneStartSec += durationSec;
  }
  return cues;
}

/** Convert body-relative LTX overlay proof into final-master timestamps. */
export function shiftFootageOnScreenTextCues(
  value: unknown,
  offsetSec: number,
): FootageOnScreenTextCue[] {
  const parsed = z.array(TimedOnScreenTextCueSchema).safeParse(value);
  if (!parsed.success) {
    throw new Error(
      `footage on-screen text cues are malformed: ${parsed.error.issues.map((issue) => issue.message).join("; ")}`,
    );
  }
  if (!Number.isFinite(offsetSec) || offsetSec < 0) {
    throw new Error("final-master text-cue offset is invalid");
  }
  return parsed.data.map((cue) => ({
    ...cue,
    sampleSec: Number((cue.sampleSec + offsetSec).toFixed(3)),
  }));
}
