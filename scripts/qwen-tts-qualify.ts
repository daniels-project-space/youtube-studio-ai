/**
 * QWEN3-TTS QUALIFICATION BENCHMARK — the thing that produces the receipt.
 *
 * docs/QWEN3_TTS_QUALIFICATION.md specifies four production variables, one of
 * which is `QWEN3_TTS_QUALITY_RECEIPT_SHA256=<64 lowercase hex>`, and says the
 * hash "must come from a reviewed benchmark of the exact worker/model
 * revision". This tool produces the retained benchmark evidence and digest.
 * Runtime readiness currently checks only the enabled flag and digest format;
 * it does NOT load this report or cryptographically establish qualification.
 *
 * This runs the matrix the doc requires against a live worker, measures every
 * take, and either prints a receipt or refuses with reasons. It cannot be made
 * to emit a receipt for audio it did not measure:
 *
 *   - the hash covers measurements and verdicts, so editing either changes the
 *     benchmark digest (not an automatic runtime report-verification gate);
 *   - every axis has a threshold, and a single failure suppresses the receipt;
 *   - the human verdict is a required input, not a default. The doc asks for a
 *     "human register/performance verdict" and no measurement substitutes for
 *     listening, so this writes the MP3s to disk and refuses to proceed until
 *     the operator has recorded a verdict per take.
 *
 * WHAT IT COSTS. A first pass in an empty output directory makes 6 real GPU
 * calls. --verdicts only validates and remeasures retained audio offline; it
 * never synthesizes or automatically retries unknown paid outcomes.
 *
 * Usage:
 *   ai-vault <service> QWEN3_TTS_WORKER_TOKEN=QWEN3_TTS_WORKER_TOKEN -- \
 *     QWEN3_TTS_WORKER_URL=https://... \
 *     ./node_modules/.bin/tsx scripts/qwen-tts-qualify.ts --out /tmp/qwen-qual
 *
 *   # listen, then supply SHA-bound {audioSha256, decision, verdict} entries:
 *   ./node_modules/.bin/tsx scripts/qwen-tts-qualify.ts --out /tmp/qwen-qual --verdicts /tmp/qwen-qual/verdicts.json
 */
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, lstatSync, readdirSync, renameSync } from "node:fs";
import { join } from "node:path";

import {
  QWEN3_TTS_MODEL,
  QWEN3_TTS_MODEL_REVISION,
  qwenTtsReadiness,
  synthQwenNarration,
  validateRetainedQwenTtsAudio,
  type QwenTtsReceipt,
} from "@/lib/qwenTts";

/**
 * The matrix docs/QWEN3_TTS_QUALIFICATION.md asks to retain, as code.
 *
 * Both English speakers on a documentary passage, because those are the two the
 * narrated channels would actually cast. A calm and an energetic passage on the
 * same speaker, because instruction-following is the axis most likely to be
 * absent — the CustomVoice model takes a natural-language instruction rather
 * than a rate parameter, and whether it obeys is exactly what a benchmark is
 * for. And one sample per language a real channel uses today: the live channels
 * include Spanish and German variants.
 */
interface Take {
  id: string;
  speaker: string;
  language: string;
  instruction?: string;
  text: string;
  /** What this take exists to prove. */
  proves: string;
}

const DOCUMENTARY_EN =
  "By the spring of 1945 the ridge had been taken and lost six times. " +
  "Every attempt cost more men than the last, and the maps in the command tent " +
  "no longer matched anything anyone could see from the escarpment itself.";

const TAKES: Take[] = [
  { id: "en-aiden-documentary", speaker: "Aiden", language: "English", text: DOCUMENTARY_EN,
    proves: "the primary English narration voice on a real documentary passage" },
  { id: "en-ryan-documentary", speaker: "Ryan", language: "English", text: DOCUMENTARY_EN,
    proves: "the second English voice on the identical passage, for A/B casting" },
  { id: "en-aiden-calm", speaker: "Aiden", language: "English",
    instruction: "Speak slowly and calmly, with long, settled pauses between sentences.",
    text: DOCUMENTARY_EN, proves: "instruction following: a calm/slow read must differ measurably in pace" },
  { id: "en-aiden-energetic", speaker: "Aiden", language: "English",
    instruction: "Speak with urgency and drive, quickly and with strong emphasis.",
    text: DOCUMENTARY_EN, proves: "instruction following: an energetic read must differ measurably the other way" },
  { id: "es-aiden", speaker: "Aiden", language: "Spanish",
    text: "En la primavera de 1945 la cresta ya había sido tomada y perdida seis veces, y cada intento costaba más que el anterior.",
    proves: "Spanish, which two live channels publish in" },
  { id: "de-aiden", speaker: "Aiden", language: "German",
    text: "Im Frühjahr 1945 war der Bergrücken bereits sechsmal eingenommen und wieder verloren worden, und jeder Versuch kostete mehr als der letzte.",
    proves: "German, which one live channel publishes in" },
];

/** Thresholds. Any failure suppresses the receipt. */
const MAX_WER = 0.12;              // ASR round-trip: the words must survive
const MIN_LUFS = -23;
const MAX_LUFS = -14;
const MAX_TRUE_PEAK_DBTP = -1.0;
const MIN_PACE_SEPARATION = 0.12;  // calm vs energetic must differ by >=12% WPM

interface Measured {
  take: Take;
  mp3Path: string;
  audioSha256: string;
  bytes: number;
  durationSec: number;
  wordsPerSec: number;
  lufs: number;
  truePeakDbtp: number;
  wer: number | null;
  transcript: string;
  receipt: QwenTtsReceipt | undefined;
  failures: string[];
}

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

/**
 * Every waveform measurement in one place.
 *
 * scripts/qwen_take_measure.py owns duration, loudness, true peak, ASR
 * transcript and word-error rate, because Python has the audio libraries and a
 * second implementation here would drift from it. Validated before use: an
 * exact reference scores WER 0.0, one wrong word in twenty scores 0.05, and a
 * missing file returns a structured error rather than crashing.
 *
 * A measurement that could not be taken comes back null and is treated as a
 * FAILURE below — "we could not check" must never read as "it is fine".
 */
interface TakeMeasurement {
  durationSec: number | null;
  lufs: number | null;
  truePeakDbtp: number | null;
  transcript: string | null;
  wer: number | null;
  referenceWords: number;
  wordsPerSec: number | null;
  error?: string;
}

function measureTake(mp3Path: string, reference: string, language: string, offline: boolean): TakeMeasurement {
  const out = execFileSync("python3", [
    join(process.cwd(), "scripts/qwen_take_measure.py"),
    "--audio", mp3Path,
    "--reference", reference,
    "--language", language,
  ], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 8 * 1024 * 1024,
    ...(offline ? { env: { ...process.env, HF_HUB_OFFLINE: "1", TRANSFORMERS_OFFLINE: "1" } } : {}),
  });
  const parsed: unknown = JSON.parse(out.slice(out.indexOf("{")));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("measurement must return a JSON object");
  return parsed as TakeMeasurement;
}

interface Verdict { audioSha256: string; decision: "accept" | "reject"; verdict: string }
const sha256 = (bytes: string | Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

function unmeasured(take: Take, outDir: string): Measured {
  return { take, mp3Path: join(outDir, `${take.id}.mp3`), audioSha256: "", bytes: 0,
    durationSec: 0, wordsPerSec: 0, lufs: 0, truePeakDbtp: 0, wer: null, transcript: "",
    receipt: undefined, failures: ["not measured; existing evidence never authorizes automatic synthesis"] };
}

function reportFor(measured: Measured[], verdicts: Record<string, Verdict>, relational: string[]) {
  return {
    // Existing v1 receipt/audio rows remain readable. Verdict strings from older
    // reports are never treated as approval; a new SHA-bound verdict is required.
    contract: "qwen3-tts-qualification/v1", model: QWEN3_TTS_MODEL, revision: QWEN3_TTS_MODEL_REVISION,
    takes: measured.map((m) => ({
      id: m.take.id, speaker: m.take.speaker, language: m.take.language,
      instruction: m.take.instruction ?? null, proves: m.take.proves,
      textSha256: sha256(m.take.text), audioSha256: m.audioSha256, bytes: m.bytes,
      durationSec: Number(m.durationSec.toFixed(3)), wordsPerSec: Number(m.wordsPerSec.toFixed(3)),
      lufs: Number(m.lufs.toFixed(2)), truePeakDbtp: Number(m.truePeakDbtp.toFixed(2)),
      wer: m.wer, transcript: m.transcript.slice(0, 400), runtimeReceipt: m.receipt ?? null,
      humanVerdict: verdicts[m.take.id] ?? null, failures: m.failures,
    })),
    relationalFailures: relational,
  };
}

function saveReport(path: string, report: ReturnType<typeof reportFor>, initial = false): void {
  if (initial) { writeFileSync(path, JSON.stringify(report, null, 2), { flag: "wx" }); return; }
  const temporary = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temporary, JSON.stringify(report, null, 2), { flag: "wx" });
  renameSync(temporary, path);
}

function readRegular(path: string, maximumBytes: number): Buffer {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size <= 0 || stat.size > maximumBytes) {
    throw new Error(`retained evidence is not a bounded regular file: ${path}`);
  }
  return readFileSync(path);
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("qualification evidence must be an object");
  return value as Record<string, unknown>;
}

function loadRetained(outDir: string): Measured[] {
  const report = object(JSON.parse(readRegular(join(outDir, "qualification.json"), 2_000_000).toString("utf8")));
  if (report.contract !== "qwen3-tts-qualification/v1" || report.model !== QWEN3_TTS_MODEL || report.revision !== QWEN3_TTS_MODEL_REVISION || !Array.isArray(report.takes)) {
    throw new Error("retained qualification report does not match the current contract/model/revision");
  }
  const rows = report.takes.map(object);
  if (rows.length !== TAKES.length || new Set(rows.map((row) => row.id)).size !== TAKES.length) throw new Error("retained qualification take set differs or contains duplicates");
  return TAKES.map((take) => {
    const row = rows.find((row) => row.id === take.id);
    if (!row || row.speaker !== take.speaker || row.language !== take.language || row.instruction !== (take.instruction ?? null) || row.textSha256 !== sha256(take.text)) {
      throw new Error(`retained take ${take.id} does not match the current matrix; preserve evidence and reconcile explicitly`);
    }
    const entry = unmeasured(take, outDir);
    const audio = readRegular(entry.mp3Path, 36_000_000);
    const receipt = validateRetainedQwenTtsAudio(take, audio, row.runtimeReceipt);
    if (row.audioSha256 !== receipt.audioSha256 || row.bytes !== audio.length) throw new Error(`retained take ${take.id} audio/report binding differs`);
    return { ...entry, audioSha256: receipt.audioSha256, bytes: audio.length, receipt };
  });
}

function loadVerdicts(path: string, measured: Measured[]): Record<string, Verdict> {
  const raw = object(JSON.parse(readRegular(path, 100_000).toString("utf8")));
  if (Object.keys(raw).length !== measured.length) throw new Error("supply exactly one SHA-bound verdict per take");
  return Object.fromEntries(measured.map((m) => {
    const value = object(raw[m.take.id]);
    if (Object.keys(value).sort().join(",") !== "audioSha256,decision,verdict" || value.audioSha256 !== m.audioSha256 ||
        (value.decision !== "accept" && value.decision !== "reject") || typeof value.verdict !== "string" || !value.verdict.trim() || value.verdict.length > 2_000) {
      throw new Error(`verdict for ${m.take.id} must bind the reviewed audio SHA and contain decision accept/reject plus listening notes; legacy strings cannot approve`);
    }
    return [m.take.id, value as unknown as Verdict];
  }));
}

function assertRetainedAudioUnchanged(entry: Measured): void {
  const audio = readRegular(entry.mp3Path, 36_000_000);
  if (audio.length !== entry.bytes || sha256(audio) !== entry.audioSha256) {
    throw new Error(`retained audio changed during qualification: ${entry.take.id}; no receipt issued`);
  }
}

async function main(): Promise<void> {
  const outDir = arg("out", "/tmp/qwen-qual")!;
  const offline = process.argv.includes("--verdicts");
  const verdictsPath = arg("verdicts");
  const reportPath = join(outDir, "qualification.json");
  if (offline && (!verdictsPath || verdictsPath.startsWith("--"))) throw new Error("--verdicts requires a SHA-bound verdict file; no synthesis attempted");
  if (!offline) mkdirSync(outDir, { recursive: true });
  if (!lstatSync(outDir).isDirectory() || lstatSync(outDir).isSymbolicLink()) throw new Error("qualification output must be a regular directory");
  if (!offline && readdirSync(outDir).length) {
    throw new Error("qualification directory contains prior evidence; preserving it and refusing automatic synthesis/rebuy. Use offline --verdicts for retained takes; missing/unknown outcomes require explicit reconciliation");
  }
  const measured = offline ? loadRetained(outDir) : TAKES.map((take) => unmeasured(take, outDir));
  const verdicts = offline ? loadVerdicts(verdictsPath!, measured) : {};
  if (!offline) {
    const readiness = qwenTtsReadiness();
    if (!readiness.configured) throw new Error(`a worker URL and token are required before generation: ${readiness.blockers.join("; ")}`);
    // This existing report is evidence, NOT permission to retry or buy anything.
    // Exclusive creation also refuses concurrent first passes in the same folder.
    saveReport(reportPath, reportFor(measured, verdicts, ["qualification incomplete"]), true);
  }
  const checkpoint = () => saveReport(reportPath, reportFor(measured, verdicts, ["qualification incomplete"]));
  console.log(`qualifying ${QWEN3_TTS_MODEL} @ ${QWEN3_TTS_MODEL_REVISION}`);
  console.log(`${TAKES.length} takes -> ${outDir} (${offline ? "offline retained-audio finalization" : "first-pass generation"})\n`);

  for (const entry of measured) {
    const take = entry.take;
    process.stdout.write(`  ${take.id.padEnd(24)} `);
    if (!offline) {
      let receipt: QwenTtsReceipt | undefined;
      let bytes: Uint8Array;
      try {
        bytes = await synthQwenNarration({
          text: take.text,
          speaker: take.speaker,
          language: take.language,
          ...(take.instruction ? { instruction: take.instruction } : {}),
          onReceipt: (r) => { receipt = r; },
        });
        if (!receipt) throw new Error("the worker returned no runtime receipt");
      } catch (e) {
        console.log(`FAILED: ${e instanceof Error ? e.message.slice(0, 90) : e}`);
        entry.failures = [`synthesis failed: ${e instanceof Error ? e.message : String(e)}`];
        checkpoint();
        continue;
      }
      writeFileSync(entry.mp3Path, bytes, { flag: "wx" });
      Object.assign(entry, { receipt, audioSha256: sha256(bytes), bytes: bytes.byteLength });
      checkpoint(); // Accepted receipt + bytes survive a subsequent measurement failure.
    }
    assertRetainedAudioUnchanged(entry);
    let m: TakeMeasurement;
    try {
      m = measureTake(entry.mp3Path, take.text, take.language, offline);
    } catch (error) {
      m = { durationSec: null, lufs: null, truePeakDbtp: null, transcript: null, wer: null,
        referenceWords: 0, wordsPerSec: null, error: error instanceof Error ? error.message : String(error) };
    }
    assertRetainedAudioUnchanged(entry);
    // Malformed or non-finite local measurements cannot become a pass.
    for (const key of ["durationSec", "lufs", "truePeakDbtp", "wer", "wordsPerSec"] as const) {
      if (typeof m[key] !== "number" || !Number.isFinite(m[key])) m[key] = null;
    }
    const durationSec = m.durationSec ?? 0;
    const lufs = m.lufs ?? 0;
    const truePeakDbtp = m.truePeakDbtp ?? 0;
    const wer = m.wer;
    const transcript = m.transcript ?? "";
    const wordsPerSec = m.wordsPerSec ?? 0;

    const failures: string[] = [];
    if (m.error) failures.push(`measurement failed: ${m.error}`);
    if (durationSec <= 0 || wordsPerSec <= 0) failures.push("duration or pace was not measured as a positive finite value");
    if (m.wer === null) failures.push("word-error rate was not measured (no ASR) — unmeasured is not a pass");
    else if (m.wer > MAX_WER) failures.push(`WER ${m.wer.toFixed(3)} exceeds ${MAX_WER}`);
    if (m.lufs === null) failures.push("loudness was not measured");
    else if (m.lufs < MIN_LUFS || m.lufs > MAX_LUFS) failures.push(`loudness ${m.lufs.toFixed(1)} LUFS outside ${MIN_LUFS}..${MAX_LUFS}`);
    if (m.truePeakDbtp === null) failures.push("true peak was not measured");
    else if (m.truePeakDbtp > MAX_TRUE_PEAK_DBTP) failures.push(`true peak ${m.truePeakDbtp.toFixed(1)} dBTP above ${MAX_TRUE_PEAK_DBTP}`);
    if (m.wer !== null && m.wer < 0) failures.push("word-error rate is invalid");
    if (verdicts[take.id]?.decision === "reject") failures.push("human listening verdict rejected this exact audio");
    Object.assign(entry, { durationSec, wordsPerSec, lufs, truePeakDbtp, wer, transcript, failures });
    checkpoint();
    console.log(
      `${durationSec.toFixed(1)}s ${wordsPerSec.toFixed(2)}w/s ${lufs.toFixed(1)}LUFS ` +
      `WER=${wer === null ? "?" : wer.toFixed(3)} ${failures.length ? `FAIL(${failures.length})` : "ok"}`,
    );
  }

  // ---- instruction following, measured as a RELATION not a vibe ------------
  const calm = measured.find((m) => m.take.id === "en-aiden-calm");
  const energetic = measured.find((m) => m.take.id === "en-aiden-energetic");
  const relational: string[] = [];
  if (calm && energetic && calm.durationSec > 0 && energetic.durationSec > 0) {
    const separation = (energetic.wordsPerSec - calm.wordsPerSec) / Math.max(calm.wordsPerSec, 0.001);
    console.log(`\ninstruction following: calm ${calm.wordsPerSec.toFixed(2)} w/s vs energetic ` +
      `${energetic.wordsPerSec.toFixed(2)} w/s -> ${(separation * 100).toFixed(1)}% separation`);
    if (separation < MIN_PACE_SEPARATION) {
      relational.push(
        `the calm and energetic instructions produced only ${(separation * 100).toFixed(1)}% pace separation ` +
        `(needs >=${(MIN_PACE_SEPARATION * 100).toFixed(0)}%) — the model is not following the instruction, ` +
        `so pacing cannot be directed and every channel would narrate at one speed`,
      );
    }
  } else {
    relational.push("the calm/energetic pair did not both synthesise, so instruction following is unproven");
  }

  // ---- the human verdict is required, never defaulted ---------------------
  const missingVerdicts = measured.filter((m) => !verdicts[m.take.id]).map((m) => m.take.id);
  for (const entry of measured) if (entry.receipt) assertRetainedAudioUnchanged(entry);
  const report = reportFor(measured, verdicts, relational);
  saveReport(reportPath, report);

  const allFailures = [...measured.flatMap((m) => m.failures.map((f) => `${m.take.id}: ${f}`)), ...relational];
  console.log(`\nreport: ${reportPath}`);

  if (allFailures.length) {
    console.log(`\nNO RECEIPT — ${allFailures.length} measured failure(s):`);
    for (const f of allFailures) console.log(`  - ${f}`);
    process.exit(2);
  }
  if (missingVerdicts.length) {
    console.log(
      `\nNO RECEIPT — every take passed its measurements, but a human has not recorded a verdict for:\n` +
      missingVerdicts.map((id) => `  - ${id}  (${join(outDir, `${id}.mp3`)})`).join("\n") +
      `\n\nListen, then write ${join(outDir, "verdicts.json")} as {"take-id": {"audioSha256": "<SHA from qualification.json>", "decision": "accept or reject", "verdict": "listening notes"}}\n` +
      `and re-run with --verdicts. This validates and remeasures retained audio offline, never synthesizes it.`,
    );
    process.exit(3);
  }

  // This digest binds the retained report's measurements and verdicts. Current
  // runtime readiness checks flag/digest format only, not this report's contents.
  const sha = createHash("sha256").update(JSON.stringify(report)).digest("hex");
  console.log(`\nRECEIPT ${sha}`);
  console.log(`\nSet in the Trigger production runtime:\n` +
    `  QWEN3_TTS_QUALITY_QUALIFIED=1\n  QWEN3_TTS_QUALITY_RECEIPT_SHA256=${sha}`);
}

main().catch((e) => {
  console.error("QUALIFICATION ERROR:", e instanceof Error ? e.message : e);
  process.exit(1);
});
