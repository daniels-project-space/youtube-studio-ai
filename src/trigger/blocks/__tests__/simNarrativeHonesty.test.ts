/**
 * sim_narrative honesty lock.
 *
 * The dramatized-simulation format is only acceptable because it is HONEST
 * about being invented. That honesty is implemented in code rather than in a
 * prompt, and this suite binds every mechanism that makes the claim true:
 *
 *   1. the disclosure is prepended AND appended by the block, not requested
 *      from the model, so an ignored instruction cannot strip it;
 *   2. narration that asserts the run was real is rejected outright;
 *   3. the emitted ChartSpec is speculative, carries the disclosure, and cannot
 *      carry a citation;
 *   4. the curve is INTERPOLATED from the authored beats — the graph moves when
 *      the narration does, and no per-generation call exists to make it;
 *   5. the prompt itself forbids fabricated evidence.
 */
import assert from "node:assert/strict";
import { chartSpecDefects, SPECULATIVE_DISCLOSURE } from "@/lib/chartSpec";
import {
  buildSimChartSpec,
  curveFromBeats,
  deterministicSimNarrative,
  normalizeSimNarrative,
  simNarrativeDefects,
  simNarrativePrompt,
  SIM_MIN_BEATS,
  SPECULATIVE_CLOSER,
  SPECULATIVE_OPENER,
  type SimNarrative,
} from "../simNarrativeBlocks";

function narrationFor(narrative: SimNarrative): string {
  return [SPECULATIVE_OPENER, narrative.beats.map((b) => b.narration).join("\n\n"), SPECULATIVE_CLOSER].join("\n\n");
}

function main(): void {
  const narrative = deterministicSimNarrative("creatures learning to walk");
  assert.ok(narrative.beats.length >= SIM_MIN_BEATS);

  /* 1 — the disclosure is applied in code, at both ends */
  const narration = narrationFor(narrative);
  assert.ok(narration.startsWith(SPECULATIVE_OPENER));
  assert.ok(narration.trimEnd().endsWith(SPECULATIVE_CLOSER));
  assert.deepEqual(simNarrativeDefects(narration, narrative), []);
  // The opener must actually SAY the thing, not gesture at it.
  assert.match(SPECULATIVE_OPENER, /imagine a simulation/i);
  assert.match(SPECULATIVE_OPENER, /invented/i);
  assert.match(SPECULATIVE_CLOSER, /not an experiment/i);

  // Stripping either end must fail the gate.
  assert.ok(
    simNarrativeDefects(narration.replace(SPECULATIVE_OPENER, "").trim(), narrative)
      .some((d) => d.includes("does not open")),
  );
  assert.ok(
    simNarrativeDefects(`${SPECULATIVE_OPENER}\n\nbody`, narrative).some((d) => d.includes("does not close")),
  );

  /* 2 — reality claims are rejected */
  for (const claim of [
    "We ran this for six hundred generations.",
    "Our experiment showed a clear plateau.",
    "The data shows a collapse at generation two hundred.",
    "Actual results were even more dramatic.",
    "Studies show that populations recover.",
  ]) {
    const dishonest = [SPECULATIVE_OPENER, claim, SPECULATIVE_CLOSER].join("\n\n");
    assert.ok(
      simNarrativeDefects(dishonest, narrative).some((d) => d.includes("claims the run was real")),
      `"${claim}" must be rejected as a false claim of measurement`,
    );
  }
  // ...but the disclosure's own use of the word "run" must NOT trip the gate,
  // which is exactly why the scan excludes the opener/closer.
  assert.deepEqual(
    simNarrativeDefects(narration, narrative).filter((d) => d.includes("claims the run was real")),
    [],
  );

  /* 3 — the emitted spec is speculative and uncitable */
  const spec = buildSimChartSpec({ narrative, secondsPerRow: 6, outroSeconds: 4 });
  assert.deepEqual(chartSpecDefects(spec), [], "the authored spec must validate");
  assert.equal(spec.speculative, true);
  assert.equal(spec.disclosure, SPECULATIVE_DISCLOSURE);
  assert.equal(spec.mode, "line_series");
  for (const row of spec.rows) {
    assert.equal(row.provenance, "speculative-illustrative");
    assert.equal(row.sourceUrl, undefined, "an invented curve may never carry a citation");
  }
  // Every authored beat must reach the renderer as an on-screen caption.
  assert.equal(spec.beats?.length, narrative.beats.length);
  for (const beat of narrative.beats) {
    assert.ok(
      spec.beats?.some((b) => b.step === beat.generation && b.caption === beat.caption),
      `beat at generation ${beat.generation} must survive into the render contract`,
    );
  }

  /* 4 — the curve follows the beats */
  const curve = curveFromBeats(narrative.beats);
  assert.ok(curve.length > narrative.beats.length, "the curve is interpolated, not just the beat points");
  assert.equal(curve[0].step, narrative.beats[0].generation);
  assert.equal(curve[curve.length - 1].step, narrative.beats[narrative.beats.length - 1].generation);
  // A dip in the authored levels must be a dip in the drawn curve.
  const dipIndex = narrative.beats.findIndex((b, i) => i > 0 && b.level < narrative.beats[i - 1].level);
  assert.ok(dipIndex > 0, "the deterministic arc must contain a setback to test against");
  const before = narrative.beats[dipIndex - 1];
  const dip = narrative.beats[dipIndex];
  const valueAt = (generation: number) =>
    curve.reduce((best, point) =>
      Math.abs(point.step - generation) < Math.abs(best.step - generation) ? point : best,
    );
  assert.ok(
    valueAt(dip.generation).value < valueAt(before.generation).value,
    "the graph must fall exactly where the narration says it falls",
  );
  // Deterministic — a healer replay must reproduce the same curve.
  assert.deepEqual(curve, curveFromBeats(narrative.beats));

  /* normalization tolerates a sloppy model without ever inventing a beat */
  const normalized = normalizeSimNarrative(
    {
      title: "  ",
      beats: [
        { generation: 5, level: 2, caption: "x", narration: "y" },
        { generation: 1, level: -1, caption: "a", narration: "b" },
        { generation: 3, caption: "", narration: "no caption" },
        { generation: "nope", level: 0.5, caption: "c", narration: "d" },
      ],
    },
    "fallback topic",
  );
  assert.equal(normalized.title, "fallback topic", "an empty title falls back rather than shipping blank");
  assert.equal(normalized.beats.length, 2, "unusable beats are dropped, never repaired into fiction");
  assert.deepEqual(normalized.beats.map((b) => b.generation), [1, 5], "beats are sorted by generation");
  assert.equal(normalized.beats[0].level, 0, "levels are clamped into 0..1");
  assert.equal(normalized.beats[1].level, 1);

  /* a set with too few beats must not be accepted */
  const thin: SimNarrative = { ...narrative, beats: narrative.beats.slice(0, 2) };
  assert.ok(
    simNarrativeDefects(narrationFor(thin), thin).some((d) => d.includes("beats")),
    "a two-beat 'simulation' is not a story arc",
  );

  /* 5 — the prompt forbids fabricated evidence and demands the shape */
  const prompt = simNarrativePrompt({ topic: "creatures learning to walk", beats: 6 });
  assert.match(prompt, /IMAGINARY|thought experiment/i);
  assert.match(prompt, /never claim the run happened/i);
  assert.match(prompt, /the data shows/i, "the prompt must name the exact phrases the gate rejects");
  assert.ok(!/per[- ]generation|每/i.test(prompt), "the prompt must not ask for a point-by-point series");
  assert.match(prompt, /EXACTLY 6 beats/);

  console.log("simNarrativeHonesty: disclosure, reality-claim gate, uncitable spec, beat-keyed curve and prompt locks passed");
}

main();
