import { z } from "zod";

/**
 * A bounded, render-only correction for an evidence-backed failed hand trace.
 * It never changes the sealed storyboard, art prompts, source bytes, or TTS
 * text; it only instructs the deterministic scribe to make the affected draw
 * interval more visible while reusing those cached artifacts.
 */
export const WHITEBOARD_TIMING_REPAIR_VERSION = "whiteboard-timing-repair/v1" as const;

export interface WhiteboardTimingRepair {
  version: typeof WHITEBOARD_TIMING_REPAIR_VERSION;
  mode: "strengthen_draw_trace";
  targetStartMs: number;
  targetEndMs: number;
  drawMultiplier: number;
  handLingerMultiplier: number;
  panelHoldMultiplier: number;
}

export const WhiteboardTimingRepairSchema = z.object({
  version: z.literal(WHITEBOARD_TIMING_REPAIR_VERSION),
  mode: z.literal("strengthen_draw_trace"),
  targetStartMs: z.number().finite().min(0).max(7_200_000),
  targetEndMs: z.number().finite().positive().max(7_200_000),
  drawMultiplier: z.number().finite().min(1.1).max(1.5),
  handLingerMultiplier: z.number().finite().min(1.1).max(1.5),
  panelHoldMultiplier: z.number().finite().min(1.1).max(1.5),
}).superRefine((repair, context) => {
  if (repair.targetEndMs <= repair.targetStartMs) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "targetEndMs must follow targetStartMs" });
  }
});

export const WHITEBOARD_RENDER_SCHEDULE_VERSION = "whiteboard-render-schedule/v1" as const;

export const WhiteboardRenderScheduleSchema = z.object({
  version: z.literal(WHITEBOARD_RENDER_SCHEDULE_VERSION),
  narrationStartSec: z.number().finite().nonnegative(),
  storyReceiptFingerprint: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  timingRepair: WhiteboardTimingRepairSchema.optional(),
  panels: z.array(z.object({
    idx: z.number().int().min(0).max(15),
    startMs: z.number().finite().nonnegative(),
    endMs: z.number().finite().positive(),
    completionSampleMs: z.number().finite().nonnegative(),
    layers: z.array(z.object({
      layerIdx: z.number().int().min(0).max(23),
      kind: z.enum(["art", "label"]),
      cueStartMs: z.number().finite().nonnegative(),
      drawStartMs: z.number().finite().nonnegative(),
      drawEndMs: z.number().finite().positive(),
      handLingerEndMs: z.number().finite().positive(),
      handSampleMs: z.number().finite().nonnegative(),
    })).min(1).max(24),
  })).min(1).max(16),
});

export type WhiteboardRenderSchedule = z.infer<typeof WhiteboardRenderScheduleSchema>;
