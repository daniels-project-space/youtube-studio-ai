/**
 * Nothing on a live path may depend on the Gemini runtime.
 *
 * `hasGeminiKey()` returning false is the visible half of the policy. The other
 * half is stronger and was missed: `generate()` calls
 * assertGeminiRuntimeAllowed with no purpose, so EVERY geminiJson,
 * geminiJsonPro, geminiVisionLocal and geminiAnalyzeYouTube call throws
 * GeminiRuntimeDisabledError — verified by calling one with a valid
 * GEMINI_API_KEY injected. No key re-enables it.
 *
 * That turns each remaining call site into one of two things:
 *
 *   UNGUARDED  it throws and fails whatever reached it. engine/forge/runtime's
 *              llm_json step was one, and the forge is reachable from
 *              runPipeline and designChannelInception — so every
 *              architect-authored module with an llm_json step failed at
 *              execution. Now on claudeJson.
 *   CAUGHT     it degrades. documotion's label lint and cinematographer pass are
 *              both caught and both name the loss, and the policy message
 *              reaches the log, so a reader can tell.
 *
 * This pins the boundary rather than the individual sites: the two entry points
 * that reach the forge must not regain a Gemini dependency, and a capability
 * predicate must never answer yes for a runtime that refuses.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { hasDocumotion } from "@/lib/documotion";
import { isGeminiRuntimeEnabled } from "@/lib/gemini";

const read = (path: string) =>
  readFileSync(join(process.cwd(), path), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

/* ------------- a capability check may not outrun the runtime -------------- */

// The planning answer used to be Boolean(process.env.GEMINI_API_KEY), and that
// key is set here — so it returned true for a runtime that throws. A check that
// says yes and then throws is worse than one that says no: the caller has
// already committed by the time it finds out.
const saved = process.env.GEMINI_API_KEY;
process.env.GEMINI_API_KEY = "a-real-looking-key";
try {
  assert.equal(
    hasDocumotion({ requiresPlanning: true }),
    isGeminiRuntimeEnabled(),
    "documotion planning is available exactly when the Gemini RUNTIME is, never merely when a key is present",
  );
  assert.equal(
    hasDocumotion({ requiresPlanning: false }),
    true,
    "the production path supplies its own locked plan and must stay available",
  );
} finally {
  if (saved === undefined) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = saved;
}

/* ------------------- the forge runs on the permitted route ---------------- */

const forge = read("src/engine/forge/runtime.ts");
assert.ok(
  !/\bgeminiJson\s*[<(]/.test(forge) && !/\bgeminiJsonPro\s*[<(]/.test(forge),
  "the forge executes architect-authored modules and is reachable from runPipeline — " +
    "a Gemini call there throws for every forged llm_json step",
);
assert.match(
  forge,
  /const raw = await claudeJson</,
  "the forge's llm_json step must run on the permitted route",
);

/* ------------- reachable entry points stay off the Gemini runtime --------- */

// These two import the forge. Neither may reach Gemini directly.
for (const path of ["src/trigger/runPipeline.ts", "src/trigger/designChannelInception.ts"]) {
  const source = read(path);
  assert.ok(
    !/from "@\/lib\/gemini"/.test(source),
    `${path} is a live entry point and must not import the Gemini runtime directly`,
  );
}

/* ----------------------- degrading sites still say so --------------------- */

// documotion's two optional passes are allowed to fail — they are enrichment —
// but a reader of the run log has to be able to tell that they did.
const documotion = read("src/lib/documotion.ts");
for (const marker of ["label lint skipped", "cinematographer pass skipped"]) {
  assert.ok(
    documotion.includes(marker),
    `documotion's optional pass must name its loss ("${marker}") rather than failing silently`,
  );
}

console.log("GEMINI RUNTIME REACH PASS — no live path depends on a runtime that refuses");
