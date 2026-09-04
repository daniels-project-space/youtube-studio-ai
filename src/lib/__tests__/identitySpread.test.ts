/**
 * The properties that make a spread default safe. Each of these, if broken,
 * causes a defect that is invisible in review and obvious in the output.
 */
import assert from "node:assert/strict";

import {
  FALLBACK_ACCENT_COLOURS,
  FALLBACK_LINE_ART_STYLES,
  FALLBACK_NARRATOR_PERSONAS,
  fallbackLineArtStyle,
  fallbackNarratorPersona,
  spreadDefault,
  stableIndex,
} from "@/lib/identitySpread";

const CHANNELS = [
  "Inked Histories", "The Quiet Stoic", "Chalk & Compound", "Investory",
  "Neon Rain Penthouse", "Vault Breach", "Overbuilt", "Sealed Records",
  "The Getaway Files", "Empires At War", "Lorecraft", "Deep Field",
];

function main(): void {
  // DETERMINISM. A default that varied per call would make renders
  // irreproducible and break every cache, checkpoint and seed downstream.
  for (const name of CHANNELS) {
    assert.equal(fallbackLineArtStyle(name), fallbackLineArtStyle(name));
    assert.equal(stableIndex(name, 7), stableIndex(name, 7));
  }

  // CASE AND PADDING must not change identity: "  inked histories " is the same
  // channel, and a stray space in a config should not restyle a catalogue.
  assert.equal(fallbackLineArtStyle("Inked Histories"), fallbackLineArtStyle("  inked histories "));

  // SPREAD. The whole point: distinct channels must not collapse onto one
  // option. With 12 channels over 6 styles, a house default scores 1.
  const styles = new Set(CHANNELS.map(fallbackLineArtStyle));
  assert.ok(styles.size >= 4, `expected real spread across styles, got ${styles.size}`);
  const personas = new Set(CHANNELS.map(fallbackNarratorPersona));
  assert.ok(personas.size >= 3, `expected real spread across personas, got ${personas.size}`);

  // IN RANGE. A hash bug that walks off the end would yield undefined, which
  // reads downstream as an empty prompt rather than an error.
  for (const name of CHANNELS) {
    assert.ok(FALLBACK_LINE_ART_STYLES.includes(fallbackLineArtStyle(name) as never));
    assert.ok(FALLBACK_NARRATOR_PERSONAS.includes(fallbackNarratorPersona(name) as never));
  }
  assert.equal(spreadDefault("anything", []), undefined, "an empty range cannot be resolved");
  assert.equal(stableIndex("x", 0), 0, "a zero modulo must not divide by zero");

  // IDENTITY PRESERVED. Every drawn-channel fallback must still be line art —
  // widening the range must not let a scribe channel become a painted one.
  for (const style of FALLBACK_LINE_ART_STYLES) {
    assert.match(style, /line art/, `not recognisably line art: ${style}`);
  }

  // The first entry stays the historical default, so a channel that resolves to
  // it looks exactly as it did before this change.
  assert.equal(
    FALLBACK_LINE_ART_STYLES[0],
    "clean editorial black-marker line art, bold simple silhouettes, uniform stroke weight, sparse red accents",
  );

  // Accents must span the wheel rather than cluster, which is the defect that
  // put seven of eleven audited thumbnails in the same amber band.
  assert.ok(FALLBACK_ACCENT_COLOURS.length >= 6);
  assert.equal(new Set(FALLBACK_ACCENT_COLOURS).size, FALLBACK_ACCENT_COLOURS.length, "no duplicate accents");

  console.log("IDENTITY SPREAD PASS");
}

main();
