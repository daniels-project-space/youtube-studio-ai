import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, stat, unlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type {
  WhiteboardArtRequest,
  WhiteboardGeneratedArt,
  WhiteboardStoryboard,
  WhiteboardSyncBrief,
  castWhiteboardSync,
} from "@/lib/whiteboardSync";

// Execute the real renderer caller, golden-style gate and filesystem cache.
// Only process/provider boundaries are replaced; no network or Python install.
const require = createRequire(import.meta.url);
const { build } = require(require.resolve("esbuild", { paths: [require.resolve("tsx")] })) as {
  build(options: Record<string, unknown>): Promise<{ outputFiles: Array<{ text: string }> }>;
};
type Builder = {
  onResolve(options: { filter: RegExp }, callback: (args: { path: string }) => { path: string; namespace: string } | undefined): void;
  onLoad(options: { filter: RegExp; namespace: string }, callback: (args: { path: string }) => { contents: string; loader: string }): void;
};
const TTS_BOUNDARY = "local test reached the narration boundary";
const RENDER_BOUNDARY = "local test reached the renderer boundary";
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
const digest = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");

async function loadCaller(): Promise<typeof castWhiteboardSync> {
  // Optional retained pre-change source proves request-byte parity and the
  // failing-before caller path; all normal runs execute current source.
  const baselineSource = process.env.WHITEBOARD_CACHE_BASELINE_SOURCE
    ? await readFile(process.env.WHITEBOARD_CACHE_BASELINE_SOURCE, "utf8") : undefined;
  const seams: Record<string, string> = {
    "node:child_process": `export const spawn=()=>{throw new Error(${JSON.stringify(RENDER_BOUNDARY)})};`,
    "@/agents/mastra": "export const agentJson=()=>{throw new Error('unexpected planner')}; export class MastraGenerationOutcomeUnknownError extends Error{}; export class MastraGenerationUnavailableError extends Error{};",
    "@/lib/anthropic": "export const hasAnthropicKey=()=>true;",
    "@/lib/openRouter": "export class OpenRouterGenerationOutcomeUnknownError extends Error{};",
    "@/lib/tts": `export const fallbackVoiceKey=()=>"fixture"; export const synthNarration=async()=>{throw new Error(${JSON.stringify(TTS_BOUNDARY)})};`,
    "@/lib/pydeps": "export const preflightPythonRenderer=async()=>{};",
  };
  const compiled = await build({
    absWorkingDir: process.cwd(), bundle: true, write: false, platform: "node", format: "cjs", packages: "external",
    define: { "process.env.FISH_AUDIO_API_KEY": JSON.stringify("fixture-never-sent") },
    stdin: { contents: 'export {castWhiteboardSync} from "./src/lib/whiteboardSync";', resolveDir: process.cwd(), loader: "ts" },
    plugins: [{ name: "whiteboard-cache-io-only", setup(builder: Builder) {
      if (baselineSource !== undefined) builder.onLoad({ filter: /\/whiteboardSync\.ts$/, namespace: "file" }, () => ({ contents: baselineSource, loader: "ts" }));
      builder.onResolve({ filter: /^(node:child_process|@\/)/ }, ({ path }) => seams[path] ? { path, namespace: "cache-io" } : undefined);
      builder.onLoad({ filter: /.*/, namespace: "cache-io" }, ({ path }) => ({ contents: seams[path]!, loader: "js" }));
    } }],
  });
  const compiledModule = { exports: {} as { castWhiteboardSync: typeof castWhiteboardSync } };
  new Function("require", "module", "exports", compiled.outputFiles[0]!.text)(require, compiledModule, compiledModule.exports);
  return compiledModule.exports.castWhiteboardSync;
}

function story(): WhiteboardStoryboard {
  const narration = "A small fee leaves an account at every year marker. Across the years it reduces the balance that can keep compounding. A worried saver sees the gap widen. The final balance shows the full compounding gap before the board holds. The calm final pause gives the viewer time to connect the annual fee, the calendar, the human reaction, and the separated future account values into one clear explanation rather than a rushed sequence of icons.";
  return {
    title: "Compounding fees", fullText: narration,
    panels: [{ idx: 0, narration, layers: [
      { kind: "art", color: "black", role: "hero", draw: "an account balance passing yearly fee toll marks before its next annual growth step", cue: "small fee leaves", box: [0.34, 0.20, 0.46, 0.48] },
      { kind: "art", color: "black", role: "evidence", draw: "a calendar with recurring red fee marks", cue: "Across the years", box: [0.10, 0.22, 0.20, 0.18] },
      { kind: "label", color: "black", text: "COMPOUNDING GAP", cue: "reduces the balance", box: [0.16, 0.84, 0.62, 0.07] },
      { kind: "art", color: "black", role: "reaction", draw: "a worried saver holding one account statement and looking at one red fee coin", cue: "worried saver", box: [0.10, 0.50, 0.20, 0.24] },
      { kind: "art", color: "black", role: "evidence", draw: "two future account values separated by a red gap arrow", cue: "human reaction", box: [0.80, 0.48, 0.16, 0.20] },
    ] }],
  };
}

function generated(request: WhiteboardArtRequest): WhiteboardGeneratedArt {
  return { bytes: PNG, receipt: {
    contractVersion: "attested-whiteboard-art/v1", provider: "novita", model: "test-transport-only",
    route: "local-z-image-turbo", profileId: "production", width: 1, height: 1, sourceContentType: "image/png",
    costUsd: 0.01, providerKey: `fixture/${request.id}.png`, providerJobId: `fixture-${request.id}`,
    providerRequestSha256: digest(JSON.stringify(request)), providerProfileSha256: "a".repeat(64),
    providerManifestSha256: "b".repeat(64), providerBillingReceiptSha256: "c".repeat(64),
    responseSha256: digest(PNG), createdAt: 1,
  } };
}

async function main(): Promise<void> {
  const cast = await loadCaller();
  const runDir = await mkdtemp(join(tmpdir(), "ysa-whiteboard-changed-plan-"));
  const requests: WhiteboardArtRequest[] = [];
  const logs: string[] = [];
  const invoke = (plan?: WhiteboardStoryboard, brief: Partial<WhiteboardSyncBrief> = {}) => cast({
    brief: { topic: "Compounding fees", styleId: "history", panels: 1, targetWords: 150, ...brief },
    plan, runDir, log: (message) => logs.push(message),
    generateImage: async (request) => { requests.push(request); return generated(request); },
  });
  try {
    const plan = story();
    await assert.rejects(() => invoke(plan), (error: Error) => error.message === TTS_BOUNDARY);
    assert.equal(requests.length, 4);
    console.log(`fresh request bytes sha256: ${digest(JSON.stringify([...requests].sort((a, b) => a.id.localeCompare(b.id))))}`);
    const files = (await readdir(runDir)).filter((name) => /^art_.*\.(?:png|receipt\.json)$/.test(name));
    const before = new Map(await Promise.all(files.map(async (name) => [name, await readFile(join(runDir, name))] as const)));
    assert.equal(before.size, 8);
    const paidWrites = async () => new Map(await Promise.all(files.map(async (name) => {
      const info = await stat(join(runDir, name), { bigint: true });
      return [name, [info.mtimeNs, info.ctimeNs]] as const;
    })));
    const beforePaidWrites = await paidWrites();
    requests.length = 0;
    await assert.rejects(() => invoke(plan), (error: Error) => error.message === TTS_BOUNDARY);
    assert.equal(requests.length, 0, "unchanged retry uses the original attested pairs");
    const changed = { ...plan, title: "A clearer native header" };
    let actual: unknown;
    try { await invoke(changed); } catch (error) { actual = error; }
    console.log(JSON.stringify({ actual: actual instanceof Error ? actual.message : actual, requests: requests.length, remaining: await readdir(runDir), logs }, null, 2));
    assert.ok(actual instanceof Error && actual.message === TTS_BOUNDARY,
      `title-only revision must preserve paid art and reach narration; got ${String(actual)}`);
    assert.equal(requests.length, 0, "a title-only repair must not buy art");
    for (const [name, bytes] of before) assert.deepEqual(await readFile(join(runDir, name)), bytes, `paid ${name} must remain byte-identical`);
    assert.deepEqual(await paidWrites(), beforePaidWrites, "unchanged/title-only retry performs no paid cache writes");

    // A legacy attested pair needs no new sidecar/ID: ordinary stage retries
    // still reuse it, and title/label/colour/layout changes can reach rendering
    // with the existing narration and forced-alignment cache intact.
    const audio = Buffer.from("local retained narration fixture; no synthesis");
    const words = plan.fullText.split(/\s+/).map((text, index) => ({ text, start: index * 700, end: (index + 1) * 700 }));
    await writeFile(join(runDir, "narration.mp3"), audio);
    await writeFile(join(runDir, "wwords.json"), JSON.stringify(words));
    const equivalent = structuredClone(changed);
    equivalent.panels[0]!.idx = 7; // runtime always uses sequential indices
    equivalent.panels[0]!.narration = `  ${equivalent.panels[0]!.narration.replaceAll(" ", "  ")}  `;
    equivalent.fullText = "This unused summary must never be synthesized.";
    equivalent.panels[0]!.layers[2]!.text = "YEARLY FEE GAP";
    equivalent.panels[0]!.layers[2]!.color = "red";
    equivalent.panels[0]!.layers[1]!.box[0] = 0.11;
    await assert.rejects(() => invoke(equivalent), (error: Error) => error.message === RENDER_BOUNDARY);
    await assert.rejects(() => invoke(), (error: Error) => error.message === RENDER_BOUNDARY,
      "a normal cached-plan retry must retain existing attested art and audio");
    assert.equal(requests.length, 0);
    assert.deepEqual(await readFile(join(runDir, "narration.mp3")), audio);
    assert.equal(await readFile(join(runDir, "wwords.json"), "utf8"), JSON.stringify(words));
    assert.deepEqual(await paidWrites(), beforePaidWrites);

    const snapshot = async () => new Map(await Promise.all(
      (await readdir(runDir)).map(async (name) => {
        const info = await stat(join(runDir, name), { bigint: true });
        return [name, { bytes: await readFile(join(runDir, name)), mtimeNs: info.mtimeNs, ctimeNs: info.ctimeNs }] as const;
      }),
    ));
    const unchanged = await snapshot();
    const frozen = JSON.parse(await readFile(join(runDir, "plan.json"), "utf8")) as WhiteboardStoryboard;
    const changedArt = structuredClone(frozen);
    changedArt.panels[0]!.layers[1]!.draw = "a calendar with one clearly separated annual red fee coin";
    const changedNarration = structuredClone(frozen);
    changedNarration.panels[0]!.narration += " The lesson is now complete.";
    changedNarration.fullText = changedNarration.panels[0]!.narration;
    const changedSceneClass = structuredClone(frozen);
    changedSceneClass.panels[0]!.layers[1]!.box = [0.01, 0.22, 0.32, 0.18];
    const changedCue = structuredClone(frozen);
    changedCue.panels[0]!.layers[0]!.cue = "fee leaves";
    for (const revision of [changedArt, changedNarration, changedSceneClass, changedCue]) {
      await assert.rejects(() => invoke(revision), /explicit artifact revision is required before new spend/);
      assert.deepEqual(await snapshot(), unchanged, "blocked generation revisions preserve the frozen plan, all bytes and receipts");
      assert.equal(requests.length, 0);
    }
    // Label position affects the existing index-keyed art IDs: inserting a
    // label is NOT equivalent even though its text is rendered locally.
    const changedIndices = structuredClone(frozen);
    changedIndices.panels[0]!.layers.unshift({ kind: "label", text: "FEE", color: "black", cue: "A small", box: [0.1, 0.75, 0.3, 0.07] });
    await assert.rejects(() => invoke(changedIndices), /explicit artifact revision is required before new spend/);
    assert.deepEqual(await snapshot(), unchanged);
    assert.equal(requests.length, 0);
    const changedOrder = structuredClone(frozen);
    [changedOrder.panels[0]!.layers[0], changedOrder.panels[0]!.layers[1]] = [changedOrder.panels[0]!.layers[1]!, changedOrder.panels[0]!.layers[0]!];
    await assert.rejects(() => invoke(changedOrder), /visual cues are out of narration order/);
    assert.deepEqual(await snapshot(), unchanged);
    await assert.rejects(() => invoke(frozen, { targetWords: 74 }), /explicit artifact revision is required before new spend/);
    assert.deepEqual(await snapshot(), unchanged, "new bounds must not be applied to the old projection and hide a changed request");
    assert.equal(requests.length, 0);

    // Existing unknown/incomplete outputs remain fail-closed. Neither a title
    // repair nor an ordinary retry may erase the durable evidence and re-buy.
    const imageName = [...before.keys()].find((name) => name.endsWith(".png"))!;
    const receiptName = imageName.replace(/\.png$/, ".receipt.json");
    await unlink(join(runDir, imageName));
    const receiptOnly = await snapshot();
    await assert.rejects(() => invoke(frozen), /receipt but no local bytes/);
    assert.deepEqual(await snapshot(), receiptOnly);
    assert.equal(requests.length, 0);
    await writeFile(join(runDir, imageName), before.get(imageName)!);
    await unlink(join(runDir, receiptName));
    const bytesOnly = await snapshot();
    await assert.rejects(() => invoke(frozen), /no attested provider receipt/);
    assert.deepEqual(await snapshot(), bytesOnly);
    assert.equal(requests.length, 0);
    await writeFile(join(runDir, receiptName), before.get(receiptName)!);
    await writeFile(join(runDir, imageName), "corrupt cached art");
    const corrupt = await snapshot();
    await assert.rejects(() => invoke(frozen), /bytes do not match their attested provider receipt/);
    assert.deepEqual(await snapshot(), corrupt);
    assert.equal(requests.length, 0);
    await writeFile(join(runDir, imageName), before.get(imageName)!);
    await unlink(join(runDir, "plan.json"));
    const noPlan = await snapshot();
    await assert.rejects(() => invoke(frozen), /frozen plan is missing/);
    await assert.rejects(() => invoke(), /frozen plan is missing/, "missing-plan cache must refuse before the planner provider");
    assert.deepEqual(await snapshot(), noPlan);
    assert.equal(requests.length, 0);
    console.log("whiteboard changed-plan real-caller cache: PASS");
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
}

void main();
