// Runner for the LORESHORT golden module. Usage: tsx scripts/loreshort_run.mjs <preset>
import { craftLoreShort } from "../src/lib/loreshort.ts";

const PRESETS = {
  // the version Daniel liked (LTX, simple camera moves) — now JUST upscaled to 2K
  starwars: {
    slug: "starwars",
    title: "THE EMPIRE",
    kicker: "how the old order fell",
    topic: "the slow corruption and fall of a galactic Republic, a manufactured clone war, the betrayal and destruction of an order of robed guardian-knights, and the rise of the first tyrannical star-empire and its masked armored enforcer",
    narrator: "the dark Emperor of the new star-empire, recounting his own triumph in FIRST PERSON: cold, patient, intimate, quietly gloating, never breathless, like an old king telling how he truly won",
    subStyle: "cinematic",
    upscale: "ffmpeg", // FREE 2K; set "realesrgan" for a paid hero render
  },
  // NEW — Lord of the Rings lore, watercolour + pencil sub-style
  lotr: {
    slug: "lotr",
    title: "THE RINGS OF POWER",
    kicker: "how the shadow rose",
    topic: "an age of high fantasy: the forging of great rings of power by master smiths, the rise of a dark lord in a shadowed volcanic land who secretly poured his cruelty and will into one master ring to rule the others, the long desperate war of elven-folk and men against him, the ring cut from his hand, and the long watchful peace and slow forgetting that followed",
    narrator: "an ancient elven loremaster recounting the history of the rings in FIRST PERSON — sorrowful, wise, unhurried, the weight of long ages in the voice, like one who watched kingdoms rise and crumble to dust",
    subStyle: "watercolor_pencil",
    model: "seedance",     // ByteDance Seedance-1-lite — dramatically better figures than LTX
    seedanceRes: "480p",   // cheap floor (~$0.09/clip)
    upscale: "realesrgan", // Real-ESRGAN
    upscaleRes: "4k",      // 480p input -> true 4K (~$0.06/clip; small input = cheap upscale)
  },
};

const key = process.argv[2] || "starwars";
const cfg = PRESETS[key];
if (!cfg) { console.error("unknown preset", key, "have:", Object.keys(PRESETS).join(", ")); process.exit(1); }
const r = await craftLoreShort(cfg);
console.log(`RESULT ${key} ${r.url} ${r.width}x${r.height} ${r.durationSec.toFixed(1)}s`);
