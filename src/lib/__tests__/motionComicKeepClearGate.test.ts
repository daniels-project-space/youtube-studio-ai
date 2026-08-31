import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

// P2-3 (GOLDEN_MODULE_AUDIT_2026-08.md): "comic numeric gate thresholds
// (... keep-clear overlap = 0-or-fail) not traced into the block files."
// The catalog's own claim (golden.ts:1027) is "keep-clear overlap = 0 or
// render fails". The existing motionComicArtContract.test.ts only exercises
// the HAPPY path of scripts/mc_textplace.py's place_safe()/_ov() (a bubble
// that DOES fit clear of faces). This file adds the missing FAIL half: when
// no legal placement exists, place_safe must report ok=False, and
// mc_page_render.py must turn that into a hard render failure (never a
// silent overlap). Uses the same spawnSync python3 probe technique already
// established in this repo for testing the deterministic Python layout code.

const layoutProbe = spawnSync(
  "python3",
  [
    "-c",
    [
      "import sys",
      "sys.path.insert(0, 'scripts')",
      "import numpy as np",
      "from mc_textplace import place_safe, _ov",
      "H, W = 400, 600",
      "det = np.zeros((H, W), dtype=float)",
      "",
      "# A single 'face' keep-clear box covering the ENTIRE frame: no bubble of",
      "# any size can be placed anywhere without overlapping it. This is the",
      "# exact condition the catalog's '0-or-fail' claim describes.",
      "keep_clear_all = [(0, 0, W, H)]",
      "x, y, fs, bw, bh, ok = place_safe(det, keep_clear_all, 'A short line', mouth=(300, 200), anchor=(300, 100))",
      "assert ok is False, f'expected ok=False when no face-clear placement exists anywhere, got ok={ok}'",
      "assert _ov((x, y, bw, bh), keep_clear_all[0]) > 0, 'the flagged least-bad placement should still overlap when none is legal'",
      "",
      "# Sanity control: the SAME call with a small, isolated keep-clear box in a",
      "# corner leaves plenty of room elsewhere, so placement must succeed with",
      "# EXACTLY zero overlap — proving the gate really is 0-or-fail, not a lax",
      "# 'mostly clear' heuristic.",
      "keep_clear_small = [(0, 0, 40, 40)]",
      "x2, y2, fs2, bw2, bh2, ok2 = place_safe(det, keep_clear_small, 'A short line', mouth=(300, 200), anchor=(300, 100))",
      "assert ok2 is True, f'expected ok=True with an easily avoidable keep-clear zone, got ok={ok2}'",
      "assert _ov((x2, y2, bw2, bh2), keep_clear_small[0]) == 0, 'a successful placement must have exactly zero overlap with the keep-clear zone'",
      "",
      "# Two disjoint faces that together still leave a usable gap must also",
      "# succeed with zero overlap against BOTH.",
      "keep_clear_two = [(0, 0, 200, 400), (400, 0, 200, 400)]",
      "x3, y3, fs3, bw3, bh3, ok3 = place_safe(det, keep_clear_two, 'A short line', mouth=(300, 200), anchor=(300, 100))",
      "assert ok3 is True, f'expected ok=True with a usable gap between two faces, got ok={ok3}'",
      "assert _ov((x3, y3, bw3, bh3), keep_clear_two[0]) == 0",
      "assert _ov((x3, y3, bw3, bh3), keep_clear_two[1]) == 0",
      "print('PYTHON_PROBE_OK')",
    ].join("\n"),
  ],
  { cwd: process.cwd(), encoding: "utf8" },
);
assert.equal(layoutProbe.status, 0, `mc_textplace.py keep-clear probe failed:\n${layoutProbe.stderr}`);
assert.match(layoutProbe.stdout, /PYTHON_PROBE_OK/, `unexpected probe output:\n${layoutProbe.stdout}${layoutProbe.stderr}`);

console.log("motionComicKeepClearGate.test.ts: place_safe()/_ov() 0-or-fail behavior verified against the real Python source");

/* ---------------- render-level wiring: ok=False must hard-fail ------------ */
//
// place_safe()'s `ok` (bound to `clear_fit` at the call site) must actually
// stop the render — never just get logged and ignored. Source-pinned against
// scripts/mc_page_render.py because exercising the real call site needs a
// full panel-art render pipeline (numpy image buffers, fonts, etc.) that is
// out of scope for a unit test; the pin still catches the wiring being
// silently dropped or downgraded to a warning.

const renderSource = readFileSync(join(process.cwd(), "scripts/mc_page_render.py"), "utf8");
const callSiteIdx = renderSource.indexOf(
  "lx, ly, fs, bw, bh, clear_fit = place_safe(",
);
assert.notEqual(
  callSiteIdx, -1,
  "mc_page_render.py: the place_safe() call site must remain present verbatim — the keep-clear gate may have moved",
);
const guardIdx = renderSource.indexOf("if not clear_fit:", callSiteIdx);
assert.notEqual(
  guardIdx, -1,
  "mc_page_render.py: place_safe()'s ok/clear_fit result must still be checked immediately after the call",
);
const raiseIdx = renderSource.indexOf("raise RuntimeError(", guardIdx);
assert.ok(
  raiseIdx !== -1 && raiseIdx - guardIdx < 200,
  "mc_page_render.py: an unclear placement (ok=False) must raise, not just log — '0 or render fails' per the catalog claim",
);
assert.ok(
  renderSource.slice(raiseIdx, raiseIdx + 400).includes("refusing overlap"),
  "mc_page_render.py: the hard-failure message must still identify the refused overlap",
);

console.log("motionComicKeepClearGate.test.ts: mc_page_render.py wires place_safe's ok=False to a hard RuntimeError (catalog's '0 or render fails' claim confirmed)");

/* ---------------- opening hook: never begin on an empty page grid -------- */

const openingSeedIdx = renderSource.indexOf('opening_pane = PAGES[0]["panes"][0]');
assert.notEqual(
  openingSeedIdx,
  -1,
  "mc_page_render.py must resolve the approved first panel before the preroll — the comic cannot open on an empty template grid",
);
const openingMissingGuard = renderSource.indexOf("refusing empty template opening", openingSeedIdx);
assert.ok(
  openingMissingGuard > openingSeedIdx,
  "mc_page_render.py must fail closed when first-panel art is missing rather than render a blank opening",
);
const openingComposite = renderSource.indexOf('opening_pane["art"]', openingMissingGuard);
assert.ok(
  openingComposite > openingMissingGuard,
  "mc_page_render.py must composite approved first-panel art into the page before the preroll frames are rendered",
);

console.log("motionComicKeepClearGate.test.ts: opening panel is mandatory and visible during the preroll");
