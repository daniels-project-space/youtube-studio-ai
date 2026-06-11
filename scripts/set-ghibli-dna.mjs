/**
 * Owner-specified Style DNA for the BEACHSIDE GHIBLI lofi channel (ref youtube
 * 9h_U7CbZspY). A rotating POOL of seaside Ghibli scenes — vibrant, animated,
 * always a gentle girl + her small fluffy cat reading / interacting with the
 * water, day and night. Overrides the auto-distilled DNA with the owner's vision.
 * Env: CONVEX_URL, CHANNEL_ID.
 */
const CONVEX = (process.env.CONVEX_URL ?? "https://astute-camel-689.convex.cloud").replace(/\/$/, "");
const CHANNEL_ID = process.env.CHANNEL_ID ?? "j978et30ex8mksrjs6kpyc7gad88ar0x";
const now = Date.now();

// Shared trailer appended to every scene so the cat + ocean + vibrancy are consistent.
const CAT = "her small fluffy cat companion beside her (looking around, tail flicking, or curled up)";

const signatureScenes = [
  {
    name: "Seaside Cafe (Day)",
    setting:
      `A cozy Studio Ghibli beachside wooden cafe right by the ocean: a gentle young anime girl outside wiping the wooden tables, ${CAT} napping on a chair, vibrant turquoise waves rolling and foaming on the sandy shore, a hanging carved wooden cafe sign swaying in the sea breeze, pots of bright flowers, lush green coastal plants, seabirds overhead, warm golden afternoon sunlight — painterly hand-drawn anime, vibrant and peaceful`,
    motion:
      "turquoise waves rolling in and foaming on the shore; the hanging cafe sign swaying gently; the cat's tail flicking and ears twitching; the girl slowly wiping a table; seabirds gliding; flowers nodding in the breeze",
  },
  {
    name: "Ocean Bedroom (Day)",
    setting:
      `A bright Studio Ghibli bedroom with warm wooden floors and a bed to the side: a gentle young anime girl sitting on the edge of the bed reading a book, a large open window beside her looking straight out to a deep-blue foaming ocean, white curtains billowing inward on the sea wind, ${CAT} curled on the quilt, potted flowers on the sill, airy sunlit room — painterly hand-drawn anime, vibrant and serene`,
    motion:
      "white curtains billowing inward on the sea breeze; deep-blue ocean waves foaming beyond the window; the cat breathing/shifting on the bed; the girl turning a page; flowers swaying on the sill; sparkles of light on the water",
  },
  {
    name: "Camper Van Shore (Day)",
    setting:
      `A cute retro Studio Ghibli camper van parked on a grassy flower-strewn bluff at the water's edge: a gentle young anime girl sitting in the open side door wrapped in a blanket reading, ${CAT} beside her gazing out to sea, deep-blue ocean foaming on the rocks below, wildflowers and tall green grass, big soft cumulus clouds and gliding birds in a luminous sky — painterly hand-drawn anime, vibrant and free`,
    motion:
      "ocean waves foaming against the rocks below; tall grass and wildflowers rippling in the wind; cumulus clouds drifting; birds gliding; the cat's head turning to follow a bird; curtains in the van fluttering",
  },
  {
    name: "Pier & Fishing Hut (Day)",
    setting:
      `A wooden Studio Ghibli pier stretching over clear turquoise water toward a little fishing hut: a gentle young anime girl sitting at the pier's edge with her feet over the water reading, ${CAT} beside her watching fish dart below, gentle foaming waves around the weathered posts, lush Ghibli trees on the shore, bright sunny sky with seabirds — painterly hand-drawn anime, vibrant and calm`,
    motion:
      "clear water rippling and foaming around the pier posts; fish darting below; the cat leaning over to watch the fish; the girl's hair and the pages stirring in the breeze; Ghibli trees swaying; birds gliding",
  },
  {
    name: "Meadow Bluff over the Sea (Day)",
    setting:
      `A flower-filled green Studio Ghibli meadow on a cliff bluff high above a deep-blue foaming ocean: a gentle young anime girl lying in the grass reading a book, ${CAT} pouncing playfully at butterflies nearby, big soft cumulus clouds and gliding seabirds, wind rippling the wildflowers and grass, distant rolling hills meeting the sea — painterly hand-drawn anime, vibrant and dreamy`,
    motion:
      "wildflowers and tall grass rippling in waves of wind; cumulus clouds drifting across the sky; the cat pouncing at fluttering butterflies; seabirds gliding; the far-below ocean foaming on the shore",
  },
  {
    name: "Rooftop Loft by the Water (Day)",
    setting:
      `A cozy Studio Ghibli rooftop terrace above a seaside town: a gentle young anime girl reading in a comfy chair surrounded by potted plants and hanging string lights, ${CAT} perched on the railing watching gulls, the deep-blue foaming ocean and tiled rooftops stretching beyond, warm sea breeze, bright sky — painterly hand-drawn anime, vibrant and cozy`,
    motion:
      "string lights and potted plants swaying in the breeze; the ocean foaming beyond the rooftops; gulls wheeling; the cat tracking a bird from the railing; the girl turning a page; laundry or a banner fluttering",
  },
  {
    name: "Seaside Cafe (Night)",
    setting:
      `The cozy Studio Ghibli beachside cafe at night: warm paper-lantern glow over the wooden tables, a gentle young anime girl sitting with a cup of tea reading, ${CAT} curled asleep on a chair, dark foaming waves catching the moonlight on the shore, paper lanterns swaying, a sky full of stars — painterly hand-drawn anime, warm amber light against deep blue night`,
    motion:
      "paper lanterns swaying and glowing softly; moonlit waves foaming on the dark shore; steam rising from the teacup; the cat breathing in sleep; stars faintly shimmering; the cafe sign swaying",
  },
  {
    name: "Ocean Bedroom (Night)",
    setting:
      `The Studio Ghibli ocean bedroom at night: a gentle young anime girl reading on the bed by warm lamp light, the open window beside her framing a moonlit deep-blue ocean with gentle foam, white curtains breathing in the night sea breeze, ${CAT} asleep on the quilt, potted flowers, stars beyond the glass — painterly hand-drawn anime, warm and intimate`,
    motion:
      "curtains breathing softly in the night breeze; moonlit ocean gently foaming beyond the window; lamp light flickering almost imperceptibly; the cat curled and breathing; the girl turning a page; stars twinkling",
  },
  {
    name: "Island Campfire (Night)",
    setting:
      `A small Studio Ghibli island at night with a warm campfire on the sand: a gentle young anime girl wrapped in a blanket reading by the firelight, ${CAT} dozing against her side, gentle dark waves lapping and foaming at the shore, fireflies drifting, a huge starry sky and a big soft moon over the water, Ghibli trees behind — painterly hand-drawn anime, cozy and magical`,
    motion:
      "campfire flames flickering and embers rising; dark waves lapping and foaming on the sand; fireflies drifting; the cat's ear twitching in sleep; the girl turning a page; stars shimmering; moonlight rippling on the water",
  },
  {
    name: "Lanterns on the Water (Night)",
    setting:
      `A calm Studio Ghibli cove ringed by towering Ghibli trees at night: dozens of warm paper lanterns floating on the dark water and drifting up into a deep starry sky, a gentle young anime girl sitting on a small wooden dock watching with ${CAT} beside her, soft golden reflections rippling on the water, fireflies, gentle foam at the shoreline — painterly hand-drawn anime, serene and luminous`,
    motion:
      "paper lanterns drifting on the water and rising slowly into the sky; golden reflections rippling on the dark water; fireflies twinkling; the cat watching a lantern float past; gentle foam at the shoreline; trees swaying",
  },
  {
    name: "Pier & Fishing Hut (Night)",
    setting:
      `The Studio Ghibli pier and little fishing hut lit by a warm hanging lantern at night: a gentle young anime girl sitting at the end with ${CAT}, moonlit foaming water around the posts, distant warm town lights across the bay, a sky full of stars, silhouetted Ghibli trees on the shore — painterly hand-drawn anime, calm and nostalgic`,
    motion:
      "the hanging lantern swaying and glowing; moonlit water foaming around the pier posts; distant town lights twinkling; the cat's tail flicking; the girl turning a page; stars shimmering; trees swaying softly",
  },
  {
    name: "Camper Van Shore (Night)",
    setting:
      `The Studio Ghibli camper van at night on the grassy shoreline, warm interior glow and tiny fairy lights inside: a gentle young anime girl reading in the open door under a blanket, ${CAT} curled beside her, a small campfire with glowing embers nearby, moonlit deep-blue waves foaming below, a vast starry sky — painterly hand-drawn anime, cozy and dreamy`,
    motion:
      "fairy lights twinkling inside the van; campfire embers glowing and drifting; moonlit waves foaming below; the cat shifting in sleep; the girl turning a page; tall grass swaying; stars shimmering",
  },
];

const styleDNA = {
  source: "owner-specified",
  confidence: 1,
  groundingGaps: [],
  recurringSubject:
    "A gentle young anime girl (Studio Ghibli style) and her small fluffy cat companion, always by the sea — reading or quietly interacting with the water, the cat, a book, the bed, the van, or a cafe.",
  setting: "Soft, vibrant hand-painted Studio Ghibli seaside worlds — cafes, ocean bedrooms, piers, camper vans, bluffs and coves.",
  signatureScenes,
  composition:
    "Wide, beautifully balanced painterly framing with strong depth (foreground / midground / background planes); rule-of-thirds; the ocean and sky given generous space; a clean lower or side zone kept for a title; a single calm held frame.",
  colorGrade:
    "Vibrant Studio Ghibli aesthetic — luminous painterly skies, lush saturated greens, deep-blue foaming ocean, warm golden daylight; at night deep blue with warm amber lantern/fire glow and moonlight; rich but soft, no harsh contrast, gentle film grain.",
  motifs: [
    "deep-blue turquoise ocean waves rolling and foaming",
    "a small fluffy cat companion",
    "white curtains billowing in the sea wind",
    "warm paper lanterns (floating on water and rising into the sky)",
    "wildflowers and lush green coastal plants",
    "towering soft Ghibli trees",
    "drifting cumulus clouds and gliding seabirds",
    "campfire / lantern / fairy-light glow",
    "starry night skies and a big soft moon",
  ],
  variationAxes: ["time of day (sunny day vs starry night)", "which signature scene", "season / weather"],
  motionVocabulary: ["ocean waves rolling and foaming", "curtains billowing in the wind", "the cat looking around", "birds gliding", "lanterns drifting"],
  motionDiscipline:
    "Camera perfectly locked — no pan, no zoom; only the ambient elements (waves, curtains, lanterns, fire, the cat, birds, grass) move, subtly and on independent loops; the frame is a living painting.",
  visualAvoid: [
    "any text, letters, words, logos or readable signage in the artwork",
    "harsh neon or cyberpunk colors",
    "photorealistic or 3D / CGI look",
    "the cliche anime-girl-at-a-desk-with-headphones thumbnail",
    "cluttered, busy compositions",
    "regional pop or devotional imagery",
    "dull or washed-out colors — keep it vibrant",
  ],
  thumbnail: {
    composition:
      "a single signature beachside Ghibli scene (the girl + her cat + the ocean), wide and painterly, with a bright high-contrast focal area and a clean zone for the title; legible at mobile size",
    textRule:
      "2-4 words, a warm cozy mood phrase (e.g. 'seaside calm', 'ocean lofi nights', 'rainy pier'); soft rounded hand-drawn storybook font in cream/warm-white with a strong dark soft-shadow or translucent scrim for high contrast and legibility; no harsh outlines",
    font: "rounded hand-drawn storybook / Ghibli-title style",
    palette: ["#1e6f8e", "#3fb0c9", "#f6e0a4", "#e8a76b", "#0f2a3f"],
    subject: "the girl and her fluffy cat by the sea in a signature scene",
  },
  audio: {
    genre: "lo-fi hip-hop / chillhop",
    bpmRange: [70, 85],
    instrumentation: ["warm Rhodes / felt piano", "soft boom-bap drums", "gentle upright bass", "mellow acoustic guitar", "soft warm pads / strings"],
    textures: ["vinyl crackle", "gentle ocean ambience (waves / wind / distant gulls) low in the mix"],
    moodArc: "calm, warm, nostalgic — a flat gentle plateau, no build or drop, seamless from start to loop end",
    loudnessLufs: -14,
    loopable: true,
  },
  seo: {
    titleFormula: "[Mood] Seaside Ghibli Lofi ~ [scene / use-case] to study & relax to (X Hours) 🌊",
    descriptionStructure:
      "Line 1: gentle seaside scene-setting invitation. Line 2: use-case (study / relax / sleep). Line 3: loop duration. Line 4: channel tagline. Line 5: keyword block (ghibli lofi, seaside lofi, lofi hip hop, study music, ocean sounds, relaxing). Line 6: playlist links.",
    playlistStrategy:
      "Evergreen playlists by vibe: 'Sunny Shore Days', 'Lantern Nights by the Sea', 'Rainy Pier & Campfire' — each upload assigned by its signature scene + time of day.",
  },
  refreshedAt: now,
};

const r = await fetch(`${CONVEX}/api/mutation`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ path: "channels:updateChannel", args: { channelId: CHANNEL_ID, name: "Seaside Ghibli Lofi", styleDNA }, format: "json" }),
});
const j = await r.json();
console.log("updateChannel:", JSON.stringify(j));
console.log(j.status === "success" ? `✅ Beachside Ghibli DNA set — ${signatureScenes.length} signature scenes` : "❌ failed");
