import assert from "node:assert/strict";
import Module from "node:module";
import { OpenRouterGenerationOutcomeUnknownError } from "@/lib/openRouter";

type Mode = "section" | "conclusion" | "unknown" | "unknown-section" | "topup" | "thin" | "landing-floor" | "many" | "complete";
let mode: Mode = "section";
let calls = 0;
let sectionCalls = 0;
const prompts: string[] = [];
const prose = Array.from({ length: 420 }, (_, i) => `evidence${i}`).join(" ");
const originalLoad = (Module as unknown as { _load: (...args: unknown[]) => unknown })._load;
(Module as unknown as { _load: typeof originalLoad })._load = function (this: unknown, request, ...rest) {
  const resolved = originalLoad.call(this, request, ...rest);
  if (typeof request !== "string" || !request.endsWith("/creativeText")) return resolved;
  return {
    ...resolved as object,
    hasCreativeTextKey: () => true,
    creativeTextJson: async ({ prompt }: { prompt: string }) => {
      calls++;
      prompts.push(prompt);
      if (prompt.includes("Write a COMPLETE long-form")) {
        if (mode === "unknown") throw new OpenRouterGenerationOutcomeUnknownError("lost after dispatch", { status: 503 });
        if (mode === "topup") return {
          sections: ["Arrival", "Evidence", "Landing"].map((heading) => ({ heading, narration: prose.split(" ").slice(0, 230).join(" ") })),
          closing_line: "Evidence keeps the story honest.",
        };
        return { sections: [] };
      }
      if (prompt.includes("CONTINUING a long-form")) return { sections: [{ heading: "Deeper evidence", narration: prose }] };
      if (prompt.includes("write closing_line")) return { closing_line: "Evidence keeps the story honest." };
      if (prompt.includes("ONE section")) {
        sectionCalls++;
        if (mode === "unknown-section") throw new OpenRouterGenerationOutcomeUnknownError("section lost after dispatch", { status: 503 });
        if (mode === "thin") return { narration: prose.split(" ").slice(0, 250).join(" ") };
        if (mode === "landing-floor") return { narration: prose.split(" ").slice(0, 300).join(" ") };
        if (mode === "many") return { narration: `spokenBeat${sectionCalls} ${prose}` };
        return { narration: mode === "section" && prompt.includes('Section: "Compare date"') ? "" : prose };
      }
      if (prompt.includes("CLOSING CONCLUSION")) return {
        narration: mode === "conclusion" ? "" : mode === "landing-floor"
          ? prose.split(" ").slice(0, 180).join(" ")
          : "The ledger resolves the question. Evidence keeps the story honest.",
      };
      return { sections: [] };
    },
  };
};

async function main(): Promise<void> {
  try {
    const { synthScript } = await import("@/lib/scriptGen");
    const crafted = {
      hook: "The bridge ledger holds a contradiction.", opening: "Mara checks the date.",
      coldOpen: "The bridge ledger holds a contradiction. Mara checks the date.",
      device: "receipt", loop: "Resolve the ledger date.", verdict: {},
    } as unknown as import("@/lib/hookcraft").CraftedHook;
    const req = {
      topic: "The bridge ledger", maxSeconds: 421, precraftedHook: crafted,
      channelName: "Archive Hour", persona: "Patient archivist of ordinary lives.",
      structure: { beats: [{ name: "Inspect ledger" }, { name: "Compare date" }, { name: "Resolve contradiction" }] },
      series: { name: "River records", episode: 2, total: 4, previousSummary: "The map named the old crossing." },
    };
    await assert.rejects(synthScript(req), /section .*failed after 3 attempts/i,
      "an exhausted required section cannot be skipped and followed by a successful conclusion");
    assert.equal(sectionCalls, 4, "fail at the exhausted beat before generating later beats");

    mode = "conclusion";
    await assert.rejects(synthScript(req), /conclusion.*no usable narration/i,
      "body narration cannot masquerade as a complete script when the ending is empty");

    mode = "unknown";
    calls = 0;
    await assert.rejects(synthScript(req), OpenRouterGenerationOutcomeUnknownError);
    assert.equal(calls, 1, "uncertain provider completion must not launch overlapping fallback work");

    mode = "unknown-section";
    sectionCalls = 0;
    await assert.rejects(synthScript(req), OpenRouterGenerationOutcomeUnknownError);
    assert.equal(sectionCalls, 1, "uncertain section completion must not be retried");

    mode = "thin";
    await assert.rejects(synthScript(req), /<80% of budget/,
      "an exhausted outline cannot return a short script merely because some sections succeeded");

    mode = "landing-floor";
    const landed = await synthScript(req);
    const floor = Math.round(Math.round(421 * (Number(process.env.NARRATION_WPS) || 3.1)) * 0.8);
    const bodyWords = [landed.hook, ...landed.sections.slice(0, -1).map((s) => s.narration)].join(" ").split(/\s+/).length;
    assert.ok(bodyWords < floor, "fixture body must be below the floor before its ending");
    assert.ok(landed.narrationText.split(/\s+/).length >= floor, "the complete narration must clear the floor");
    assert.equal(landed.sections.at(-1)?.heading, "Conclusion");

    mode = "many";
    sectionCalls = 0;
    prompts.length = 0;
    const manyBeats = Array.from({ length: 20 }, (_, i) => ({ name: `Movement ${i + 1}` }));
    await synthScript({ ...req, maxSeconds: 2800, structure: { beats: manyBeats } });
    const longPrompts = prompts.filter((p) => p.includes("ONE section"));
    assert.equal(longPrompts.length, 20, "exercise a complete long chunk sequence");
    const promptCeiling = longPrompts[2]!.length + 1000;
    for (let i = 2; i < longPrompts.length; i++) {
      const prompt = longPrompts[i]!;
      assert.ok(prompt.length <= promptCeiling, "prompt size may grow by compact headings, not accumulated narration");
      assert.ok(prompt.includes(`Completed sections (in order; do NOT repeat): ${manyBeats.slice(0, i).map((b) => b.name).join("; ")}`));
      assert.ok(prompt.includes(`spokenBeat${i - 1} `) && prompt.includes(`spokenBeat${i} `), "retain the two recent spoken sections");
      if (i > 2) assert.ok(!prompt.includes(`spokenBeat${i - 2} `), "older spoken sections must leave the rolling window");
    }

    mode = "topup";
    prompts.length = 0;
    const toppedUp = await synthScript(req);
    assert.deepEqual(toppedUp.sections.map((s) => s.heading), ["Arrival", "Evidence", "Deeper evidence", "Landing"]);
    const continuation = prompts.find((p) => p.includes("CONTINUING a long-form"))!;
    for (const context of [req.persona, req.series.previousSummary, crafted.coldOpen, "evidence229"]) {
      assert.ok(continuation.includes(context), `one-shot continuation must retain context: ${context}`);
    }

    mode = "complete";
    prompts.length = 0;
    const script = await synthScript(req);
    assert.equal(script.sections.at(-1)?.heading, "Conclusion");
    const sectionPrompts = prompts.filter((p) => p.includes("ONE section"));
    for (const prompt of sectionPrompts) {
      assert.ok(prompt.includes(req.persona), "section generation needs the frozen persona");
      assert.ok(prompt.includes(req.series.previousSummary), "section generation needs the episode thread");
    }
    assert.ok(sectionPrompts[1]?.includes(prose), "later sections need prior spoken content to avoid restarts");
    console.log("SCRIPT LONG COMPLETION PASS — exhausted beats, missing ending, uncertain provider work, and context");
  } finally {
    (Module as unknown as { _load: typeof originalLoad })._load = originalLoad;
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
