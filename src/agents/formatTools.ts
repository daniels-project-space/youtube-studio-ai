/**
 * Module catalog for the STANDALONE engines — the other half of the Mastra
 * toolset (docs/MODULES_TO_MASTRA.md). blockTool.ts already exposes every
 * registered pipeline BLOCK as a Mastra tool; this exposes the standalone golden
 * FORMAT engines (documotion, loreshort, comic, whiteboard, lofi, cinematic, …)
 * the same way, so the orchestrator can see them, select the one each video
 * needs by capability, and call it with one uniform contract.
 *
 * Each engine has its own heterogeneous craft* signature; a ModuleSpec.run maps
 * the uniform { topic, runDir, outPath, … } onto that engine's real args and
 * normalises the result to { videoPath, meta }. Engines are dynamically imported
 * inside run() (resilient, lazy — heavy deps load only when actually called).
 */
import { z } from "zod";

export type ModuleKind = "format" | "ambient" | "shot-engine" | "interactive";

export interface FormatInput {
  /** The subject the video is about (topic-driven engines need only this). */
  topic: string;
  /** Working dir for intermediates + the output. */
  runDir: string;
  /** Final mp4 path. */
  outPath: string;
  /** Engine style world (e.g. documotion "archival_collage"). */
  style?: string;
  durationSec?: number;
  referenceNotes?: string;
  /** Engine-specific extras (series title, narrator, scene, music path, …). */
  brief?: Record<string, unknown>;
  log?: (m: string) => void;
}

export interface ModuleResult {
  videoPath: string;
  meta?: Record<string, unknown>;
}

export interface ModuleSpec {
  id: string;
  kind: ModuleKind;
  title: string;
  /** What it does — the orchestrator matches these against the channel's need. */
  capabilities: readonly string[];
  bestFor: string;
  /** true → a topic string is enough; false → needs richer brief input. */
  topicDriven: boolean;
  run: (input: FormatInput) => Promise<ModuleResult>;
}

export const FORMAT_INPUT = z.object({
  topic: z.string(),
  runDir: z.string(),
  outPath: z.string(),
  style: z.string().optional(),
  durationSec: z.number().optional(),
  referenceNotes: z.string().optional(),
  brief: z.record(z.string(), z.unknown()).optional(),
});
export const FORMAT_OUTPUT = z.object({ videoPath: z.string(), meta: z.record(z.string(), z.unknown()).optional() });

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "video";

export const MODULE_SPECS: ModuleSpec[] = [
  {
    id: "documotion",
    kind: "format",
    title: "Documentary motion-graphics",
    capabilities: ["documentary", "archival", "archival-collage", "history", "motion-graphics", "evidence-board", "true-crime"],
    bestFor: "history / true-crime told over archival imagery, maps and designed type cards (no stock footage)",
    topicDriven: true,
    run: async (i) => {
      const { craftDocuMotion } = await import("@/lib/documotion");
      const r = await craftDocuMotion({
        topic: i.topic, style: i.style ?? "archival_collage", referenceNotes: i.referenceNotes,
        durationSec: i.durationSec, runDir: i.runDir, outPath: i.outPath, log: i.log,
      });
      const script = (r.plan?.shots ?? []).map((s) => s.narration?.trim()).filter(Boolean).join(" ");
      return { videoPath: r.outPath, meta: { shots: r.plan?.shots?.length, rounds: r.rounds, verdict: r.verdict, script } };
    },
  },
  {
    id: "loreshort",
    kind: "format",
    title: "Lore micro-doc",
    capabilities: ["lore", "first-person", "narration", "painterly", "3d-camera", "fantasy", "history"],
    bestFor: "GoT 'Histories & Lore' — a first-person narrator over painted art with real 3D camera moves",
    topicDriven: true,
    run: async (i) => {
      const { craftLoreShort } = await import("@/lib/loreshort");
      const r = await craftLoreShort({
        slug: slugify(i.topic),
        title: (i.brief?.title as string) ?? i.topic,
        kicker: (i.brief?.kicker as string) ?? "Histories & Lore",
        topic: i.topic,
        narrator: (i.brief?.narrator as string) ?? "a measured chronicler recounting events first-hand",
        webDir: i.runDir, host: "file://" + i.runDir,
      });
      return { videoPath: r.videoPath, meta: { scenes: r.scenes?.length, durationSec: r.durationSec } };
    },
  },
  {
    id: "comic",
    kind: "format",
    title: "Motion comic (3D drawn page)",
    capabilities: ["comic", "multi-voice", "drawn", "story", "3d-page", "graphic-novel"],
    bestFor: "a narrated story drawn out as a 3D comic page that turns, every line voiced",
    topicDriven: true,
    run: async (i) => {
      const { castMotionComic } = await import("@/lib/motionComic");
      const r = await castMotionComic({
        brief: { topic: i.topic, ...(i.brief ?? {}) } as Parameters<typeof castMotionComic>[0]["brief"],
        runDir: i.runDir, outPath: i.outPath, log: i.log,
      });
      return { videoPath: r.outPath, meta: { panels: r.panels } };
    },
  },
  {
    id: "whiteboard",
    kind: "format",
    title: "Whiteboard scribe",
    capabilities: ["whiteboard", "drawn", "explainer", "hand-drawn", "narration-synced"],
    bestFor: "a narration-synced hand-drawn whiteboard explainer (drawn cinema, $0 render)",
    topicDriven: true,
    run: async (i) => {
      const { castWhiteboardSync } = await import("@/lib/whiteboardSync");
      const r = await castWhiteboardSync({
        brief: { topic: i.topic, ...(i.brief ?? {}) } as Parameters<typeof castWhiteboardSync>[0]["brief"],
        runDir: i.runDir, outPath: i.outPath, log: i.log,
      });
      return { videoPath: r.outPath, meta: { panels: r.panels?.length } };
    },
  },
  {
    id: "lofi",
    kind: "ambient",
    title: "Lofi loop",
    capabilities: ["lofi", "ambient", "music-loop", "no-narration", "study-beats", "sleep"],
    bestFor: "a long music bed under a seamless animated scene (no narration) — needs brief.music + brief.scene",
    topicDriven: false,
    run: async (i) => {
      const { craftLofi } = await import("@/lib/lofi");
      const b = i.brief ?? {};
      if (!b.music) throw new Error("lofi: brief.music (a local music file path) is required");
      const r = await craftLofi({
        slug: (b.slug as string) ?? slugify(i.topic),
        scene: (b.scene as string) ?? "beachcafe",
        channel: (b.channel as string) ?? i.topic,
        title: (b.title as string) ?? i.topic,
        music: b.music as string,
        durationSec: i.durationSec,
        webDir: i.runDir, host: "file://" + i.runDir,
      });
      return { videoPath: r.videoPath, meta: { scene: r.scene, durationSec: r.durationSec } };
    },
  },
  {
    id: "cinematic",
    kind: "shot-engine",
    title: "Cinematic AI scenes",
    capabilities: ["cinematic", "ai-scenes", "character-consistency", "crime", "heist", "produced"],
    bestFor: "fully-produced multi-scene cinematic shots — a SHOT engine (needs subjects + shots from a planner, not a one-call topic→video)",
    topicDriven: false,
    run: async () => {
      throw new Error(
        "cinematic is a multi-step shot engine: extractCast(brief) → buildShotScript → craftCinematicShots(subjects, shots), then assemble. Not a single topic→video call.",
      );
    },
  },
];

/** The catalog the orchestrator reads (no run fn — just the cards). */
export function listModules() {
  return MODULE_SPECS.map(({ run: _run, ...card }) => card);
}
export function getModule(id: string): ModuleSpec | undefined {
  return MODULE_SPECS.find((m) => m.id === id);
}

/**
 * Pick the best format module for a need, by capability overlap (the
 * orchestrator's selection step). Returns undefined if nothing fits.
 */
export function selectModule(need: string): ModuleSpec | undefined {
  const t = need.toLowerCase();
  let best: ModuleSpec | undefined;
  let bestScore = 0;
  for (const m of MODULE_SPECS) {
    let score = m.id.split("-").some((w) => t.includes(w)) || t.includes(m.id) ? 3 : 0;
    for (const c of m.capabilities) if (c.split("-").some((w) => w.length > 3 && t.includes(w))) score++;
    if (score > bestScore) { bestScore = score; best = m; }
  }
  return best;
}

/** ModuleSpec → Mastra createTool (so the orchestrator invokes engines as tools). */
export async function moduleTool(spec: ModuleSpec) {
  const { createTool } = await import("@mastra/core/tools");
  return createTool({
    id: spec.id,
    description: `${spec.title} — ${spec.bestFor}. Capabilities: ${spec.capabilities.join(", ")}.`,
    inputSchema: FORMAT_INPUT,
    outputSchema: FORMAT_OUTPUT,
    execute: async (input: FormatInput) => spec.run(input),
  });
}
