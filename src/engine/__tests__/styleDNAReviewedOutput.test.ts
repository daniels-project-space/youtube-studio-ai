import assert from "node:assert/strict";
import { synthStyleDNA, type StyleDNADraft } from "@/engine/creative/styleDNA";

const draft: StyleDNADraft = {
  palette: ["#102030", "#203040", "#304050", "#405060", "#506070", "#607080", "#708090"],
  recurringSubject: "  a night botanist cataloguing luminous seedlings  ",
  setting: "  a rain-lit glasshouse with labelled seed trays  ",
  composition: "seedling close-up, botanist behind the glass",
  colorGrade: "emerald foliage against warm brass lamps",
  motifs: Array.from({ length: 10 }, (_, i) => `  numbered seed tray ${i + 1}  `),
  variationAxes: Array.from({ length: 8 }, (_, i) => `growth stage ${i + 1}`),
  motionVocabulary: ["  rain tracing glass panes  "],
  motionDiscipline: "locked tripod, rain and leaf movement only",
  visualAvoid: ["unmotivated cuts away from the seed trays"],
  thumbnail: {
    composition: "one luminous seedling beside a brass label",
    textRule: "two words",
    palette: ["#102030", "#203040", "#304050", "#405060", "#506070", "#607080"],
    subject: "the labelled seedling",
  },
  audio: {
    role: "primary_music",
    genre: "  slow glass-piano minimalism  ",
    bpmMin: 30,
    bpmMax: 35,
    instrumentation: Array.from({ length: 10 }, (_, i) => `piano register ${i + 1}`),
    textures: ["  close glasshouse room tone  "],
    moodArc: "patient curiosity settling into reassurance",
    loudnessLufs: -18,
    bodyMusicVol: 0.25,
    loopable: true,
  },
  seo: {
    titleFormula: "  [seedling] under winter rain  ",
    descriptionStructure: "plant detail followed by session setting",
    playlistStrategy: "group sessions by botanical season",
  },
};

async function main(): Promise<void> {
  const previousFetch = globalThis.fetch;
  const previousKey = process.env.OPENROUTER_API_KEY;
  let reviewed: StyleDNADraft | undefined;
  let calls = 0;
  process.env.OPENROUTER_API_KEY = "fixture-only-never-sent";
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), "https://openrouter.ai/api/v1/chat/completions");
    const body = JSON.parse(String(init?.body));
    const prompt = String(body.messages.at(-1)?.content);
    const critic = prompt.includes("Audit this channel's STYLE DNA");
    if (critic) {
      reviewed = JSON.parse(prompt.split("DNA DRAFT:\n")[1]!.split("\n\nScore 0..1")[0]!) as StyleDNADraft;
    }
    calls++;
    return Response.json({
      id: `style-dna-${calls}`, model: body.model,
      choices: [{ message: { content: JSON.stringify(critic ? { score: 0.95, issues: [] } : draft) } }],
      usage: { prompt_tokens: 100, completion_tokens: 40, total_tokens: 140, cost: 0.001 },
    });
  };
  try {
    const result = await synthStyleDNA({
      family: "music_loop", name: "The Slow Glasshouse", now: 42,
      competitorTitles: ["Piano under winter rain", "Night greenhouse listening"],
    });
    assert.equal(calls, 2, "a valid identity needs one generation and one independent review");
    assert.deepEqual(result.audio.bpmRange, [30, 35], "persistence must preserve the reviewed tempo without inverting it");
    assert.ok(reviewed);
    for (const field of ["palette", "recurringSubject", "setting", "motifs", "variationAxes", "motionVocabulary", "thumbnail", "seo"] as const) {
      assert.deepEqual(result[field], reviewed[field], `${field} must be reviewed in its persisted form`);
    }
    assert.deepEqual(result.audio.instrumentation, reviewed.audio.instrumentation);
    assert.equal(result.audio.genre, reviewed.audio.genre);
    assert.equal(result.audio.moodArc, reviewed.audio.moodArc);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = previousKey;
  }
  console.log("STYLE DNA REVIEWED OUTPUT PASS: persisted identity matches its independent review");
}

void main().catch((error) => { console.error(error); process.exitCode = 1; });
