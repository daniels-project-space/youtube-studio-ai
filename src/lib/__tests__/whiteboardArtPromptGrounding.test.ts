import assert from "node:assert/strict";

import { whiteboardArtPrompt } from "@/lib/whiteboardSync";

const prompt = whiteboardArtPrompt({
  styleLock: "CHANNEL STYLE-DNA (history): clean editorial black-marker line art",
  isScene: true,
  draw: "a respectful non-graphic black-marker scene of striking banana workers facing a distant line of soldiers near railroad cars, with a single red warning accent",
  cue: "banana workers near Ciénaga, Colombia went on strike",
  narration: "In 1928, banana workers near Ciénaga, Colombia went on strike for safer and fairer conditions.",
});

assert.match(prompt, /Ciénaga, Colombia/, "the paid image request keeps the sealed historical grounding context");
assert.match(
  prompt,
  /Do NOT invent or substitute a national flag, military insignia, or political symbol; if none is explicitly named, omit it\./,
  "a generic worker/soldier scene cannot silently acquire an unrelated flag",
);
assert.match(
  prompt,
  /use only countries, eras, institutions, uniforms, flags, insignia, and political symbols explicitly named/,
  "historical identities are bounded by the approved scene and narration",
);
assert.match(
  prompt,
  /SPOKEN CLAIM TO MAKE LITERALLY VISIBLE: "banana workers near Ciénaga, Colombia went on strike"/,
  "the paid image request binds the drawing to its exact narration cue instead of permitting a decorative metaphor",
);

console.log("whiteboard art prompt grounding: PASS");
