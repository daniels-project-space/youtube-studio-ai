/**
 * A channel's narrator must be declared, never invented.
 *
 * synthTts dispatches to three providers. Two of them disagreed about what a
 * missing voice means:
 *
 *   qwen3        refuses. synthQwenNarration throws unless the speaker is one of
 *                the nine pinned CustomVoice names.
 *   elevenlabs   substituted one hard-coded id ("George") for any caller that
 *                did not name a voice.
 *
 * The second is the convergence failure applied to the single most
 * identity-defining attribute a channel has, and it is silent: a video narrated
 * in the wrong voice renders, passes QA and uploads perfectly. Every channel
 * that omitted the field would have adopted the same narrator as every other
 * channel that omitted it.
 *
 * Measured before changing it — of the six live narrated channels, exactly one
 * uses ElevenLabs and it names its voice, and the other five run Fish with an
 * explicit identity.voiceId. Nothing in production depended on the default.
 *
 * Fish is deliberately left alone: resolveVoiceId resolves across a RANGE by
 * niche (NICHE_VOICES) before falling back, which is a spread rather than a
 * point, and its fallback is reached only when a niche is unknown.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { resolveVoiceId } from "@/lib/tts";

const CODE = readFileSync(join(process.cwd(), "src/lib/tts.ts"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

function main(): void {
  // ---- the hard-coded narrator is gone ------------------------------------
  assert.ok(
    !/JBFqnCBsd6RMkjVDRZzb/.test(CODE),
    "no single ElevenLabs voice id may be baked in as a fallback — that is how every " +
      "channel that omits the field becomes the same narrator",
  );
  assert.match(
    CODE,
    /ElevenLabs narration requires an explicit elevenVoiceId/,
    "an unnamed ElevenLabs voice must be refused with a message that says why",
  );
  assert.match(
    CODE,
    /const voice = args\.elevenVoiceId\?\.trim\(\);/,
    "and whitespace must not count as a declared voice",
  );

  // ---- the two providers must now agree -----------------------------------
  // qwen3 already refused; the point of the change is that they stop
  // disagreeing about the same question.
  assert.match(
    CODE,
    /if \(provider === "elevenlabs"\) return synthElevenLabs\(args\);/,
    "both providers must still be reachable through the one dispatch",
  );

  // ---- Fish now resolves across a RANGE, not onto a point ------------------
  // NICHE_VOICES covers four niches and maps all four to the SAME voice, so
  // before this every unmapped niche — which is most of them — received one
  // identical narrator. My first version of this test assumed the mapping was
  // already a range and asserted two niches would differ; it failed, which is
  // how the collapse was found.
  const niches = [
    "stoic philosophy", "true crime", "finance", "lo-fi music", "cooking",
    "space", "technology", "nature documentary", "personal finance", "mythology",
  ];
  const resolved = new Set(niches.map((n) => resolveVoiceId(undefined, n)));
  assert.ok(
    resolved.size >= 2,
    `ten unmapped niches resolved to ${resolved.size} distinct voice(s) — a fallback that ` +
      `returns one point makes every channel that omits a voice the same narrator`,
  );

  // Stable: a channel must not change narrator between runs.
  assert.equal(
    resolveVoiceId(undefined, "finance"),
    resolveVoiceId(undefined, "finance"),
    "the same niche must always resolve to the same voice, or a channel's voice drifts per run",
  );

  // A deliberate mapping still wins over the spread — those were chosen.
  assert.equal(
    resolveVoiceId(undefined, "history"),
    resolveVoiceId(undefined, "psychology"),
    "NICHE_VOICES maps both of these on purpose; the spread must not override a chosen mapping",
  );

  // The pool must stay English. A wrong language is not a stylistic variation.
  const german = resolveVoiceId("voice_de_stoic");
  const spanish = resolveVoiceId("voice_es_locutor");
  assert.ok(
    !resolved.has(german) && !resolved.has(spanish),
    "the fallback pool must not contain the German or Spanish references — spreading an " +
      "English channel onto those would be far worse than converging",
  );
  // An explicitly named voice always wins over any niche inference.
  assert.equal(
    resolveVoiceId("voice_de_stoic", "finance"),
    resolveVoiceId("voice_de_stoic", "history"),
    "an explicit voice key must be honoured regardless of niche",
  );
  // A raw 32-hex reference id passes through untouched.
  const raw = "0123456789abcdef0123456789abcdef";
  assert.equal(resolveVoiceId(raw), raw, "a raw reference id must pass through");

  console.log("NARRATOR IDENTITY PASS — a narrator is declared, not defaulted");
}

main();
