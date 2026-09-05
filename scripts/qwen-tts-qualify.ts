/**
 * QWEN3-TTS QUALIFICATION BENCHMARK — the thing that produces the receipt.
 *
 * docs/QWEN3_TTS_QUALIFICATION.md specifies four production variables, one of
 * which is `QWEN3_TTS_QUALITY_RECEIPT_SHA256=<64 lowercase hex>`, and says the
 * hash "must come from a reviewed benchmark of the exact worker/model
 * revision". Nothing implemented that benchmark. The gate was therefore
 * operable only by someone inventing a hash, which is precisely what the gate
 * exists to prevent — and the doc's own status note says no receipt was
 * manufactured, correctly.
 *
 * This runs the matrix the doc requires against a live worker, measures every
 * take, and either prints a receipt or refuses with reasons. It cannot be made
 * to emit a receipt for audio it did not measure:
 *
 *   - the hash is taken over the measurements themselves, so editing a verdict
 *     changes the hash and the gate rejects it;
 *   - every axis has a threshold, and a single failure suppresses the receipt;
 *   - the human verdict is a required input, not a default. The doc asks for a
 *     "human register/performance verdict" and no measurement substitutes for
 *     listening, so this writes the MP3s to disk and refuses to proceed until
 *     the operator has recorded a verdict per take.
 *
 * WHAT IT COSTS. Every take is a real GPU call on the attested worker. The
 * matrix below is 6 takes. Run it with the worker already warm.
 *
 * Usage:
 *   ai-vault <service> QWEN3_TTS_WORKER_TOKEN=QWEN3_TTS_WORKER_TOKEN -- \
 *     QWEN3_TTS_WORKER_URL=https://... \
 *     ./node_modules/.bin/tsx scripts/qwen-tts-qualify.ts --out /tmp/qwen-qual
 *
 *   # listen to /tmp/qwen-qual/*.mp3, then record verdicts and re-run:
 *   ./node_modules/.bin/tsx scripts/qwen-tts-qualify.ts --out /tmp/qwen-qual --verdicts /tmp/qwen-qual/verdicts.json
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

import {
  QWEN3_TTS_MODEL,
  QWEN3_TTS_MODEL_REVISION,
  qwenTtsReadiness,
  synthQwenNarration,
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

function measureTake(mp3Path: string, reference: string, language: string): TakeMeasurement {
  const out = execFileSync("python3", [
    join(process.cwd(), "scripts/qwen_take_measure.py"),
    "--audio", mp3Path,
    "--reference", reference,
    "--language", language,
  ], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 8 * 1024 * 1024 });
  return JSON.parse(out.slice(out.indexOf("{"))) as TakeMeasurement;
}

async function main(): Promise<void> {
  const outDir = arg("out", "/tmp/qwen-qual")!;
  const verdictsPath = arg("verdicts");
  mkdirSync(outDir, { recursive: true });

  const readiness = qwenTtsReadiness();
  if (!readiness.configured) {
    console.error("A worker URL and token are required before any take can be made:");
    for (const b of readiness.blockers) console.error(`  - ${b}`);
    process.exit(1);
  }
  console.log(`qualifying ${QWEN3_TTS_MODEL} @ ${QWEN3_TTS_MODEL_REVISION}`);
  console.log(`${TAKES.length} takes -> ${outDir}\n`);

  const measured: Measured[] = [];
  for (const take of TAKES) {
    process.stdout.write(`  ${take.id.padEnd(24)} `);
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
    } catch (e) {
      console.log(`FAILED: ${e instanceof Error ? e.message.slice(0, 90) : e}`);
      measured.push({
        take, mp3Path: "", audioSha256: "", bytes: 0, durationSec: 0, wordsPerSec: 0,
        lufs: 0, truePeakDbtp: 0, wer: null, transcript: "", receipt: undefined,
        failures: [`synthesis failed: ${e instanceof Error ? e.message : String(e)}`],
      });
      continue;
    }
    const mp3Path = join(outDir, `${take.id}.mp3`);
    writeFileSync(mp3Path, bytes);
    const audioSha256 = createHash("sha256").update(bytes).digest("hex");
    const m = measureTake(mp3Path, take.text, take.language);
    const durationSec = m.durationSec ?? 0;
    const lufs = m.lufs ?? 0;
    const truePeakDbtp = m.truePeakDbtp ?? 0;
    const wer = m.wer;
    const transcript = m.transcript ?? "";
    const wordsPerSec = m.wordsPerSec ?? 0;

    const failures: string[] = [];
    if (m.error) failures.push(`measurement failed: ${m.error}`);
    if (m.wer === null) failures.push("word-error rate was not measured (no ASR) — unmeasured is not a pass");
    else if (m.wer > MAX_WER) failures.push(`WER ${m.wer.toFixed(3)} exceeds ${MAX_WER}`);
    if (m.lufs === null) failures.push("loudness was not measured");
    else if (m.lufs < MIN_LUFS || m.lufs > MAX_LUFS) failures.push(`loudness ${m.lufs.toFixed(1)} LUFS outside ${MIN_LUFS}..${MAX_LUFS}`);
    if (m.truePeakDbtp === null) failures.push("true peak was not measured");
    else if (m.truePeakDbtp > MAX_TRUE_PEAK_DBTP) failures.push(`true peak ${m.truePeakDbtp.toFixed(1)} dBTP above ${MAX_TRUE_PEAK_DBTP}`);
    if (!receipt) failures.push("the worker returned no runtime receipt");

    measured.push({ take, mp3Path, audioSha256, bytes: bytes.byteLength, durationSec, wordsPerSec, lufs, truePeakDbtp, wer, transcript, receipt, failures });
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
  const verdicts: Record<string, string> = verdictsPath && existsSync(verdictsPath)
    ? JSON.parse(readFileSync(verdictsPath, "utf8"))
    : {};
  const missingVerdicts = measured.filter((m) => !verdicts[m.take.id]?.trim()).map((m) => m.take.id);

  const report = {
    contract: "qwen3-tts-qualification/v1",
    model: QWEN3_TTS_MODEL,
    revision: QWEN3_TTS_MODEL_REVISION,
    takes: measured.map((m) => ({
      id: m.take.id, speaker: m.take.speaker, language: m.take.language,
      instruction: m.take.instruction ?? null, proves: m.take.proves,
      textSha256: createHash("sha256").update(m.take.text).digest("hex"),
      audioSha256: m.audioSha256, bytes: m.bytes,
      durationSec: Number(m.durationSec.toFixed(3)),
      wordsPerSec: Number(m.wordsPerSec.toFixed(3)),
      lufs: Number(m.lufs.toFixed(2)), truePeakDbtp: Number(m.truePeakDbtp.toFixed(2)),
      wer: m.wer, transcript: m.transcript.slice(0, 400),
      runtimeReceipt: m.receipt ?? null,
      humanVerdict: verdicts[m.take.id] ?? null,
      failures: m.failures,
    })),
    relationalFailures: relational,
  };
  const reportPath = join(outDir, "qualification.json");
  writeFileSync(reportPath, JSON.stringify(report, null, 2));

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
      `\n\nListen to them, then write ${join(outDir, "verdicts.json")} as {"take-id": "your verdict"} and re-run\n` +
      `with --verdicts. No measurement replaces listening, and the doc requires a register/performance verdict.`,
    );
    process.exit(3);
  }

  // The hash covers the measurements AND the verdicts, so neither can be edited
  // after the fact without invalidating the receipt the runtime checks.
  const sha = createHash("sha256").update(JSON.stringify(report)).digest("hex");
  console.log(`\nRECEIPT ${sha}`);
  console.log(`\nSet in the Trigger production runtime:\n` +
    `  QWEN3_TTS_QUALITY_QUALIFIED=1\n  QWEN3_TTS_QUALITY_RECEIPT_SHA256=${sha}`);
}

main().catch((e) => {
  console.error("QUALIFICATION ERROR:", e instanceof Error ? e.message : e);
  process.exit(1);
});
