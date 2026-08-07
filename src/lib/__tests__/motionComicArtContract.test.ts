import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  buildMotionComicCharacterArtRequest,
  buildMotionComicPanelArtRequest,
  buildMotionComicTimelineBubble,
  motionComicArtRequestHash,
  motionComicImageRecoveryAllowed,
  projectMotionComicVisualCharacter,
  projectMotionComicVisualScene,
  projectMotionComicVisualStyle,
  validateMotionComicArtCache,
  writeMotionComicArtCache,
} from "@/lib/motionComic";

const dialogue = [
  "[urgent] We leave before the river freezes.",
  "Then keep the lantern covered.",
];

const storyboardPanel = {
  visual: projectMotionComicVisualScene("Two travellers cross a moonlit stone bridge while one shields a lantern from the wind."),
  shot: "wide" as const,
  characters: ["mara", "orin"],
  // The real storyboard object carries lines. The art builder accepts the same
  // object structurally but must project only its visual fields into the prompt.
  lines: [
    { speaker: "mara", text: dialogue[0] },
    { speaker: "orin", text: dialogue[1] },
  ],
};
const style = projectMotionComicVisualStyle("inked graphic novel with restrained moonlight");

const panelRequest = buildMotionComicPanelArtRequest({
  style,
  panel: storyboardPanel,
  refs: [{ data: "reference-bytes", mime: "image/png" }],
});

assert.equal(panelRequest.allowText, false);
assert.equal(panelRequest.tier, "flash");
assert.equal(panelRequest.aspectRatio, "4:3");
assert.equal(panelRequest.imageSize, "2K");
assert.deepEqual(panelRequest.images, [
  { data: "reference-bytes", mimeType: "image/png" },
]);
assert.match(panelRequest.prompt, /PICTURE-ONLY ART CONTRACT/i);
assert.match(panelRequest.prompt, /Do not render dialogue or any readable text/i);
assert.match(panelRequest.prompt, /Do not draw speech bubbles/i);
assert.match(panelRequest.prompt, /environmental negative space/i);
assert.match(panelRequest.prompt, /never a drawn bubble, box, sign, banner, or placeholder glyph/i);
for (const line of dialogue) {
  assert.ok(
    !panelRequest.prompt.includes(line),
    "storyboard dialogue must never cross the paid image-provider boundary",
  );
}

const unsafeScenes = [
  ["Mara holds a T-shirt reading NEVER SURRENDER", "NEVER SURRENDER"],
  ["Mara says RUN NOW while pointing toward the gate", "RUN NOW"],
  ["Graffiti says NEVER AGAIN across the wall", "NEVER AGAIN"],
  ["Mara wears a shirt printed RESIST", "RESIST"],
  ["A speech bubble reads GET OUT above Mara", "GET OUT"],
] as const;
for (const [source, forbiddenCopy] of unsafeScenes) {
  const visual = projectMotionComicVisualScene(source);
  const request = buildMotionComicPanelArtRequest({
    style: projectMotionComicVisualStyle("inked poster reading ATTACK NOW"),
    panel: { ...storyboardPanel, visual },
  });
  assert.ok(!JSON.stringify(visual).includes(forbiddenCopy), "closed visual data must not carry planner copy");
  assert.ok(!request.prompt.includes(forbiddenCopy), `provider request leaked textual prop copy: ${forbiddenCopy}`);
  assert.doesNotMatch(request.prompt, /ATTACK NOW/, "free-form style copy must not cross the provider boundary");
}

const lunarVisual = projectMotionComicVisualScene(
  "An astronaut repairs an oxygen tank inside a damaged lunar module under urgent interior lighting.",
);
assert.equal(lunarVisual.environment, "lunar_module");
assert.equal(lunarVisual.era, "space_age");
assert.ok(lunarVisual.subjects.includes("astronaut"));
assert.ok(lunarVisual.objects.includes("oxygen_tank"));
assert.equal(lunarVisual.action, "repairing");
assert.ok(lunarVisual.relations.includes("subject_repairs_object"));
const lunarRequest = buildMotionComicPanelArtRequest({
  style,
  panel: { visual: lunarVisual, shot: "medium", characters: ["astronaut"] },
});
assert.match(lunarRequest.prompt, /astronaut/i);
assert.match(lunarRequest.prompt, /oxygen tank/i);
assert.match(lunarRequest.prompt, /lunar module/i);
assert.match(lunarRequest.prompt, /repair/i);

const financeVisual = projectMotionComicVisualScene(
  "Inside a bank vault, an investor and an executive exchange coins beside the heavy vault.",
);
assert.equal(financeVisual.environment, "bank_vault");
assert.equal(financeVisual.era, "modern");
assert.ok(financeVisual.subjects.includes("investor"));
assert.ok(financeVisual.subjects.includes("executive"));
assert.ok(financeVisual.objects.includes("coins"));
assert.ok(financeVisual.objects.includes("vault"));
assert.equal(financeVisual.action, "exchanging");
assert.ok(financeVisual.relations.includes("subjects_exchange_objects"));
const financeRequest = buildMotionComicPanelArtRequest({
  style,
  panel: { visual: financeVisual, shot: "wide", characters: ["investor", "executive"] },
});
assert.match(financeRequest.prompt, /investor/i);
assert.match(financeRequest.prompt, /executive/i);
assert.match(financeRequest.prompt, /coins/i);
assert.match(financeRequest.prompt, /vault/i);
assert.match(financeRequest.prompt, /exchange/i);

const stoicVisual = projectMotionComicVisualScene(
  "An ancient Stoic philosopher examines a weathered statue and hourglass inside a stone temple.",
);
assert.equal(stoicVisual.environment, "temple");
assert.equal(stoicVisual.era, "ancient");
assert.ok(stoicVisual.subjects.includes("philosopher"));
assert.ok(stoicVisual.objects.includes("statue"));
assert.ok(stoicVisual.objects.includes("hourglass"));
assert.equal(stoicVisual.action, "examining");
assert.ok(stoicVisual.relations.includes("subject_examines_object"));
const stoicRequest = buildMotionComicPanelArtRequest({
  style,
  panel: { visual: stoicVisual, shot: "medium", characters: ["philosopher"] },
});
assert.match(stoicRequest.prompt, /philosopher/i);
assert.match(stoicRequest.prompt, /statue/i);
assert.match(stoicRequest.prompt, /hourglass/i);
assert.match(stoicRequest.prompt, /examine/i);

assert.equal(motionComicImageRecoveryAllowed(Object.assign(new Error("paid CDN transport"), { retryable: false })), false);
assert.equal(motionComicImageRecoveryAllowed(new Error("pre-bill generation rejected")), true);

const recoveryRequest = buildMotionComicPanelArtRequest({
  style,
  panel: storyboardPanel,
  recovery: true,
});
assert.equal(recoveryRequest.allowText, false);
assert.equal(recoveryRequest.tier, "flash");
assert.match(recoveryRequest.prompt, /never produce a near-black image/i);
for (const line of dialogue) assert.ok(!recoveryRequest.prompt.includes(line));

const characterRequest = buildMotionComicCharacterArtRequest({
  style,
  character: projectMotionComicVisualCharacter(
    "Mara has a weathered face and a red T-shirt printed NEVER SURRENDER with a logo reading RESIST",
  ),
});
assert.equal(characterRequest.allowText, false);
assert.equal(characterRequest.tier, "flash");
assert.match(characterRequest.prompt, /Do not draw speech bubbles/i);
assert.match(characterRequest.prompt, /plain unmarked shirt/i);
assert.doesNotMatch(characterRequest.prompt, /Mara|NEVER SURRENDER|RESIST/i,
  "name, garment copy and labels must be structurally absent from character-sheet requests");

const firstBubble = buildMotionComicTimelineBubble(
  storyboardPanel.lines[0],
  1.25,
  { mouth: [0.45, 0.52], anchor: [0.3, 0.2] },
);
assert.ok(firstBubble);
assert.equal(firstBubble.text, "We leave before the river freezes.");
assert.equal(firstBubble.at, 1.25);
assert.deepEqual(firstBubble.mouth, [0.45, 0.52]);
assert.deepEqual(firstBubble.anchor, [0.3, 0.2]);

const secondBubble = buildMotionComicTimelineBubble(storyboardPanel.lines[1], 3.5);
assert.ok(secondBubble);
assert.equal(secondBubble.text, dialogue[1]);
assert.equal(
  buildMotionComicTimelineBubble({ speaker: "narrator", text: "Voice-over only." }, 0),
  null,
);

async function runAsyncRegressions(): Promise<void> {
  const cacheDir = await mkdtemp(join(tmpdir(), "motion-comic-art-cache-"));
  try {
  const legacyPath = join(cacheDir, "char_legacy.png");
  await writeFile(legacyPath, Buffer.from("legacy-art-may-contain-lettering"));
  assert.equal(await validateMotionComicArtCache(legacyPath, [motionComicArtRequestHash(characterRequest)]), false);
  assert.equal(existsSync(legacyPath), false, "manifest-less legacy art must be narrowly invalidated");

  const firstPath = join(cacheDir, "char_first.png");
  const secondPath = join(cacheDir, "char_second.png");
  const firstHash = motionComicArtRequestHash(characterRequest);
  const secondRequest = buildMotionComicCharacterArtRequest({
    style,
    character: projectMotionComicVisualCharacter("older scientist in a blue coat with glasses"),
  });
  const secondHash = motionComicArtRequestHash(secondRequest);
  await writeMotionComicArtCache(firstPath, Buffer.from("paid-first-art"), firstHash);
  await writeMotionComicArtCache(secondPath, Buffer.from("paid-second-art"), secondHash);
  assert.equal(await validateMotionComicArtCache(firstPath, [firstHash]), true);
  assert.equal(await validateMotionComicArtCache(secondPath, [secondHash]), true);

  const changedFirstRequest = buildMotionComicCharacterArtRequest({
    style,
    character: projectMotionComicVisualCharacter("young worker in green workwear"),
  });
  assert.equal(
    await validateMotionComicArtCache(firstPath, [motionComicArtRequestHash(changedFirstRequest)]),
    false,
    "only art whose provider-visible inputs changed should be invalidated",
  );
  assert.equal(existsSync(firstPath), false);
  assert.equal(
    await validateMotionComicArtCache(secondPath, [secondHash]),
    true,
    "unaffected paid art must remain reusable",
  );
  } finally {
    await rm(cacheDir, { recursive: true, force: true });
  }

  const layoutProbe = spawnSync("python3", ["-c", [
  "import sys",
  "sys.path.insert(0, 'scripts')",
  "import numpy as np",
  "from mc_textplace import cover_geometry, place_safe, remap_cover_box, remap_cover_point, _ov",
  "geometry = cover_geometry(400, 300, 200, 300)",
  "assert geometry == (400, 300, 100, 0)",
  "assert remap_cover_point((0.5, 0.5), geometry, 200, 300) == (100.0, 150.0)",
  "assert remap_cover_box([0.25, 0.2, 0.25, 0.3], geometry, 200, 300) == (0, 60, 100, 90)",
  "det = np.zeros((400, 600), dtype=float)",
  "keep_clear = [(240, 80, 120, 160)]",
  "x, y, fs, bw, bh, ok = place_safe(det, keep_clear, 'A readable bounded bubble', mouth=(300, 150), anchor=(120, 70))",
  "assert ok",
  "assert _ov((x, y, bw, bh), keep_clear[0]) == 0",
  "assert fs >= 14 and bw > 0 and bh > 0",
].join("; ")], { cwd: process.cwd(), encoding: "utf8" });
  assert.equal(layoutProbe.status, 0, layoutProbe.stderr);

  const unavailableArtProbe = spawnSync(
  process.execPath,
  [
    "--import",
    "tsx",
    "--input-type=module",
    "-e",
    "const m=await import('./src/lib/motionComic.ts');const api=m.default??m;let blocked=false;try{await api.castMotionComic({brief:{topic:'no-spend'},runDir:'/tmp/mc-no-spend',outPath:'/tmp/mc-no-spend.mp4'})}catch(e){blocked=String(e).includes('must all be ready')}process.stdout.write(`${api.hasMotionComic()}|${blocked}`);",
  ],
  {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      GEMINI_API_KEY: "storyboard-ready",
      ELEVENLABS_API_KEY: "voice-ready",
      IMAGE_DISABLE_GEMINI: "1",
      IMAGE_PROVIDERS: "fal",
      FAL_KEY: "",
    },
  },
);
  assert.equal(unavailableArtProbe.status, 0, unavailableArtProbe.stderr);
  assert.equal(
    unavailableArtProbe.stdout,
    "false|true",
    "MotionComic readiness must fail before storyboard spend when its selected art route has no credential",
  );
}

runAsyncRegressions()
  .then(() => console.log("motion comic art contract regression tests passed"))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
