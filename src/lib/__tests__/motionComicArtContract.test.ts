import assert from "node:assert/strict";

import {
  buildMotionComicCharacterArtRequest,
  buildMotionComicPanelArtRequest,
  buildMotionComicTimelineBubble,
} from "@/lib/motionComic";

const dialogue = [
  "[urgent] We leave before the river freezes.",
  "Then keep the lantern covered.",
];

const storyboardPanel = {
  scene: "Two travellers cross a moonlit stone bridge while one shields a lantern from the wind.",
  shot: "wide",
  characters: ["mara", "orin"],
  // The real storyboard object carries lines. The art builder accepts the same
  // object structurally but must project only its visual fields into the prompt.
  lines: [
    { speaker: "mara", text: dialogue[0] },
    { speaker: "orin", text: dialogue[1] },
  ],
};

const panelRequest = buildMotionComicPanelArtRequest({
  style: "inked graphic novel with restrained moonlight",
  panel: storyboardPanel,
  characterNames: ["Mara", "Orin"],
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

const recoveryRequest = buildMotionComicPanelArtRequest({
  style: "inked graphic novel with restrained moonlight",
  panel: storyboardPanel,
  characterNames: ["Mara", "Orin"],
  recovery: true,
});
assert.equal(recoveryRequest.allowText, false);
assert.equal(recoveryRequest.tier, "flash");
assert.match(recoveryRequest.prompt, /never produce a near-black image/i);
for (const line of dialogue) assert.ok(!recoveryRequest.prompt.includes(line));

const characterRequest = buildMotionComicCharacterArtRequest({
  style: "inked graphic novel",
  character: { name: "Mara", look: "weathered face, red scarf, brass lantern" },
});
assert.equal(characterRequest.allowText, false);
assert.equal(characterRequest.tier, "flash");
assert.match(characterRequest.prompt, /Do not draw speech bubbles/i);

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

console.log("motion comic art contract regression tests passed");
