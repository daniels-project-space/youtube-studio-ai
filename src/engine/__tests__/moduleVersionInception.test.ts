import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import type { PipelineEntry } from "../types";

// Execute the actual private, pure transformations without importing Trigger's
// task registration or provider clients. No generated replacement implementation.
const text = readFileSync("src/trigger/designChannelInception.ts", "utf8");
const source = ts.createSourceFile("inception.ts", text, ts.ScriptTarget.Latest, true);
const names = ["customizePipelineFromDna", "wireVoiceReadiness", "buildProbePipeline"];
const declarations = names.map((name) => {
  const declaration = source.statements.find((statement) => ts.isFunctionDeclaration(statement) && statement.name?.text === name);
  assert.ok(declaration, `missing production transformation ${name}`);
  return declaration.getText(source);
});
const compiled = ts.transpileModule(declarations.join("\n"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const functions = runInNewContext(`${compiled}\n({${names.join(",")}})`, {
  validateVoiceCastingReadinessReceipt: () => false,
}) as {
  customizePipelineFromDna: (entries: PipelineEntry[], identity: unknown, dna: unknown) => { pipeline: PipelineEntry[] };
  wireVoiceReadiness: (entries: PipelineEntry[], cast: undefined, owner: string, channel: string) => { pipeline: PipelineEntry[] };
  buildProbePipeline: (entries: PipelineEntry[]) => PipelineEntry[];
};

const entries: PipelineEntry[] = [
  { block: "script_gen", version: "2.0.0", params: { style: "generic" } },
  { block: "narration_tts", version: "3.0.0" },
  { block: "music", version: "2.0.0", params: { trackCount: 8 } },
];
const original = JSON.stringify(entries);
const dna = functions.customizePipelineFromDna(entries, { styleGrammar: "minimal", palette: ["ffffff"] }, {
  narrative: { pacing: "gentle", scriptStyle: "meditation" },
}).pipeline;
assert.equal(dna[0].params?.style, "meditation");
assert.equal(dna[1].params?.sentenceGapSec, 1.5);
const voice = functions.wireVoiceReadiness(dna, undefined, "fixture-owner", "fixture-channel").pipeline;
const probe = functions.buildProbePipeline(voice);
assert.equal(probe[0].params?.maxSeconds, 60);
assert.equal(probe[2].params?.trackCount, 1);
for (const transformed of [dna, voice, probe]) {
  assert.equal(JSON.stringify(transformed.map((entry) => entry.version)), JSON.stringify(["2.0.0", "3.0.0", "2.0.0"]));
}
assert.equal(JSON.stringify(entries), original);
console.log("MODULE VERSION INCEPTION PASS: actual DNA, no-cast voice and probe transformations preserve explicit versions; no Trigger/provider calls");
