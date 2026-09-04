/**
 * CHARACTER SHEET — many views of one character, as a single conditioning image.
 *
 * The problem this solves is narrow and concrete. Character consistency across
 * shots needs the renderer to SEE the character, not just read a description of
 * them. The studio already produces per-character reference assets through
 * Visual Matter — but it only ever uses them to GRADE finished frames, and the
 * one route that accepts image conditioning at all is FLUX Kontext, which takes
 * exactly one `image_url`. So a three-view character reference degrades to
 * whichever view happened to be first, and the other two are discarded.
 *
 * Rather than wait for a provider that accepts N references, this does what a
 * physical animation department does: put the views on ONE SHEET. A single
 * image carrying front, three-quarter and profile is still a single image_url,
 * so it passes through the existing single-reference route intact and the model
 * sees the whole character. That is the entire idea, and it is why this is a
 * compositor rather than a provider integration.
 *
 * DETERMINISM. The sheet is built from a digest of its inputs, so the same
 * character always yields byte-identical bytes. A sheet that varied per call
 * would make every downstream render cache miss, and would quietly change the
 * character between episodes — the exact drift the reference exists to prevent.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO. It does not invent views. If a character
 * has one reference, the sheet is that one reference at full size: padding a
 * lone front view into a three-panel grid with duplicates would tell the model
 * the character looks the same from every angle, which is worse than saying
 * nothing. Range comes from real references or not at all.
 */
import { createHash } from "node:crypto";
import { join } from "node:path";

/** Panel geometry. Square panels keep every view at the same scale, so the
 * model reads them as one character rather than as different subjects. */
export const CHARACTER_SHEET_PANEL = 512;
export const CHARACTER_SHEET_MAX_VIEWS = 4;
/**
 * A scene contact sheet: nine beats of one scene in a single 3x3 image.
 *
 * Nine separately rendered stills cost nine renders and agree only by luck. Nine
 * panels drawn in one pass cost one render and are internally consistent by
 * construction, which is the same reasoning that made the character sheet a
 * turnaround rather than three portraits.
 */
export const CONTACT_SHEET_COLUMNS = 3;
export const CONTACT_SHEET_MAX_PANELS = 9;

export interface CharacterView {
  /** Stable id of the source reference asset. */
  id: string;
  /** Local path to the decoded reference image. */
  path: string;
  /** front | three_quarter | profile | back — used for ordering and labels. */
  angle?: string;
}

export interface CharacterSheetPlan {
  /** Views in canonical order, capped. */
  views: CharacterView[];
  columns: number;
  width: number;
  height: number;
  /** Stable identity of this sheet; also the cache key. */
  digest: string;
  /** True when there is only one view and no sheet is warranted. */
  passthrough: boolean;
}

/**
 * Canonical view order.
 *
 * Fixed rather than incidental: a sheet whose panels reorder between builds is
 * a different image, so it would break caching and could shift how the model
 * weights the views. Unknown angles sort last but keep their relative order.
 */
const ANGLE_ORDER = ["front", "three_quarter", "profile", "back"];

function angleRank(angle: string | undefined): number {
  const index = ANGLE_ORDER.indexOf((angle ?? "").toLowerCase());
  return index < 0 ? ANGLE_ORDER.length : index;
}

export function planContactSheet(
  views: readonly CharacterView[],
  columns = CONTACT_SHEET_COLUMNS,
  maxPanels = CONTACT_SHEET_MAX_PANELS,
): CharacterSheetPlan {
  const ordered = views.slice(0, maxPanels);
  const digest = createHash("sha256")
    .update(ordered.map((v) => `${v.id}\0${v.angle ?? ""}`).join("\n"))
    .digest("hex")
    .slice(0, 32);
  const rows = Math.max(1, Math.ceil(ordered.length / columns));
  return {
    views: [...ordered],
    columns,
    width: Math.min(columns, ordered.length || 1) * CHARACTER_SHEET_PANEL,
    height: rows * CHARACTER_SHEET_PANEL,
    digest,
    // A single panel is not a contact sheet; hand back the image itself.
    passthrough: ordered.length <= 1,
  };
}

export function planCharacterSheet(views: readonly CharacterView[]): CharacterSheetPlan {
  const ordered = [...views]
    .map((view, index) => ({ view, index }))
    .sort((a, b) => angleRank(a.view.angle) - angleRank(b.view.angle) || a.index - b.index)
    .map((entry) => entry.view)
    .slice(0, CHARACTER_SHEET_MAX_VIEWS);

  const digest = createHash("sha256")
    .update(ordered.map((v) => `${v.id}\0${v.angle ?? ""}`).join("\n"))
    .digest("hex")
    .slice(0, 32);

  // Two views side by side; three or four in a 2x2 grid. A 1x4 strip would make
  // each panel tiny once the provider resizes the sheet to its own working
  // resolution, which defeats the point of showing detail.
  const columns = ordered.length <= 1 ? 1 : ordered.length === 2 ? 2 : 2;
  const rows = Math.ceil(ordered.length / columns);
  return {
    views: ordered,
    columns,
    width: columns * CHARACTER_SHEET_PANEL,
    height: rows * CHARACTER_SHEET_PANEL,
    digest,
    passthrough: ordered.length <= 1,
  };
}

/**
 * The ffmpeg filter that lays the views out.
 *
 * Each panel is scaled to fit and padded rather than cropped: cropping a
 * character reference can remove the silhouette cue — a hat, a shoulder line —
 * that the sheet exists to preserve.
 */
export function characterSheetFilter(plan: CharacterSheetPlan): string {
  const p = CHARACTER_SHEET_PANEL;
  const scaled = plan.views
    .map((_, i) =>
      `[${i}:v]scale=${p}:${p}:force_original_aspect_ratio=decrease,` +
      `pad=${p}:${p}:(ow-iw)/2:(oh-ih)/2:color=white,setsar=1[v${i}]`,
    )
    .join(";");
  const inputs = plan.views.map((_, i) => `[v${i}]`).join("");
  const rows = Math.ceil(plan.views.length / plan.columns);
  return `${scaled};${inputs}xstack=inputs=${plan.views.length}:layout=${xstackLayout(plan.views.length, plan.columns, rows)}[sheet]`;
}

/** xstack layout string, e.g. "0_0|w0_0|0_h0|w0_h0" for a 2x2. */
export function xstackLayout(count: number, columns: number, rows: number): string {
  const cells: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const col = index % columns;
    const row = Math.floor(index / columns);
    // xstack addresses offsets by the dimensions of earlier inputs, not pixels.
    const x = col === 0 ? "0" : Array.from({ length: col }, (_, i) => `w${i}`).join("+");
    const y = row === 0 ? "0" : Array.from({ length: row }, (_, i) => `h${i * columns}`).join("+");
    cells.push(`${x}_${y}`);
  }
  void rows;
  return cells.join("|");
}

/**
 * Build the sheet. Returns the path of the image to use as the single
 * conditioning reference — which for a lone view is that view itself, unchanged.
 */
export async function buildCharacterSheet(args: {
  views: readonly CharacterView[];
  outDir: string;
  run: (bin: string, argv: string[], timeoutMs: number) => Promise<unknown>;
  ffmpegBin?: string;
  timeoutMs?: number;
  /** Supply a plan to use a different layout, e.g. a 3x3 scene contact sheet. */
  plan?: CharacterSheetPlan;
}): Promise<{ path: string; plan: CharacterSheetPlan }> {
  const plan = args.plan ?? planCharacterSheet(args.views);
  if (!plan.views.length) throw new Error("character sheet requires at least one reference view");
  if (plan.passthrough) return { path: plan.views[0].path, plan };

  const outPath = join(args.outDir, `character_sheet_${plan.digest}.png`);
  const argv = [
    "-y",
    ...plan.views.flatMap((view) => ["-i", view.path]),
    "-filter_complex", characterSheetFilter(plan),
    "-map", "[sheet]", "-frames:v", "1", outPath,
  ];
  await args.run(args.ffmpegBin ?? "ffmpeg", argv, args.timeoutMs ?? 60_000);
  return { path: outPath, plan };
}
