/**
 * VIDEO QUALITY ASSESSMENT — the multi-modal gate that WATCHES and LISTENS.
 *
 * Cheapest-first: deterministic meters (loudness / true-peak / resolution /
 * duration) → ASR intelligibility (transcribe the FINAL mix, recover the script)
 * → a multimodal LLM judge that grades sampled frames + the transcript + the
 * meter readout against the channel rubric AND the certified golden reference
 * for the format. Produces a per-dimension report and a hard gate.
 *
 * This is the engine-agnostic assessor; a format engine may pass `engineMeters`
 * it already measured (e.g. documotion's precise dialogue-lead) to enrich it.
 */
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { parseJsonLoose } from "@/lib/gemini";
import { visionLocal } from "@/lib/vision";
import { type ChannelQualitySpec, type QualityDimension, goldenReference, NARRATIVE_CRAFT, hardGates } from "./rubric";

type Logger = (m: string) => void;
const ffmpegBin = () => process.env.FFMPEG_BIN || "ffmpeg";
const ffprobeBin = () => process.env.FFPROBE_BIN || "ffprobe";

function cap(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    p.stdout.on("data", (d) => (out += String(d)));
    p.stderr.on("data", (d) => (out += String(d)));
    p.on("close", () => resolve(out));
    p.on("error", () => resolve(out));
  });
}

export interface QualityMeters {
  lufs: number | null;
  truePeakDb: number | null;
  durationSec: number;
  width: number;
  height: number;
  wpm: number | null;
  wordRecall: number | null; // fraction 0–1 of script words recovered by ASR
  dialogueLeadDb: number | null; // VO vs bed (engine-supplied or null)
}

export interface DimensionResult {
  dimension: QualityDimension;
  score: number; // 1–10
  pass: boolean;
  hardGate: boolean;
  defects: string[];
}

export interface QualityReport {
  format: string;
  meters: QualityMeters;
  dimensions: DimensionResult[];
  overall: number; // weighted 1–10
  gatePass: boolean; // every hard-gate dimension passed
  blocking: string[]; // failing hard-gate dimensions
  defects: string[]; // flat list of every defect, worst-first
  summary: string;
}

async function probeTech(videoPath: string): Promise<{ durationSec: number; width: number; height: number }> {
  const out = await cap(ffprobeBin(), ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-show_entries", "format=duration", "-of", "json", videoPath]);
  try {
    const j = JSON.parse(out) as { streams?: { width: number; height: number }[]; format?: { duration: string } };
    return { durationSec: parseFloat(j.format?.duration ?? "0"), width: j.streams?.[0]?.width ?? 0, height: j.streams?.[0]?.height ?? 0 };
  } catch {
    return { durationSec: 0, width: 0, height: 0 };
  }
}

async function probeLoudness(videoPath: string): Promise<{ lufs: number | null; truePeakDb: number | null }> {
  const out = await cap(ffmpegBin(), ["-i", videoPath, "-af", "ebur128=peak=true", "-f", "null", "-"]);
  const iMatches = [...out.matchAll(/I:\s*(-?\d+(?:\.\d+)?)\s*LUFS/g)];
  const pMatches = [...out.matchAll(/Peak:\s*(-?\d+(?:\.\d+)?)\s*dBFS/g)];
  return {
    lufs: iMatches.length ? parseFloat(iMatches[iMatches.length - 1][1]) : null,
    truePeakDb: pMatches.length ? parseFloat(pMatches[pMatches.length - 1][1]) : null,
  };
}

/** Sample N evenly-spaced frames across the timeline → jpg paths. */
async function sampleFrames(videoPath: string, durationSec: number, n: number, dir: string): Promise<string[]> {
  await mkdir(dir, { recursive: true });
  const paths: string[] = [];
  for (let i = 0; i < n; i++) {
    const t = durationSec * ((i + 0.5) / n);
    const out = join(dir, `qa_frame_${i}.jpg`);
    await new Promise<void>((resolve) => {
      const p = spawn(ffmpegBin(), ["-y", "-ss", t.toFixed(2), "-i", videoPath, "-frames:v", "1", "-vf", "scale=960:-1", "-q:v", "3", out], { stdio: "ignore" });
      p.on("close", () => resolve());
      p.on("error", () => resolve());
    });
    paths.push(out);
  }
  return paths;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);

/** ASR round-trip (best-effort): transcribe the final mix, recover the script. */
async function asrRecall(videoPath: string, script: string, log?: Logger): Promise<{ wordRecall: number | null; wpm: number | null }> {
  try {
    const { hasAssemblyKey, transcribeWords } = await import("@/lib/assemblyai");
    if (!hasAssemblyKey()) return { wordRecall: null, wpm: null };
    const words = await transcribeWords(videoPath);
    if (!words?.length) return { wordRecall: null, wpm: null };
    const heard = new Set(norm(words.map((w) => w.text).join(" ")));
    const want = norm(script);
    const hit = want.filter((w) => heard.has(w)).length;
    const wordRecall = want.length ? hit / want.length : null;
    const spanSec = (words[words.length - 1].end - words[0].start) / 1000;
    const wpm = spanSec > 1 ? Math.round((words.length / spanSec) * 60) : null;
    log?.(`quality: ASR recall ${wordRecall !== null ? (wordRecall * 100).toFixed(0) + "%" : "n/a"}, ${wpm ?? "?"} wpm`);
    return { wordRecall, wpm };
  } catch {
    return { wordRecall: null, wpm: null };
  }
}

interface JudgeOut {
  scores?: Partial<Record<QualityDimension, number>>;
  defects?: { dimension: QualityDimension; issue: string }[];
  summary?: string;
}

/** The multimodal judge — frames + transcript + meters, graded vs rubric + golden. */
async function judge(args: { frames: string[]; script?: string; meters: QualityMeters; spec: ChannelQualitySpec; log?: Logger }): Promise<JudgeOut> {
  const g = goldenReference(args.spec.format);
  const dimList = (Object.keys(args.spec.dims) as QualityDimension[]).filter((d) => args.spec.dims[d].weight > 0);
  const m = args.meters;
  const meterLine = `loudness ${m.lufs ?? "?"} LUFS, true-peak ${m.truePeakDb ?? "?"} dBFS, ${m.durationSec.toFixed(0)}s, ${m.width}x${m.height}, pace ${m.wpm ?? "?"} wpm, ASR-recall ${m.wordRecall !== null ? (m.wordRecall * 100).toFixed(0) + "%" : "n/a"}, dialogue-lead ${m.dialogueLeadDb ?? "n/a"} dB`;
  const prompt =
    `You are the QUALITY CRITIC for a "${args.spec.format}" video channel. The frames below are sampled in order across the whole video. ` +
    `Grade it HONESTLY and STRICTLY against the channel's bar — most amateur output should score 4-6; reserve 8-10 for genuinely broadcast-grade work.\n\n` +
    (g ? `GOLDEN REFERENCE (what an EXEMPLARY "${args.spec.format}" looks like — grade against THIS standard):\n${g.title}: ${g.how}\nIts quality gates: ${g.gates.join("; ")}\n\n` : "") +
    `NARRATIVE CRAFT the channel must honour:\n${NARRATIVE_CRAFT}\n\n` +
    (args.spec.houseStandards ? `THIS CHANNEL'S HOUSE STANDARDS: ${args.spec.houseStandards}\n\n` : "") +
    `MEASURED (trust these for audio/technical): ${meterLine}\n\n` +
    (args.script ? `NARRATION SCRIPT (the video must convey THIS, and the visuals must SHOW it): "${args.script.slice(0, 1500)}"\n\n` : "") +
    `Score EACH dimension 1-10 and list concrete DEFECTS (what's wrong + which shot/moment), worst first:\n` +
    dimList.map((d) => `- ${d}: ${dimDesc(d)}`).join("\n") +
    `\n\nReturn STRICT JSON {"scores":{${dimList.map((d) => `"${d}":n`).join(",")}},"defects":[{"dimension":"...","issue":"<=18 words"}],"summary":"<=25 words"}.`;
  const raw = await visionLocal({ prompt, imagePaths: args.frames, json: true, maxTokens: 1500 }).catch(() => "");
  if (!raw) return {};
  try {
    return parseJsonLoose<JudgeOut>(raw);
  } catch {
    args.log?.("quality: judge returned unparseable JSON — scoring perceptual dims neutral");
    return {};
  }
}

function dimDesc(d: QualityDimension): string {
  switch (d) {
    case "audio_dialogue": return "is the narration clearly audible and the FOREGROUND (not buried under music)?";
    case "audio_mix": return "loudness/clarity, music level appropriate, no pumping or clipping?";
    case "text_legibility": return "on-screen text readable, clear of faces, correctly spelled?";
    case "production_value": return "depth/motion/layering/richness — does each shot feel finished, not flat or thin?";
    case "narrative": return "strong hook in the first seconds, clear arc, a real payoff; factual; no filler?";
    case "brand_fit": return "palette, typography, voice and pacing consistent with the channel's world?";
    case "coherence": return "does each shot SHOW what the line being spoken says?";
  }
}

/** Assess a finished video against a channel rubric. Engine-agnostic. */
export async function assessVideo(args: {
  videoPath: string;
  script?: string;
  spec: ChannelQualitySpec;
  /** Meters the engine already measured (merged + trusted over re-measuring). */
  engineMeters?: Partial<QualityMeters>;
  nFrames?: number;
  framesDir?: string;
  log?: Logger;
}): Promise<QualityReport> {
  const log = args.log ?? (() => {});
  const spec = args.spec;

  const tech = await probeTech(args.videoPath);
  const loud = await probeLoudness(args.videoPath);
  const asr = args.script ? await asrRecall(args.videoPath, args.script, log) : { wordRecall: null, wpm: null };
  const meters: QualityMeters = {
    lufs: loud.lufs,
    truePeakDb: loud.truePeakDb,
    durationSec: tech.durationSec,
    width: tech.width,
    height: tech.height,
    wpm: asr.wpm,
    wordRecall: asr.wordRecall,
    dialogueLeadDb: null,
    ...args.engineMeters,
  };

  const frames = await sampleFrames(args.videoPath, tech.durationSec || 1, args.nFrames ?? 6, args.framesDir ?? join(process.cwd(), ".qa-frames"));
  const j = await judge({ frames, script: args.script, meters, spec, log });

  // ---- combine deterministic checks + judge into per-dimension results ----
  const results: DimensionResult[] = (Object.keys(spec.dims) as QualityDimension[]).map((dim) => {
    const ds = spec.dims[dim];
    const defects: string[] = [];
    let score = j.scores?.[dim] ?? 6;
    (j.defects ?? []).filter((x) => x.dimension === dim).forEach((x) => defects.push(x.issue));

    // deterministic overrides — meters beat the model for objective facts
    if (dim === "audio_mix") {
      if (meters.lufs !== null && Math.abs(meters.lufs - spec.audio.targetLufs) > 3) { score = Math.min(score, 5); defects.push(`loudness ${meters.lufs} LUFS off target ${spec.audio.targetLufs}`); }
      if (meters.truePeakDb !== null && meters.truePeakDb > spec.audio.truePeakCeilingDb + 0.5) { score = Math.min(score, 4); defects.push(`true peak ${meters.truePeakDb} dBFS over ceiling (clipping risk)`); }
    }
    if (dim === "audio_dialogue") {
      if (meters.dialogueLeadDb !== null && meters.dialogueLeadDb < spec.audio.minDialogueLeadDb) { score = Math.min(score, 3); defects.push(`narration buried — only ${meters.dialogueLeadDb} dB above the bed (need ${spec.audio.minDialogueLeadDb})`); }
      if (meters.wordRecall !== null && meters.wordRecall < 0.8) { score = Math.min(score, 4); defects.push(`only ${(meters.wordRecall * 100).toFixed(0)}% of the script is intelligible (ASR)`); }
      if (meters.wpm !== null && (meters.wpm < spec.audio.wpm[0] || meters.wpm > spec.audio.wpm[1])) { score = Math.min(score, 6); defects.push(`pace ${meters.wpm} wpm outside ${spec.audio.wpm[0]}–${spec.audio.wpm[1]}`); }
    }
    if (dim === "production_value" || dim === "text_legibility") {
      if (meters.width < spec.technical.minWidth || meters.height < spec.technical.minHeight) { score = Math.min(score, 4); defects.push(`resolution ${meters.width}x${meters.height} below ${spec.technical.minWidth}x${spec.technical.minHeight}`); }
    }

    return { dimension: dim, score, pass: score >= ds.floor, hardGate: ds.hardGate, defects };
  });

  const active = results.filter((r) => spec.dims[r.dimension].weight > 0);
  const totalW = active.reduce((a, r) => a + spec.dims[r.dimension].weight, 0) || 1;
  const overall = active.reduce((a, r) => a + r.score * spec.dims[r.dimension].weight, 0) / totalW;
  const gates = hardGates(spec);
  const blocking = results.filter((r) => r.hardGate && gates.includes(r.dimension) && !r.pass).map((r) => r.dimension);
  const defects = results.flatMap((r) => r.defects.map((d) => `[${r.dimension}] ${d}`));
  const gatePass = blocking.length === 0;
  const summary = j.summary ?? `${gatePass ? "PASS" : "BLOCKED"} — overall ${overall.toFixed(1)}/10`;

  log(`quality ASSESS [${spec.format}]: overall ${overall.toFixed(1)}/10, ${gatePass ? "GATE PASS" : `BLOCKED on ${blocking.join(", ")}`} — ${active.map((r) => `${r.dimension.replace(/_/g, "")[0]}${r.dimension.split("_")[1]?.[0] ?? ""}:${r.score}`).join(" ")}`);
  return { format: spec.format, meters, dimensions: results, overall, gatePass, blocking, defects, summary };
}
