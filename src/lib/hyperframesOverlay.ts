/**
 * HYPERFRAMES EVIDENCE OVERLAYS — reusable flat 2D compositing primitives for
 * true-crime/Casefile videos: a case-file stamp, an evidence tag, and a
 * tracking/surveillance HUD.
 *
 * Built on the SAME HyperFrames composition-file pattern src/lib/geoCinema.ts
 * established for the globe-to-city cinematic intro: a `#root` div carrying
 * `data-composition-id` / `data-start` / `data-duration` / `data-width` /
 * `data-height`, timed elements carrying `data-start` / `data-duration` /
 * `data-track-index`, a GSAP timeline registered on `window.__timelines[id]`,
 * written out as `index.html` + `hyperframes.json` and rendered headlessly
 * with `npx hyperframes@VERSION render`. Do not invent a different
 * integration mechanism — this mirrors geoCinema.ts's `buildGeoComposition`
 * / `renderGeoIntro` deliberately.
 *
 * UNLIKE geoCinema.ts, these overlays are plain HTML/CSS — no three.js
 * scene, no vendored assets (only the same GSAP CDN script tag), no LLM
 * art-direction step, no vision-verify render loop. They are short
 * (1.5-3s) graphic accents meant to sit OVER an existing rendered shot, not
 * a standalone establishing shot, so the composition is small enough to
 * build as a pure in-memory template rather than a separate `.tpl.html`
 * asset file.
 *
 * STATUS — standalone primitive, no live call site yet. A sibling
 * investigation into character-introduction name-card overlays for this
 * same Casefile pipeline found that the Casefile route
 * (cinematicCaseSequence.ts -> genFootageBlocks.ts ->
 * cinematicSequenceRenderBinding.ts -> cinematicHandoff.ts) has no actual
 * clip-order assembler yet: `src/lib/assembly/index.ts` only re-exports
 * schema/functions from `cinematicHandoff.ts`, and nothing consumes a
 * `CinematicAssemblyHandoff` to mux/concat rendered clips into a final
 * video. There is therefore no live call site to wire a post-render overlay
 * pass into today. This module is built ready for that assembler — the same
 * judgment call the sibling task made building
 * `filmGrainVignetteFilter` / `applyFilmGrainVignette` in `src/lib/ffmpeg.ts`
 * ahead of a call site that does not exist yet.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { join } from "node:path";

type Logger = (msg: string) => void;
const HYPERFRAMES_VERSION = process.env.HYPERFRAMES_VERSION || "0.6.97";

/* ----------------------------------------------------------------------- *
 * 1. TEMPLATES — the overlay "worlds" this module can render.
 * ----------------------------------------------------------------------- */
export const OVERLAY_TEMPLATE_IDS = ["case_file_stamp", "evidence_tag", "tracking_hud"] as const;
export type OverlayTemplateId = (typeof OVERLAY_TEMPLATE_IDS)[number];

export interface OverlaySpec {
  templateId: OverlayTemplateId;
  /** Primary label — a case number, exhibit tag, or tracked-target line. */
  primary: string;
  /** Smaller secondary line — date, location, or status text. */
  secondary?: string;
  /** Accent hex color (stamp ink / tag color / HUD reticle+readout). */
  accent?: string;
  /** Seconds this overlay is on screen. */
  durationSec?: number;
}

const esc = (s: string) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function caseFileStampBody(spec: OverlaySpec, accent: string, dur: number): string {
  return (
    `<div class="ov clip" data-start="0" data-duration="${dur.toFixed(2)}" data-track-index="1">` +
    `<div class="stamp-box" style="border-color:${accent}; color:${accent}">` +
    `<div class="stamp-kick">CASE FILE</div>` +
    `<div class="stamp-primary">${esc(spec.primary)}</div>` +
    (spec.secondary ? `<div class="stamp-secondary">${esc(spec.secondary)}</div>` : "") +
    `</div></div>`
  );
}

function evidenceTagBody(spec: OverlaySpec, accent: string, dur: number): string {
  return (
    `<div class="ov clip" data-start="0" data-duration="${dur.toFixed(2)}" data-track-index="1">` +
    `<div class="tag-string" style="background:${accent}"></div>` +
    `<div class="tag-box" style="background:${accent}">` +
    `<div class="tag-kick">EVIDENCE</div>` +
    `<div class="tag-primary">${esc(spec.primary)}</div>` +
    (spec.secondary ? `<div class="tag-secondary">${esc(spec.secondary)}</div>` : "") +
    `</div></div>`
  );
}

function trackingHudBody(spec: OverlaySpec, accent: string, dur: number): string {
  return (
    `<div class="ov clip" data-start="0" data-duration="${dur.toFixed(2)}" data-track-index="1">` +
    `<div class="hud-reticle" style="border-color:${accent}"></div>` +
    `<div class="hud-readout" style="color:${accent}">` +
    `<div class="hud-kick">TRACKING</div>` +
    `<div class="hud-primary">${esc(spec.primary)}</div>` +
    (spec.secondary ? `<div class="hud-secondary mono">${esc(spec.secondary)}</div>` : "") +
    `</div></div>`
  );
}

const TEMPLATE_BODY: Record<OverlayTemplateId, (spec: OverlaySpec, accent: string, dur: number) => string> = {
  case_file_stamp: caseFileStampBody,
  evidence_tag: evidenceTagBody,
  tracking_hud: trackingHudBody,
};

/**
 * Stamp an OverlaySpec into a renderable HyperFrames index.html string — a
 * PURE FUNCTION (no file I/O), mirroring geoCinema.ts's
 * `buildGeoComposition`. The whole composition is small enough to inline
 * here rather than vendor a separate `.tpl.html` + assets dir.
 */
export function buildOverlayComposition(spec: OverlaySpec): string {
  const dur = spec.durationSec ?? 2.2;
  const accent = spec.accent || "#e8b23a";
  const body = TEMPLATE_BODY[spec.templateId](spec, accent, dur);
  const fadeOutAt = Math.max(0.05, dur - 0.3).toFixed(2);
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=1920, height=1080" />
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { width: 1920px; height: 1080px; overflow: hidden; background: transparent; font-family: "Inter", sans-serif; }
      .ov { position: absolute; inset: 0; pointer-events: none; }
      .mono { font-family: "JetBrains Mono", monospace; }
      .stamp-box { position: absolute; right: 110px; top: 110px; border: 6px solid; border-radius: 10px; padding: 22px 34px; transform: rotate(-6deg); opacity: 0; text-align: center; }
      .stamp-kick { font-size: 20px; letter-spacing: 0.4em; font-weight: 700; }
      .stamp-primary { font-size: 44px; font-weight: 800; letter-spacing: 0.05em; margin-top: 4px; }
      .stamp-secondary { font-size: 18px; letter-spacing: 0.2em; margin-top: 6px; opacity: 0.85; }
      .tag-box { position: absolute; left: 130px; bottom: 150px; color: #101010; border-radius: 6px; padding: 18px 26px; opacity: 0; }
      .tag-kick { font-size: 16px; letter-spacing: 0.35em; font-weight: 700; }
      .tag-primary { font-size: 34px; font-weight: 800; margin-top: 2px; }
      .tag-secondary { font-size: 15px; letter-spacing: 0.15em; margin-top: 4px; opacity: 0.75; }
      .tag-string { position: absolute; left: 190px; bottom: 210px; width: 3px; height: 60px; opacity: 0; }
      .hud-reticle { position: absolute; left: 50%; top: 50%; width: 220px; height: 220px; margin: -110px 0 0 -110px; border: 2px solid; border-radius: 4px; opacity: 0; }
      .hud-readout { position: absolute; left: 50%; top: 50%; margin-left: 130px; margin-top: -60px; opacity: 0; }
      .hud-kick { font-size: 16px; letter-spacing: 0.35em; font-weight: 700; }
      .hud-primary { font-size: 26px; font-weight: 700; margin-top: 4px; }
      .hud-secondary { font-size: 15px; letter-spacing: 0.1em; margin-top: 4px; }
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-duration="${dur.toFixed(2)}" data-width="1920" data-height="1080">
      ${body}
    </div>
    <script>
      window.__timelines = window.__timelines || {};
      const tl = gsap.timeline({ paused: true });
      const boxes = document.querySelectorAll(".stamp-box, .tag-box, .tag-string, .hud-reticle, .hud-readout");
      boxes.forEach((el) => {
        tl.fromTo(el, { opacity: 0, scale: 0.94 }, { opacity: 1, scale: 1, duration: 0.28, ease: "power2.out" }, 0.05)
          .to(el, { opacity: 0, duration: 0.22, ease: "power1.in" }, ${fadeOutAt});
      });
      window.__timelines["main"] = tl;
      tl.progress(0.5); // paint a mid-hold frame if the CLI probes the DOM before playing
    </script>
  </body>
</html>`;
}

/**
 * Write the project dir (index.html + hyperframes.json) and render via
 * HyperFrames. Mirrors geoCinema.ts's `renderGeoIntro`, minus the vendored
 * three.js/earth-texture asset copy step this overlay never needs.
 */
export async function renderOverlay(args: {
  spec: OverlaySpec;
  projectDir: string;
  fps?: number;
  quality?: "draft" | "standard" | "high";
  out?: string;
  log?: Logger;
}): Promise<string> {
  const html = buildOverlayComposition(args.spec);
  await mkdir(args.projectDir, { recursive: true });
  await writeFile(join(args.projectDir, "index.html"), html, "utf8");
  await writeFile(join(args.projectDir, "hyperframes.json"), JSON.stringify({ compositions: [{ id: "main" }] }), "utf8");

  // Phase 18: default output is WEBM, not MP4. This composition is a
  // graphic ACCENT meant to sit over an existing rendered shot (see this
  // file's top-of-file doc comment) — it must survive with a real alpha
  // channel, not the CSS `background: transparent` silently flattening to
  // opaque on encode. The HyperFrames CLI's own `--format` flag help text
  // confirms only `webm`/`mov` "render with transparency" (mp4 does not);
  // `--format webm` here pairs with `applyHyperframesOverlayClip`'s
  // `-c:v libvpx` alpha-honoring decode (src/lib/ffmpeg.ts), the same
  // WebM-alpha convention this codebase already uses for Remotion overlay
  // cards (see `codec: "vp8", pixelFormat: "yuva420p"` in
  // src/lib/remotionRender.ts and the `format=yuva420p` compositing chains
  // in applyQuoteOverlays/applyOverlaysAndCaptions, src/lib/ffmpeg.ts).
  const out = args.out || "overlay.webm";
  args.log?.(`hyperframesOverlay: rendering ${out} (${args.spec.templateId}, ${args.quality || "standard"} ${args.fps || 30}fps) via hyperframes@${HYPERFRAMES_VERSION}…`);
  await new Promise<void>((resolve, reject) => {
    const p = spawn(
      "npx",
      [
        `hyperframes@${HYPERFRAMES_VERSION}`,
        "render",
        "-q",
        args.quality || "standard",
        "-f",
        String(args.fps || 30),
        "--format",
        "webm",
        "--no-browser-gpu",
        "-o",
        out,
      ],
      {
        cwd: args.projectDir,
        stdio: ["ignore", "ignore", "pipe"],
      },
    );
    let e = "";
    p.stderr.on("data", (d) => (e += String(d)));
    p.on("close", (c) => (c === 0 ? resolve() : reject(new Error(`hyperframes render exited ${c}: ${e.slice(-400)}`))));
    p.on("error", reject);
  });
  return join(args.projectDir, out);
}

/* ----------------------------------------------------------------------- *
 * 2. BUDGET / SELECTION — sparse, well-placed use only. A pure, testable
 *    decision function, deliberately kept separate from the render call
 *    above (which shells out and cannot be easily unit tested).
 * ----------------------------------------------------------------------- */
export interface OverlayCandidateShot {
  id: string;
  narrativeRole: string;
  coveragePurpose: string;
  t0: number;
  t1: number;
}
export interface OverlaySelection {
  shotId: string;
  templateId: OverlayTemplateId;
  reason: string;
}

const ROLE_TEMPLATE: Partial<Record<string, OverlayTemplateId>> = {
  reveal: "case_file_stamp",
  contradiction: "evidence_tag",
};

/**
 * Decide which 0-2 shots (if any) in a sequence's coverage earn an evidence
 * overlay. Deliberately conservative, per the "sometimes only, placed well"
 * brief: only `reveal` / `contradiction` narrative-role beats are eligible,
 * and only their `evidence_insert` shots — the shots already doing cited
 * evidentiary work — qualify. An overlay dresses evidence that is already
 * there; it never invents a new evidentiary beat. Capped at `maxPerVideo`
 * (default 2) so the effect stays a rare accent, not a template flourish
 * repeated every beat.
 *
 * `tracking_hud` is intentionally NOT selected by this default mapping — the
 * brief names only reveal/contradiction as the gating roles. It remains
 * available in the template set (and in `src/engine/trueCrimeAssetBank.ts`)
 * for a future, separately-scoped gating rule (e.g. a surveillance-themed
 * `spatial_anchor` shot inside an `investigation` beat) rather than being
 * forced into this narrower decision function now.
 *
 * Pure and deterministic: same input, same output, no I/O, no rendering.
 */
export function selectEvidenceOverlayShots(
  shots: readonly OverlayCandidateShot[],
  opts: { maxPerVideo?: number } = {},
): OverlaySelection[] {
  const maxPerVideo = opts.maxPerVideo ?? 2;
  const eligible = shots.filter(
    (shot) =>
      (shot.narrativeRole === "reveal" || shot.narrativeRole === "contradiction") &&
      shot.coveragePurpose === "evidence_insert",
  );
  const ordered = [...eligible].sort((a, b) => a.t0 - b.t0 || a.id.localeCompare(b.id));
  return ordered.slice(0, Math.max(0, maxPerVideo)).map((shot) => {
    const templateId = ROLE_TEMPLATE[shot.narrativeRole] ?? "evidence_tag";
    return {
      shotId: shot.id,
      templateId,
      reason: `${shot.narrativeRole} beat's cited evidence_insert shot earns a ${templateId.replace(/_/g, " ")} accent`,
    };
  });
}

/* ----------------------------------------------------------------------- *
 * 3. AUTOMATIC-PATH ADAPTER (Phase 18) — Story Spine never carries the
 *    Casefile vocabulary `selectEvidenceOverlayShots` above filters on.
 * ----------------------------------------------------------------------- */
export interface AutomaticEvidenceOverlayShot {
  id: string;
  /**
   * Story Spine's `ShotPlanSchema.coveragePurpose`
   * (src/engine/storySpine.ts) — a FIXED sentence per narrative-intent
   * bucket from `cinematicShotLanguage.ts`'s GRAMMAR table (never per-shot
   * free text; see `planCinematicShotLanguage`), NOT the Casefile route's
   * `narrativeRole`/`evidence_insert` vocabulary `OverlayCandidateShot`
   * above expects. See `selectAutomaticEvidenceOverlayShots`'s doc comment
   * for the mapping this adapter derives from it.
   */
  coveragePurpose: string;
  t0: number;
  t1: number;
}

/**
 * AUTOMATIC-PATH (Story Spine) adapter for `selectEvidenceOverlayShots`.
 *
 * Investigated first: does Story Spine ever produce the Casefile route's
 * `narrativeRole: "reveal" | "contradiction"` + `coveragePurpose ===
 * "evidence_insert"` combination `selectEvidenceOverlayShots` filters on? No
 * — Story Spine's own `NarrativeRoleSchema` (storySpine.ts) is a single-value
 * `"introduction"` enum used only for character-intro name cards, unrelated
 * to per-shot evidence framing, and its `coveragePurpose` is never the
 * literal string `"evidence_insert"` — it is always one of seven fixed
 * sentences from `cinematicShotLanguage.ts`'s GRAMMAR table (see
 * `planCinematicShotLanguage`/`classifyCinematicNarrativeIntent`). Reusing
 * `narrativeRole` here would therefore be reusing the field name, not the
 * concept — it would always evaluate to `undefined`/`"introduction"` and the
 * Casefile filter would never once fire on automatic-path shots.
 *
 * What automatic-path shots DO genuinely carry is that fixed
 * `coveragePurpose` sentence, and two of the seven buckets are, in
 * substance, the same evidentiary beats the Casefile vocabulary names:
 *   - "investigate": "make the evidence, document, trace, or physical
 *     detail readable before the narration draws a conclusion" — literally
 *     contains "evidence".
 *   - "reveal": "land the contradiction or newly understood fact with an
 *     unmistakable visual turn" — literally contains "contradiction".
 * This adapter keys off exactly those two literal substrings
 * (case-insensitive) to reconstruct an equivalent `{ narrativeRole,
 * coveragePurpose: "evidence_insert" }` candidate for each match, then hands
 * off to `selectEvidenceOverlayShots` UNMODIFIED for the actual
 * budgeted/ordered selection and template assignment — one selection
 * algorithm, one Casefile-oriented test suite, shared by both routes.
 * "investigate" shots map to the "contradiction" role (→ `evidence_tag`: a
 * literal evidence tag fits a document/trace examination beat); "reveal"
 * shots map to the "reveal" role (→ `case_file_stamp`: the more dramatic
 * stamp fits a twist/contradiction landing). Every other bucket
 * (establish/escalate/consequence/human/advance) is never eligible, same
 * "sparing, well-placed only" brief as the function this wraps.
 *
 * Pure and deterministic: same input, same output, no I/O, no rendering —
 * same guarantee as `selectEvidenceOverlayShots`.
 */
export function selectAutomaticEvidenceOverlayShots(
  shots: readonly AutomaticEvidenceOverlayShot[],
  opts: { maxPerVideo?: number } = {},
): OverlaySelection[] {
  const adapted: OverlayCandidateShot[] = shots.map((shot) => {
    const text = shot.coveragePurpose.toLowerCase();
    const narrativeRole = text.includes("contradiction")
      ? "reveal"
      : text.includes("evidence")
        ? "contradiction"
        : "";
    return {
      id: shot.id,
      narrativeRole,
      coveragePurpose: narrativeRole ? "evidence_insert" : "",
      t0: shot.t0,
      t1: shot.t1,
    };
  });
  return selectEvidenceOverlayShots(adapted, opts);
}
