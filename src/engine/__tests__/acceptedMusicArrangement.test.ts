import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  ACCEPTED_MUSIC_ARRANGEMENT_VERSION,
  AcceptedMusicArrangementDraftSchema,
  AcceptedMusicArrangementSchema,
  createAcceptedMusicArrangement,
  createMusicReviewContext,
  projectAcceptedMusicArrangementToYuEStyle,
  type AcceptedMusicArrangementDraft,
} from "@/engine/acceptedMusicArrangement";
import { canonicalJson } from "@/lib/canonicalJson";

function draft(count = 4): AcceptedMusicArrangementDraft {
  return {
    role: "meditation_bed",
    direction: "  Maintain the supplied sound.\nKeep its density unchanged.  ",
    requestedDurationSec: 120,
    form: "continuous",
    ending: "natural_cadence",
    playback: "once",
    sections: Array.from({ length: count }, (_, index) => ({
      id: `phase-${index + 1}`, label: `Phase ${index + 1}`,
      startFraction: index / count, endFraction: (index + 1) / count,
      energy: 0.2, instruction: `  Keep the accepted texture for phase ${index + 1}.\nNo change.  `,
    })),
  };
}

const input = {
  ownerId: "private-owner-id", channelId: "private-channel-id", runId: "private-run-id", topic: "Private topic",
  sourceBrief: { direction: "Accepted source", nested: { x: 1, y: [2, 3] } },
};
const make = (arrangement: unknown = draft()) => createAcceptedMusicArrangement({ ...input, arrangement });
const digest = (value: unknown) => createHash("sha256").update(canonicalJson(value)).digest("hex");

function validation(): void {
  const flat = draft();
  assert.deepEqual(AcceptedMusicArrangementDraftSchema.parse(flat), flat);
  for (const role of ["primary_music", "narration_bed", "meditation_bed", "short_form_bed"] as const) {
    for (const form of ["continuous", "through_composed", "sectional"] as const) {
      for (const ending of ["seamless_wrap", "natural_cadence"] as const) {
        for (const playback of ["repeat", "once"] as const) {
          const accepted = { ...flat, role, form, ending, playback };
          assert.deepEqual(make(accepted).arrangement, accepted, "no creative combinations are inferred or rewritten");
        }
      }
    }
  }
  for (const count of [4, 5, 6, 7, 8]) assert.equal(make(draft(count)).arrangement.sections.length, count);
  const shaped = draft();
  shaped.sections.forEach((section, index) => { section.energy = [0, 0.8, 1, 0.1][index]!; });
  assert.deepEqual(make(shaped).arrangement, shaped);

  for (const key of Object.keys(flat)) {
    const missing = { ...flat } as Record<string, unknown>;
    delete missing[key];
    assert.equal(AcceptedMusicArrangementDraftSchema.safeParse(missing).success, false, `${key} cannot default`);
  }
  for (const value of [undefined, null, [], {}, false, "arrangement"]) {
    assert.equal(AcceptedMusicArrangementDraftSchema.safeParse(value).success, false);
  }
  for (const direction of ["", " \t\n", "x".repeat(8_001)]) {
    assert.throws(() => make({ ...flat, direction }));
  }
  assert.equal(make({ ...flat, direction: "x".repeat(8_000) }).arrangement.direction.length, 8_000);
  for (const duration of [NaN, Infinity, -Infinity, 9, 301, 10.5, "120"]) {
    assert.throws(() => make({ ...flat, requestedDurationSec: duration }));
  }
  for (const duration of [10, 300]) assert.equal(make({ ...flat, requestedDurationSec: duration }).arrangement.requestedDurationSec, duration);
  for (const key of ["role", "form", "ending", "playback"]) assert.throws(() => make({ ...flat, [key]: "invented" }));
  assert.throws(() => make({ ...flat, tempo: 72 }));
  for (const count of [0, 3, 9]) assert.throws(() => make(draft(count)));

  for (const field of ["startFraction", "endFraction", "energy"] as const) {
    for (const value of [NaN, Infinity, -Infinity, -0.01, 1.01, "0.5"]) {
      const invalid = draft();
      Object.assign(invalid.sections[0]!, { [field]: value });
      assert.throws(() => make(invalid), `${field} must remain a finite numeric fraction`);
    }
  }
  const mutations: Array<(value: AcceptedMusicArrangementDraft) => void> = [
    (value) => { value.sections[1]!.id = value.sections[0]!.id; },
    (value) => { value.sections[0]!.startFraction = 0.01; },
    (value) => { value.sections.at(-1)!.endFraction = 0.99; },
    (value) => { value.sections[1]!.startFraction = 0.26; },
    (value) => { value.sections[1]!.startFraction = 0.24; },
    (value) => { value.sections[1]!.endFraction = value.sections[1]!.startFraction; },
    (value) => { value.sections[1]!.endFraction = 0.1; },
    (value) => { value.sections.reverse(); },
    (value) => { Object.assign(value.sections[0]!, { tempo: 80 }); },
  ];
  for (const mutate of mutations) {
    const invalid = draft(); mutate(invalid);
    assert.throws(() => make(invalid));
  }
  for (const [field, values] of [
    ["id", ["", "UPPER", "space id", "a".repeat(81)]],
    ["label", ["", " ", "x".repeat(81)]],
    ["instruction", ["", "\n", "x".repeat(601)]],
  ] as const) {
    for (const value of values) {
      const invalid = draft(); Object.assign(invalid.sections[0]!, { [field]: value });
      assert.throws(() => make(invalid));
    }
  }
}

function fingerprints(): void {
  const artifact = make();
  assert.equal(artifact.version, ACCEPTED_MUSIC_ARRANGEMENT_VERSION);
  assert.equal(artifact.sourceBriefFingerprint, digest(input.sourceBrief));
  const { fingerprint, ...body } = artifact;
  assert.equal(fingerprint, digest(body));
  assert.deepEqual(make(), artifact);
  assert.deepEqual(createAcceptedMusicArrangement({ ...input, arrangement: draft(),
    sourceBrief: { nested: { y: [2, 3], x: 1 }, direction: "Accepted source" },
  }), artifact, "canonical object-key ordering does not change either fingerprint");
  assert.deepEqual(AcceptedMusicArrangementSchema.parse(JSON.parse(JSON.stringify(artifact))), artifact);
  for (const field of ["ownerId", "channelId", "runId", "topic"] as const) {
    assert.throws(() => createAcceptedMusicArrangement({ ...input, [field]: " ", arrangement: draft() }));
    const changed = createAcceptedMusicArrangement({ ...input, [field]: "changed", arrangement: draft() });
    assert.notEqual(changed.fingerprint, artifact.fingerprint);
    assert.equal(changed.sourceBriefFingerprint, artifact.sourceBriefFingerprint);
    assert.equal(projectAcceptedMusicArrangementToYuEStyle(changed), projectAcceptedMusicArrangementToYuEStyle(artifact));
  }
  const changedBrief = createAcceptedMusicArrangement({ ...input, arrangement: draft(), sourceBrief: { direction: "different" } });
  assert.notEqual(changedBrief.sourceBriefFingerprint, artifact.sourceBriefFingerprint);
  assert.notEqual(changedBrief.fingerprint, artifact.fingerprint);
  const mutations: Array<(value: AcceptedMusicArrangementDraft) => void> = [
    (value) => { value.direction += " Exact addition."; },
    (value) => { value.role = "primary_music"; },
    (value) => { value.requestedDurationSec = 121; },
    (value) => { value.form = "sectional"; },
    (value) => { value.ending = "seamless_wrap"; },
    (value) => { value.playback = "repeat"; },
    (value) => { value.sections[0]!.id = "changed"; },
    (value) => { value.sections[0]!.label = "Changed"; },
    (value) => { value.sections[0]!.instruction += " Exact addition."; },
    (value) => { value.sections[0]!.energy = 0.3; },
    (value) => { value.sections[0]!.endFraction = 0.2; value.sections[1]!.startFraction = 0.2; },
  ];
  for (const mutate of mutations) {
    const changed = draft(); mutate(changed);
    assert.notEqual(make(changed).fingerprint, artifact.fingerprint);
    assert.throws(() => AcceptedMusicArrangementSchema.parse({ ...artifact, arrangement: changed }), /fingerprint/);
    assert.throws(() => projectAcceptedMusicArrangementToYuEStyle({ ...artifact, arrangement: changed }), /fingerprint/);
  }
  for (const value of ["", "A".repeat(64), "0".repeat(63), "not-a-hash"]) {
    assert.throws(() => AcceptedMusicArrangementSchema.parse({ ...artifact, fingerprint: value }));
    assert.throws(() => AcceptedMusicArrangementSchema.parse({ ...artifact, sourceBriefFingerprint: value }));
  }
  assert.throws(() => AcceptedMusicArrangementSchema.parse({ ...artifact, sourceBriefFingerprint: "0".repeat(64) }), /fingerprint/);
  assert.throws(() => AcceptedMusicArrangementSchema.parse({ ...artifact, version: "other" }));
  assert.throws(() => AcceptedMusicArrangementSchema.parse({ ...artifact, provider: "minimax_music3" }));
  const cyclic: { self?: unknown } = {};
  cyclic.self = cyclic;
  const getter = Object.defineProperty({}, "hidden", {
    enumerable: true, get() { throw new Error("must not execute an accessor"); },
  });
  class CustomBrief { direction = "custom"; }
  const invalidBriefs = [
    undefined, () => null, Symbol("brief"), BigInt(1), NaN, Infinity, -Infinity,
    new Date(0), new Map(), new Set(), new CustomBrief(), cyclic, getter,
    { direction: undefined }, { direction: NaN }, { direction: () => "omitted" },
    { toJSON: () => ({}) }, { date: new Date(0) }, [undefined], [NaN], Array(1),
    Object.assign(["valid"], { extra: "ignored" }),
    { [Symbol("ignored")]: "ignored" },
    Object.defineProperty({}, "hidden", { value: "ignored" }),
  ];
  for (const sourceBrief of invalidBriefs) {
    assert.throws(() => createAcceptedMusicArrangement({ ...input, sourceBrief, arrangement: draft() }), /JSON/);
  }
  const shared = { accepted: true };
  for (const sourceBrief of [null, true, 1, "brief", [], {}, [shared, shared],
    { values: [null, true, 1, "text", { nested: [] }] }, Object.assign(Object.create(null), { direction: "plain" })]) {
    assert.equal(createAcceptedMusicArrangement({ ...input, sourceBrief, arrangement: draft() }).sourceBriefFingerprint, digest(sourceBrief));
  }
  const before = draft();
  const accepted = make(before);
  before.sections[0]!.instruction = "Changed after creation";
  assert.notEqual(accepted.arrangement.sections[0]!.instruction, before.sections[0]!.instruction);
}

function projection(): void {
  const accepted = draft();
  accepted.sections[0]!.endFraction = 0.123456789012345;
  accepted.sections[1]!.startFraction = 0.123456789012345;
  accepted.sections[1]!.energy = 0.234567890123456;
  const artifact = make(accepted);
  const style = projectAcceptedMusicArrangementToYuEStyle(artifact);
  assert.equal(style, projectAcceptedMusicArrangementToYuEStyle(JSON.parse(JSON.stringify(artifact))));
  assert.ok(style.includes(accepted.direction), "preserve leading/trailing whitespace and newlines without truncation");
  for (const section of accepted.sections) {
    for (const value of [section.id, section.label, section.instruction,
      `startFraction ${section.startFraction}`, `endFraction ${section.endFraction}`, `energy ${section.energy}`]) {
      assert.ok(style.includes(value), `projection retains ${value}`);
    }
  }
  for (const value of [accepted.role, accepted.form, accepted.ending, accepted.playback, "120 seconds", "instrumental only"]) {
    assert.ok(style.includes(value));
  }
  for (const value of [input.ownerId, input.channelId, input.runId, input.topic, artifact.fingerprint, artifact.sourceBriefFingerprint]) {
    assert.equal(style.includes(value), false, "only arrangement conditioning enters provider projection");
  }
  assert.doesNotMatch(style, /\[Intro\]|\[Verse\]|\[Chorus\]|\[Bridge\]|\[Outro\]|motif|BPM|tempo|key\/scale|piano|bass|percussion|listening|scenario|%/iu);
  assert.deepEqual(artifact.arrangement, accepted, "projection cannot rewrite the accepted artifact");
}

function utf8Limit(): void {
  const large = draft(8);
  large.direction = "\u97f3".repeat(8_000);
  for (const section of large.sections) section.instruction = "x";
  let remaining = 32_000 - new TextEncoder().encode(projectAcceptedMusicArrangementToYuEStyle(make(large))).byteLength;
  let lastPadded = large.sections[0]!;
  for (const section of large.sections) {
    const triples = Math.min(599, Math.floor(remaining / 3));
    section.instruction += "\u97f3".repeat(triples);
    remaining -= triples * 3;
    const singles = Math.min(600 - section.instruction.length, remaining);
    section.instruction += "x".repeat(singles);
    remaining -= singles;
    lastPadded = section;
    if (remaining === 0) break;
  }
  assert.equal(remaining, 0);
  const artifact = make(large);
  const style = projectAcceptedMusicArrangementToYuEStyle(artifact);
  assert.equal(new TextEncoder().encode(style).byteLength, 32_000);
  assert.ok(style.length < 32_000, "UTF-8 limit is distinct from character count");
  assert.ok(lastPadded.instruction.length < 600);
  lastPadded.instruction += "x";
  const overflow = make(large);
  assert.throws(() => projectAcceptedMusicArrangementToYuEStyle(overflow), /32000 UTF-8 bytes/);
  assert.equal(AcceptedMusicArrangementSchema.safeParse(overflow).success, true, "provider limit does not rewrite provider-neutral acceptance");
}

function retainedReviewContext(): void {
  const context = createMusicReviewContext({
    topic: input.topic, family: "music_loop", channelName: "Quiet hours",
    promptContext: "Restrained nocturnal personality. Never add a climax. Preserve the natural ending.",
  });
  const accepted = createAcceptedMusicArrangement({ ...input, arrangement: draft(),
    sourceBrief: { ...input.sourceBrief, reviewContext: context } });
  assert.deepEqual(accepted.reviewContext, context);
  assert.equal(Object.hasOwn(make(), "reviewContext"), false, "old artifacts never acquire invented context");
  assert.deepEqual(AcceptedMusicArrangementSchema.parse(JSON.parse(JSON.stringify(accepted))), accepted);
  assert.throws(() => createAcceptedMusicArrangement({ ...input, arrangement: draft(), sourceBrief: {
    reviewContext: { ...context, promptContext: "Different channel personality" },
  } }), /context fingerprint mismatch/);
  const changed = createMusicReviewContext({ topic: context.topic, family: context.family,
    channelName: context.channelName, promptContext: "Different channel personality" });
  assert.throws(() => AcceptedMusicArrangementSchema.parse({ ...accepted, reviewContext: changed }), /fingerprint/);
  assert.throws(() => createAcceptedMusicArrangement({ ...input, topic: "Another episode", arrangement: draft(),
    sourceBrief: { reviewContext: context } }), /another topic/);
  const second = createAcceptedMusicArrangement({ ...input, arrangement: draft(), sourceBrief: { reviewContext: changed } });
  assert.notEqual(second.fingerprint, accepted.fingerprint);
  assert.notEqual(second.sourceBriefFingerprint, accepted.sourceBriefFingerprint);
  assert.equal(projectAcceptedMusicArrangementToYuEStyle(second), projectAcceptedMusicArrangementToYuEStyle(accepted),
    "retaining review context does not silently rewrite the composer's accepted direction");
}

retainedReviewContext();
validation();
fingerprints();
projection();
utf8Limit();
console.log("ACCEPTED MUSIC ARRANGEMENT PASS: strict provider-neutral acceptance, flat/shaped roles, canonical fingerprints, exact projection, 32000-byte boundary");
