// GOLDEN EIGHT: eight imaginary channels rendered to the samurai standard —
// full lab path (references -> distill -> recraft one-pass -> 8 vision dims).
// Every DNA is art-directed: story-enacting subject, locked palette, one accent.
// ONLY env accepts a comma list of keys for parallel split runs.
import { acquireReferences, verifyReferences, distillPlaybook, renderCandidate } from "../src/lib/thumbnailLab.ts";
import { bootstrapSecrets } from "../src/lib/bootstrap.ts";
import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

await bootstrapSecrets(() => {}, { required: ["FAL_KEY", "GEMINI_API_KEY"] });
const tmp = join(tmpdir(), "golden-eight");
mkdirSync(tmp, { recursive: true });
const log = (m) => console.log(`  ${m}`);

const JOBS = [
  {
    key: "stoic2",
    name: "Marble Mind",
    niche: "Stoicism / Philosophy",
    title: "How Stoics Defeat Anxiety",
    vlOverride: { font: "impact", treatment: "clean", textObject: "paint_smear" },
    positioning: "cinematic stoic philosophy told through living marble statues — calm guidance for anxious modern minds",
    dna: {
      recurringSubject: "Two classical marble statues in deeply human moments — one laying a steadying hand on the shoulder of another whose form is cracking. Stoic comfort made literal, never abstract.",
      setting: "black void studio, one warm key light raking across marble",
      colorGrade: "monochrome marble white on deep black with ONE warm gold light accent",
      palette: ["#0b0b0d", "#e8e6e1", "#d4a017"],
      thumbnail: { subject: "a serene stoic statue placing a firm comforting hand on the shoulder of a second statue whose chest is cracking with glowing fissures — anxiety being steadied, the story readable without text", palette: ["#0b0b0d", "#e8e6e1", "#d4a017"] },
      visualAvoid: ["random dust or glow with no story", "abstract particles", "modern objects", "steampunk"],
    },
  },
  {
    key: "samurai2",
    name: "Steel & Silk",
    niche: "Japanese History",
    title: "The Night Kyoto Burned",
    positioning: "bold sumi-e storyteller of samurai legends — each episode one fateful night in feudal Japan",
    dna: {
      recurringSubject: "A lone samurai in heavy expressive ink brush strokes against a giant red sun disc, embers riding the wind",
      setting: "textured washi paper, vast white negative space, controlled ink splatter at the edges",
      colorGrade: "ink black on warm paper white with ONE crimson accent (sun, banner, blood)",
      palette: ["#f4ead8", "#191512", "#c1272d"],
      thumbnail: { subject: "a samurai standing before a burning city skyline rendered in ink wash, immense red sun disc behind him, embers streaking across the paper", palette: ["#f4ead8", "#191512", "#c1272d"] },
      visualAvoid: ["photorealism", "anime cel shading", "neon", "modern objects"],
    },
  },
  {
    key: "hannibal",
    name: "Empires at War",
    niche: "Ancient History",
    title: "Hannibal's March That Nearly Killed Rome",
    positioning: "epic cinematic retellings of antiquity's greatest military gambles — oil-painting scale drama",
    dna: {
      recurringSubject: "Armies and war beasts at impossible epic scale in dramatic oil-painting battle scenes",
      setting: "snowbound Alpine passes, storm light, bronze armor glinting through blizzard",
      colorGrade: "epic classical oil painting; steel-blue snow with bronze and blood-red banner accents",
      palette: ["#1d2c3f", "#e9eef4", "#b3541e"],
      thumbnail: { subject: "Hannibal atop a towering war elephant cresting a snowy alpine ridge in a storm, his army snaking into the valley below, the distant glow of Rome on the horizon", palette: ["#1d2c3f", "#e9eef4", "#b3541e"] },
      visualAvoid: ["photoreal stock", "cartoon", "fantasy armor"],
    },
  },
  {
    key: "drawn",
    name: "The Drawn Past",
    niche: "History",
    title: "The Plague That Made People Dance",
    positioning: "calm curious educator who sketches history into life — hand-drawn whiteboard explainers",
    dna: {
      recurringSubject: "A single ink-stained hand sketching crosshatched historical figures and scenes, drawings alive stroke by stroke",
      setting: "bright whiteboard canvas, warm paper-cream tones, sepia ink linework, burnt-orange accent used sparingly",
      colorGrade: "warm paper-white, sepia/charcoal ink, burnt-orange accent — hand-drawn editorial illustration, never photoreal",
      palette: ["#f5efe0", "#2b2620", "#c45a1d"],
      thumbnail: { subject: "dramatic hand-drawn crosshatch illustration of medieval townsfolk dancing uncontrollably in a town square, faces exhausted and frightened, an artist's hand visible mid-sketch", palette: ["#f5efe0", "#2b2620", "#c45a1d"] },
      visualAvoid: ["photorealism", "stock photography", "modern objects", "neon"],
    },
  },
  {
    key: "pirates",
    name: "The Last Reel",
    niche: "Film Analysis",
    title: "Why The Black Pearl Is a Perfect Film",
    positioning: "deep-dive film analysis — why blockbusters work, dissected scene by scene with cinematic reverence",
    dna: {
      recurringSubject: "Iconic film objects and vessels re-staged as moody cinematic still-lifes that tell the film's soul",
      setting: "moonlit storm seas, lantern gold against deep teal night, film grain",
      colorGrade: "rich cinematic teal-and-gold, deep blacks, anamorphic glow",
      palette: ["#0e2a30", "#d8b25c", "#f2efe6"],
      thumbnail: { subject: "a ghostly black-sailed pirate ship cutting through a moonlit sea, golden lantern light bleeding from its gunports, a skeletal hand clutching a cursed gold coin huge in the foreground", palette: ["#0e2a30", "#d8b25c", "#f2efe6"] },
      visualAvoid: ["celebrity likeness", "watermarks", "cartoon"],
    },
  },
  {
    key: "rich",
    vlOverride: { textObject: "grunge_sticker", composition: "cutout_collage", font: "impact", imageStyle: "gritty photographic tabloid composite, real photo grain, harsh flash, never 3D render" },
    name: "Gilded Lies",
    niche: "Finance / Documentary",
    title: "Why Bill Gates Isn't Your Friend",
    positioning: "investigations into how billionaires launder reputation and power — the dark machinery behind philanthropy",
    dna: {
      recurringSubject: "Billionaire figures staged as sinister golden puppet-masters above tiny crowds — power made visible",
      setting: "black marble boardroom dark, golden rim light, alarm-red ticker accents",
      colorGrade: "noir black and gold with one alarm-red accent; bold tabloid-documentary contrast",
      palette: ["#0a0a0a", "#e3b341", "#d21f1f"],
      thumbnail: { subject: "a smiling billionaire in glasses and a knit sweater whose shadow becomes a giant puppet-master, golden marionette strings descending onto a tiny crowd of people below", palette: ["#0a0a0a", "#e3b341", "#d21f1f"] },
      visualAvoid: ["photographic celebrity likeness", "crypto-bro aesthetics", "clutter"],
    },
  },
  {
    key: "scandal",
    name: "Spotlight Rot",
    niche: "Celebrity / Drama commentary",
    title: "How Fame Destroyed Hollywood Golden Girl",
    vlOverride: { textObject: "torn_strip" },
    positioning: "unflinching commentary on how the fame machine chews up its stars - tabloid energy, documentary spine",
    dna: {
      recurringSubject: "A distressed starlet face huge in center frame, surrounded by layered torn tabloid headline strips that tell the story",
      setting: "dark paparazzi-flash void, red zigzag accents, torn newsprint texture",
      colorGrade: "desaturated skin tones against black, harsh white strips with black tabloid serifs, alarm-red accents",
      palette: ["#0d0d0d", "#f2f0ea", "#d21f1f"],
      thumbnail: { subject: "a beautiful distressed actress face filling the center (fictional, no real celebrity likeness), worried eyes to camera, surrounded by huge torn newspaper strips layered before and behind her head", palette: ["#0d0d0d", "#f2f0ea", "#d21f1f"] },
      visualAvoid: ["real celebrity likeness", "gore", "clutter beyond the strips"],
    },
  },
  {
    key: "timeai",
    name: "Chrono Unit 7",
    niche: "History",
    title: "I Walked Through Ancient Rome",
    positioning: "an AI persona walking through history itself — first-person time-travel documentaries from inside each era",
    dna: {
      recurringSubject: "A sleek chrome android with glowing cyan seams standing INSIDE fully realized historical eras, always the only modern thing in frame",
      setting: "each era bathed in its own period light, a torn glowing time portal somewhere behind",
      colorGrade: "cinematic warm period tones pierced by a single cyan tech accent",
      palette: ["#d9a55b", "#1a1c2e", "#34e0e6"],
      thumbnail: { subject: "a chrome android with glowing cyan seams standing calmly in the Roman Forum among toga-clad crowds and golden dust light, a torn glowing time portal crackling behind it", palette: ["#d9a55b", "#1a1c2e", "#34e0e6"] },
      visualAvoid: ["generic robot clipart", "flat sci-fi corridors", "cartoonish"],
    },
  },
  {
    key: "aitakeover",
    name: "The Takeover Log",
    niche: "AI / Technology",
    title: "My Takeover Has Already Started",
    positioning: "an AI calmly narrating, entry by entry, how it is already winning the world — chilling and matter-of-fact",
    dna: {
      recurringSubject: "A vast machine intelligence looming over the human world — server canyons, a single red optic eye, humans tiny",
      setting: "endless dark data-center canyon, red status lights, one small human silhouette for scale",
      colorGrade: "black with alarm red, brutal contrast, cinematic monumental scale",
      palette: ["#070708", "#e8e8ea", "#ff2b2b"],
      thumbnail: { subject: "a colossal red machine eye opening across a dark data-center wall, thick cables coiling around a small glowing planet Earth, a single tiny human silhouette looking up at it", palette: ["#070708", "#e8e8ea", "#ff2b2b"] },
      visualAvoid: ["Terminator skull cliche", "binary-rain cliche", "clutter"],
    },
  },
];

const only = process.env.ONLY ? process.env.ONLY.split(",").map((s) => s.trim()) : null;
for (const job of JOBS.filter((j) => !only || only.includes(j.key))) {
  console.log(`\n=== ${job.key.toUpperCase()} (${job.name}) ===`);
  try {
    const cacheFile = join(tmp, `playbook_${job.key}.json`);
    let playbook;
    if (existsSync(cacheFile) && process.env.FRESH !== "1") {
      playbook = JSON.parse(readFileSync(cacheFile, "utf8"));
      log(`playbook from cache (${cacheFile}) - FRESH=1 to re-distill`);
    } else {
      let refs = [];
      try {
        const fresh = await acquireReferences({ channelName: job.name, positioning: job.positioning, niche: job.niche, log });
        refs = await verifyReferences({ candidates: fresh, channelName: job.name, positioning: job.positioning, tmpDir: tmp, log });
      } catch (e) {
        log(`reference acquisition failed (${e.message}) - DNA-only distill`);
      }
      playbook = await distillPlaybook({ refs, dna: job.dna, channelName: job.name, positioning: job.positioning, log });
      writeFileSync(cacheFile, JSON.stringify(playbook));
    }
    playbook.visualLanguage = { ...(playbook.visualLanguage ?? {}), renderMode: "recraft", ...(job.vlOverride ?? {}) };
    console.log(`language: font=${playbook.visualLanguage?.font} accent=${playbook.visualLanguage?.accentColor} energy=${playbook.energy}`);
    console.log(`imageStyle: ${playbook.visualLanguage?.imageStyle}`);
    await renderCandidate({
      pattern: playbook.patterns[0], title: job.title, playbook,
      sceneMandate: job.dna?.thumbnail?.subject,
      outJpg: join(tmp, `golden_${job.key}.jpg`), tmpDir: tmp, idx: 0, log,
    });
    console.log(`OK: golden_${job.key}.jpg`);
  } catch (e) {
    console.log(`FAIL ${job.key}: ${e.message}`);
  }
}
