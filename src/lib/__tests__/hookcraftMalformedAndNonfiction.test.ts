import assert from "node:assert/strict";
import Module from "node:module";

let malformed = false;
let unsupported = false;
let generationCalls = 0;
const originalLoad = (Module as unknown as { _load: (...args: unknown[]) => unknown })._load;
(Module as unknown as { _load: typeof originalLoad })._load = function (this: unknown, request, ...rest) {
  const resolved = originalLoad.call(this, request, ...rest);
  if (typeof request !== "string" || !request.endsWith("/creativeText")) return resolved;
  return {
    ...resolved as object,
    hasCreativeTextKey: () => true,
    creativeTextJsonPro: async () => {
      generationCalls++;
      if (malformed && generationCalls === 1) return { candidates: [null, { hook: { text: "bad shape" } }] };
      return { candidates: [{
        device: "receipt",
        hook: `The Chernobyl safety test failed in ${unsupported ? "1987" : "1986"}.`,
        opening: "The surviving logs show how the routine test became a disaster. Engineers faced a warning they could no longer ignore. Follow the record from the first decision to the final alarm, and the sequence explains why the warning mattered. The same record also exposes the gap between the plan and its execution.",
        loop: "Explain the gap between the plan and its execution.",
      }] };
    },
    creativeTextJson: async () => ({ best: malformed ? 0.5 : 0, verdicts: [{ punch: 9, specificity: 9, curiosity: 9, voiceMatch: 9, promise: 9, honest: true }] }),
  };
};
async function main(): Promise<void> {
  try {
    const { craftHook } = await import("@/lib/hookcraft");
    const args = { topic: "Chernobyl safety test", niche: "non-fiction history", sourceGrounding: "The Chernobyl safety test failed in 1986." };
    unsupported = true;
    await assert.rejects(craftHook(args), /numeric claim 1987 is absent/,
      "non-fiction is factual: its niche name must not disable the numeric source gate");
    assert.equal(generationCalls, 2);
    unsupported = false;
    malformed = true;
    generationCalls = 0;
    const hook = await craftHook(args);
    assert.equal(generationCalls, 2, "malformed candidates should use the existing single feedback retry");
    assert.match(hook.hook, /1986/);
    assert.equal(hook.verdict.factCheck, "unchecked", "numeric matching is not semantic verification");
    console.log("HOOKCRAFT MALFORMED/NONFICTION PASS — source gate, fractional judge index, bounded recovery");
  } finally {
    (Module as unknown as { _load: typeof originalLoad })._load = originalLoad;
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
