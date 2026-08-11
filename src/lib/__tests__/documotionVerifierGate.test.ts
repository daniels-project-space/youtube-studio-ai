import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// P2-3 (GOLDEN_MODULE_AUDIT_2026-08.md): "documotion ... numeric gate
// thresholds (still-verifier >=7 ...) not traced into the block files."
// documentaryCollageShortBlocks.ts only forwards a boolean
// (`verdict?.pass === true`) — the actual "every craft score must clear 7"
// arithmetic lives inside verifyDocu() in src/lib/documotion.ts, which makes
// one live Gemini vision call per invocation and cannot run as a plain unit
// test. Rather than reimplementing the gate (which would test OUR logic, not
// the shipped code), this test extracts the exact hard-gate recompute
// statement verbatim from the real source file, compiles it in isolation, and
// exercises it with realistic score sets — so a real weakening of the
// threshold in documotion.ts breaks this test.

const documotionSource = readFileSync(join(process.cwd(), "src/lib/documotion.ts"), "utf8");

const startMarker =
  "const scores = [v.typeCraft, v.cutoutCraft, v.composition, v.legibility, v.styleMatch, v.cohesion];";
const endMarker = 'if (scores.every((s) => typeof s === "number")) v.pass = (scores as number[]).every((s) => s >= 7);';

const startIdx = documotionSource.indexOf(startMarker);
assert.notEqual(
  startIdx,
  -1,
  "documotion.ts: the still-verifier scores array must remain present verbatim — the hard legibility/cohesion gate may have moved",
);
const endIdx = documotionSource.indexOf(endMarker, startIdx);
assert.notEqual(
  endIdx,
  -1,
  "documotion.ts: the still-verifier >=7 recompute must remain present verbatim — the hard gate may have been weakened, removed, or its threshold changed",
);
const extractedGateBody = documotionSource.slice(startIdx, endIdx + endMarker.length);

interface ExtractedDocuVerdict {
  typeCraft?: number;
  cutoutCraft?: number;
  composition?: number;
  legibility?: number;
  styleMatch?: number;
  cohesion?: number;
  pass?: boolean;
}

async function run(): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "documotion-gate-extract-"));
  try {
    const modulePath = join(dir, "recomputeDocuPass.ts");
    const moduleSource = [
      "export interface ExtractedDocuVerdict {",
      "  typeCraft?: number;",
      "  cutoutCraft?: number;",
      "  composition?: number;",
      "  legibility?: number;",
      "  styleMatch?: number;",
      "  cohesion?: number;",
      "  pass?: boolean;",
      "}",
      "",
      "// --- verbatim extract from src/lib/documotion.ts (verifyDocu) below ---",
      "export function recomputeDocuPass(v: ExtractedDocuVerdict): ExtractedDocuVerdict {",
      `  ${extractedGateBody}`,
      "  return v;",
      "}",
      "// --- end verbatim extract ---",
      "",
    ].join("\n");
    await writeFile(modulePath, moduleSource, "utf8");
    const mod = (await import(modulePath)) as {
      recomputeDocuPass: (v: ExtractedDocuVerdict) => ExtractedDocuVerdict;
    };

    // All six scores exactly at the 7 boundary, but the model itself said
    // pass:false — the HARD gate must override to true because ">= 7" is
    // genuinely satisfied on every axis (boundary is inclusive, not ">7").
    const allSeven = mod.recomputeDocuPass({
      typeCraft: 7, cutoutCraft: 7, composition: 7, legibility: 7, styleMatch: 7, cohesion: 7, pass: false,
    });
    assert.equal(allSeven.pass, true, "still-verifier: six scores at the 7 boundary must recompute pass=true (>=7, not >7)");

    // legibility=6 is the score the doctrine explicitly ties to "any two text
    // blocks overlap or touch" — the exact failure mode this hard gate exists
    // to catch. A generous model-reported pass:true must be overridden.
    const legibilityFails = mod.recomputeDocuPass({
      typeCraft: 9, cutoutCraft: 9, composition: 9, legibility: 6, styleMatch: 9, cohesion: 9, pass: true,
    });
    assert.equal(
      legibilityFails.pass, false,
      "still-verifier: legibility=6 (one point under the gate) must force pass=false even when the model said pass=true",
    );

    // cohesion=6 (the "shows its line's MUST-SHOW cues" score) must trip the
    // same hard override — proves the gate checks ALL six axes, not just
    // legibility.
    const cohesionFails = mod.recomputeDocuPass({
      typeCraft: 9, cutoutCraft: 9, composition: 9, legibility: 9, styleMatch: 9, cohesion: 6, pass: true,
    });
    assert.equal(
      cohesionFails.pass, false,
      "still-verifier: cohesion=6 must force pass=false — the hard gate must check every one of the six craft scores",
    );

    // Every score comfortably above 7 with an honest pass:true is left alone.
    const cleanPass = mod.recomputeDocuPass({
      typeCraft: 9, cutoutCraft: 8, composition: 9, legibility: 10, styleMatch: 8, cohesion: 9, pass: true,
    });
    assert.equal(cleanPass.pass, true, "still-verifier: a genuinely clean score set must remain pass=true");

    // Documented current behavior (not a claimed gate): when a score is
    // missing/unparseable, the recompute intentionally does not fire (it only
    // overrides when every score is a real number), so an incomplete verdict
    // is left exactly as the caller supplied it.
    const incomplete = mod.recomputeDocuPass({
      typeCraft: 9, cutoutCraft: 9, composition: 9, legibility: undefined, styleMatch: 9, cohesion: 9, pass: true,
    });
    assert.equal(
      incomplete.pass, true,
      "documented current behavior: an incomplete score set is not recomputed and the caller's own pass value survives untouched",
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

run()
  .then(() => console.log("documotionVerifierGate.test.ts: still-verifier >=7 hard-gate recompute verified against the real source"))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
