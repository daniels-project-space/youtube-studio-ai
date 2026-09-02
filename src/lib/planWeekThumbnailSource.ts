/**
 * A weekly plan either has a concrete pre-rendered packaging image or waits
 * for the finished video to supply its truthful frame.  Keeping this as a
 * first-class immutable plan choice prevents an advance planner from spending
 * on a generic stand-in for media that does not exist yet.
 */
export const PLAN_WEEK_THUMBNAIL_SOURCES = [
  "planner_artwork",
  "rendered_video_frame",
] as const;

export type PlanWeekThumbnailSource = typeof PLAN_WEEK_THUMBNAIL_SOURCES[number];

function text(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function planWeekThumbnailSourceForChannel(input: {
  family?: unknown;
  contentLane?: unknown;
}): PlanWeekThumbnailSource {
  const family = text(input.family);
  const lane = input.contentLane && typeof input.contentLane === "object" && !Array.isArray(input.contentLane)
    ? text((input.contentLane as Record<string, unknown>).key) || text((input.contentLane as Record<string, unknown>).family)
    : "";
  return family === "music_loop" || /(?:^|[_-])lofi(?:[_-]|$)|music_loop/.test(lane)
    ? "rendered_video_frame"
    : "planner_artwork";
}

export function assertPlanWeekThumbnailSource(value: unknown): PlanWeekThumbnailSource {
  if (value === "planner_artwork" || value === "rendered_video_frame") return value;
  throw new Error("plan-week thumbnail source is invalid");
}

export function isDeferredRenderedFrameSource(value: unknown): boolean {
  return value === "rendered_video_frame";
}
