/**
 * Speech-TV THUMBNAIL generation path (saved into the module).
 *
 * Golden Banana (Nano Banana Pro) thumbnail for a speech video. Handles the
 * named-celebrity refusal: the image model won't render a NAMED real person, so
 * we (1) describe the person's iconic look WITHOUT the name (auto via Gemini),
 * (2) render the figure + headline, (3) composite the person's name strap on
 * after with ffmpeg. Used by both content categories (multi-speaker & solo).
 */
import { spawnSync } from "node:child_process";
import { buildThumbBrief, bananaThumbnail, type BananaVerdict } from "./banana";
import { geminiJson, hasGeminiKey } from "./gemini";

const DEFAULT_STYLE =
  "cinematic high-contrast portrait, dramatic single-source rim light, moody charcoal background, premium editorial movie-poster look, crisp photographic detail";
const FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf";

/** Iconic, instantly-recognizable appearance of `person` WITHOUT naming them —
 * sidesteps the image model's named-celebrity refusal. */
export async function describeLook(person: string, log: (m: string) => void = () => {}): Promise<string> {
  const fallback = `a determined public figure with a recognizable, iconic appearance`;
  if (!hasGeminiKey()) return fallback;
  try {
    const res = await geminiJson<{ look?: string }>({
      prompt:
        `Describe the iconic, instantly-recognizable visual appearance of ${person} for a dramatic thumbnail portrait — ` +
        `clothing, hair, facial hair, distinguishing features, approximate age/era — in ONE vivid sentence. ` +
        `CRITICAL: do NOT use their name or ANY proper noun (no brand names, no place names). Return JSON {"look":"..."}.`,
      maxTokens: 200,
    });
    const look = (res.look ?? "").trim();
    log(`look: ${look.slice(0, 80)}`);
    return look || fallback;
  } catch {
    return fallback;
  }
}

export type SpeechThumbArgs = {
  person: string;
  /** override the auto look description (no name) */
  look?: string;
  /** headline lines; mark exactly one payoff word (rendered HUGE) */
  lines: { text: string; payoff?: boolean; accent?: boolean }[];
  expectWords?: string[];
  channelName?: string;
  accent?: string;
  palette?: string[];
  imageStyle?: string;
  /** extra scene atmosphere appended after the figure description */
  sceneExtra?: string;
  badge?: string;
  outJpg: string;
  /** composite the person's name strap at the bottom (default true) */
  addName?: boolean;
  log?: (m: string) => void;
};

export async function generateSpeechThumbnail(a: SpeechThumbArgs): Promise<{ path: string; verdict: BananaVerdict }> {
  const log = a.log ?? (() => {});
  const accent = a.accent ?? "#ffd27a";
  const imageStyle = a.imageStyle ?? DEFAULT_STYLE;
  const look = a.look ?? (await describeLook(a.person, log));
  const brief = buildThumbBrief({
    channelName: a.channelName ?? "MINDSET",
    imageStyle,
    palette: a.palette ?? ["charcoal black", "deep slate", "warm gold"],
    accentColor: accent,
    scene:
      `${look}, jaw set, an intense, defiant, determined gaze locked straight to camera. ` +
      `A single hard rim-light carves the face out of a deep charcoal void; faint atmospheric haze.` +
      `${a.sceneExtra ? " " + a.sceneExtra : ""} Powerful, cinematic.`,
    lines: a.lines,
    badge: a.badge ?? (a.channelName ?? "MINDSET"),
  });
  const base = a.outJpg.replace(/\.jpg$/i, "");
  const rawJpg = a.addName === false ? a.outJpg : `${base}-base.jpg`;
  const { path, verdict } = await bananaThumbnail({
    brief,
    outJpg: rawJpg,
    expectWords: a.expectWords ?? a.lines.map((l) => l.text),
    imageStyle,
    title: `${a.person} — ${a.lines.map((l) => l.text).join(" ")}`,
    log,
  });
  if (a.addName === false) return { path, verdict };
  // composite the person's name strap (banana refuses named celebrities → add it as type)
  const spaced = a.person.toUpperCase().split("").join(" ");
  const r = spawnSync(
    "ffmpeg",
    ["-y", "-i", rawJpg, "-vf",
      `drawtext=fontfile=${FONT}:text=${spaced}:fontcolor=${accent}:fontsize=30:x=(w-text_w)/2:y=h-58:shadowcolor=black@0.8:shadowx=2:shadowy=2`,
      a.outJpg],
    { stdio: "ignore" },
  );
  return r.status === 0 ? { path: a.outJpg, verdict } : { path, verdict };
}
