/**
 * regroundChannel — safety tests.
 *
 * This operation exists to repair LIVE legacy channels, so its guarantees are
 * about what it must NEVER do. Every test runs against fakes; no test may ever
 * touch a real Convex row.
 *
 *  1. It writes ONLY styleDNA + qaRubric — never name/persona/identity/brief/voice.
 *  2. It requires an EXPLICIT family and never guesses one from `template`.
 *  3. It refuses a channel that already has styleDNA unless `force: true`.
 *  4. It passes the channel's EXISTING persona/identity through as canon.
 *  5. The Trigger wrapper's real write path forwards only the two fields.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  REGROUND_PATCH_FIELDS,
  assertExplicitFamily,
  assertRegroundPatch,
  buildRegroundPatch,
  regroundChannelCore,
  type RegroundChannelRecord,
  type RegroundDeps,
  type RegroundPatch,
} from "@/engine/creative/regroundChannel";
import type { QualityBar, StyleDNA } from "@/engine/creative/types";
import type { StyleDNAInput } from "@/engine/creative/styleDNA";
import type { FamilyKey } from "@/engine/families";

/* --------------------------------- fakes -------------------------------- */

const FAKE_DNA: StyleDNA = {
  source: "research",
  confidence: 0.82,
  groundingGaps: [],
  palette: ["#101820", "#f2aa4c"],
  recurringSubject: "a lone night-shift radio operator",
  setting: "a rain-lashed coastal signal tower",
  composition: "subject on the left third, deep background falloff",
  colorGrade: "cool teal shadows, sodium-lamp highlights",
  motifs: ["rain on glass", "analogue VU needles"],
  variationAxes: ["time-of-day", "storm intensity"],
  motionVocabulary: ["drifting rain", "needle twitch"],
  motionDiscipline: "locked tripod, no pans or zooms",
  visualAvoid: ["stock lens flares", "neon cyberpunk cliches"],
  thumbnail: {
    composition: "subject-on-third, high contrast",
    textRule: "<=3 words",
    palette: ["#101820", "#f2aa4c"],
    subject: "the radio operator silhouetted",
  },
  audio: {
    genre: "ambient lofi",
    bpmRange: [62, 74],
    instrumentation: ["rhodes", "tape bass"],
    textures: ["vinyl crackle"],
    moodArc: "steady, unresolved",
    loudnessLufs: -14,
    loopable: true,
  },
  seo: {
    titleFormula: "[MOOD] radio for [ACTIVITY]",
    descriptionStructure: "hook / tracklist / cta",
    playlistStrategy: "one playlist per storm level",
  },
  refreshedAt: 1_700_000_000_000,
};

const FAKE_BAR: QualityBar = {
  target: 1.6,
  dimensions: [{ id: "identity", description: "on-brand", minScore: 1 }],
  refreshedAt: 1_700_000_000_000,
};

/** A legacy row: real identity, NO styleDNA, NO stored family. */
function legacyChannel(over: Partial<RegroundChannelRecord> = {}): RegroundChannelRecord {
  return {
    _id: "fake_channel_not_real",
    ownerId: "owner_test",
    name: "Rainy Neon Lofi",
    template: "C",
    identity: {
      niche: "lofi study beats",
      persona: "a night-shift radio operator broadcasting to insomniacs",
      styleGrammar: "grainy 90s anime stills, rain on glass",
      palette: ["#101820", "#f2aa4c"],
    },
    ...over,
  };
}

interface Harness {
  deps: RegroundDeps;
  writes: { channelId: string; patch: RegroundPatch }[];
  synthInputs: StyleDNAInput[];
}

function harness(channel: RegroundChannelRecord | null): Harness {
  const writes: Harness["writes"] = [];
  const synthInputs: StyleDNAInput[] = [];
  return {
    writes,
    synthInputs,
    deps: {
      loadChannel: async () => channel,
      loadGrounding: async () => ({ titles: ["a top title"], powerWords: ["cozy"] }),
      synth: async (input) => {
        synthInputs.push(input);
        return FAKE_DNA;
      },
      buildBar: () => FAKE_BAR,
      patchChannel: async (channelId, patch) => {
        writes.push({ channelId, patch });
        return { forked: false };
      },
      now: () => 1_700_000_000_000,
      log: () => {},
    },
  };
}

/* ------------------- 1. only styleDNA + qaRubric are written ------------- */

async function writesOnlyStyleDnaAndRubric(): Promise<void> {
  const h = harness(legacyChannel());
  const result = await regroundChannelCore(
    { channelId: "fake_channel_not_real", family: "music_loop" },
    h.deps,
  );
  assert.equal(result.ok, true);
  assert.equal(h.writes.length, 1, "exactly one write");
  assert.deepEqual(
    Object.keys(h.writes[0].patch).sort(),
    ["qaRubric", "styleDNA"],
    "the patch must carry ONLY styleDNA + qaRubric",
  );
  // The brand fields this whole tool exists to protect.
  for (const forbidden of [
    "name",
    "persona",
    "identity",
    "creativeBrief",
    "voiceId",
    "slug",
    "pipeline",
    "template",
    "family",
    "status",
    "schedule",
    "thumbnailer",
  ]) {
    assert.ok(!(forbidden in h.writes[0].patch), `reground must never write "${forbidden}"`);
  }
  assert.deepEqual([...REGROUND_PATCH_FIELDS], ["styleDNA", "qaRubric"]);
}

/** The invariant is structural: the guard rejects any widened/narrowed patch. */
function patchGuardRejectsWidening(): void {
  assert.throws(
    () => assertRegroundPatch({ styleDNA: FAKE_DNA, qaRubric: FAKE_BAR, name: "Renamed!" }),
    /ONLY \[qaRubric, styleDNA\]/,
    "a patch that grew a `name` key must be rejected",
  );
  assert.throws(
    () => assertRegroundPatch({ styleDNA: FAKE_DNA }),
    /ONLY/,
    "an incomplete patch must be rejected too",
  );
  assert.doesNotThrow(() => buildRegroundPatch(FAKE_DNA, FAKE_BAR));
}

/** Even a synth result that leaks brand fields cannot widen the patch. */
async function leakySynthCannotWidenPatch(): Promise<void> {
  const h = harness(legacyChannel());
  // A hostile StyleDNA carrying a persona/name — buildRegroundPatch selects
  // fields explicitly, so the junk stays inside styleDNA and can never become
  // a top-level channel patch key.
  h.deps.synth = async () =>
    ({ ...FAKE_DNA, persona: "REPLACED PERSONA", name: "REPLACED NAME" }) as unknown as StyleDNA;
  await regroundChannelCore(
    { channelId: "fake_channel_not_real", family: "music_loop" },
    h.deps,
  );
  assert.deepEqual(Object.keys(h.writes[0].patch).sort(), ["qaRubric", "styleDNA"]);
  assert.ok(!("persona" in h.writes[0].patch), "a leaked persona must not reach the patch root");
  assert.ok(!("name" in h.writes[0].patch), "a leaked name must not reach the patch root");
}

/* --------------------- 2. family must be explicit ----------------------- */

function familyMustBeExplicit(): void {
  for (const bad of [undefined, null, "", "   ", "C", "template-C", "narrated", 3]) {
    assert.throws(
      () => assertExplicitFamily(bad),
      /EXPLICIT `family`|unknown family/,
      `family "${String(bad)}" must be rejected, not guessed`,
    );
  }
  assert.equal(assertExplicitFamily("music_loop"), "music_loop");
  assert.equal(assertExplicitFamily("narrated_stock"), "narrated_stock");
}

async function familyIsNeverInferredFromTemplate(): Promise<void> {
  // Template "C" is present on the row and maps to music_loop in the legacy
  // architect fallback — the core must STILL refuse rather than infer it.
  const h = harness(legacyChannel());
  await assert.rejects(
    regroundChannelCore(
      { channelId: "fake_channel_not_real", family: undefined as unknown as FamilyKey },
      h.deps,
    ),
    /EXPLICIT `family`/,
  );
  assert.equal(h.writes.length, 0, "a family-less call must not write");
  assert.equal(h.synthInputs.length, 0, "a family-less call must not even call the LLM");
}

async function storedFamilyWins(): Promise<void> {
  // A stored family is authoritative: a disagreeing argument is an operator
  // error, not a migration.
  const h = harness(legacyChannel({ family: "music_loop" }));
  await assert.rejects(
    regroundChannelCore(
      { channelId: "fake_channel_not_real", family: "narrated_stock" },
      h.deps,
    ),
    /reground never changes a channel's family/,
  );
  assert.equal(h.writes.length, 0);
}

/* --------- 3. already-grounded channels are refused without force -------- */

async function refusesAlreadyGroundedChannel(): Promise<void> {
  const h = harness(legacyChannel({ styleDNA: FAKE_DNA, qaRubric: FAKE_BAR }));
  const result = await regroundChannelCore(
    { channelId: "fake_channel_not_real", family: "music_loop" },
    h.deps,
  );
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.reason, "already-grounded");
  assert.equal(h.writes.length, 0, "an established channel must not be overwritten");
  assert.equal(h.synthInputs.length, 0, "and must not burn an LLM call either");
}

async function forceAllowsExplicitReground(): Promise<void> {
  const h = harness(legacyChannel({ styleDNA: FAKE_DNA, qaRubric: FAKE_BAR }));
  const result = await regroundChannelCore(
    { channelId: "fake_channel_not_real", family: "music_loop", force: true },
    h.deps,
  );
  assert.equal(result.ok, true);
  assert.equal(result.ok === true && result.forced, true);
  assert.equal(h.writes.length, 1, "force: true is the explicit re-ground path");
  assert.deepEqual(Object.keys(h.writes[0].patch).sort(), ["qaRubric", "styleDNA"]);
}

async function dryRunWritesNothing(): Promise<void> {
  const h = harness(legacyChannel());
  const result = await regroundChannelCore(
    { channelId: "fake_channel_not_real", family: "music_loop", dryRun: true },
    h.deps,
  );
  assert.equal(result.ok, true);
  assert.equal(result.ok === true && result.wrote, false);
  assert.equal(h.writes.length, 0, "dryRun must not write");
  assert.equal(h.synthInputs.length, 1, "but it does compute the DNA for review");
}

async function missingChannelIsASoftRefusal(): Promise<void> {
  const h = harness(null);
  const result = await regroundChannelCore(
    { channelId: "fake_channel_not_real", family: "music_loop" },
    h.deps,
  );
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.reason, "channel-not-found");
  assert.equal(h.writes.length, 0);
}

/* ------------- 4. the EXISTING identity is the input, as canon ----------- */

async function existingIdentityIsTheInput(): Promise<void> {
  const h = harness(legacyChannel());
  await regroundChannelCore(
    { channelId: "fake_channel_not_real", family: "music_loop" },
    h.deps,
  );
  const input = h.synthInputs[0];
  assert.equal(
    input.persona,
    "a night-shift radio operator broadcasting to insomniacs",
    "the stored persona must be handed to the distiller unchanged",
  );
  assert.equal(input.name, "Rainy Neon Lofi", "the stored name is an input, never an output");
  assert.equal(input.niche, "lofi study beats");
  assert.equal(input.styleGrammar, "grainy 90s anime stills, rain on glass");
  assert.deepEqual(input.palette, ["#101820", "#f2aa4c"]);
  assert.equal(input.family, "music_loop", "the EXPLICIT family reaches the distiller");
  // Read-only research is folded in, never written back.
  assert.deepEqual(input.competitorTitles, ["a top title"]);
}

/* --------- 5. the real Trigger write path forwards only 2 fields --------- */

function triggerWrapperForwardsOnlyTwoFields(): void {
  const wrapper = readFileSync(join(process.cwd(), "src/trigger/regroundChannel.ts"), "utf8");
  // Anchor on the CALL, not the doc comment that also names the mutation.
  const start = wrapper.indexOf("convex.mutation(api.channels.updateChannel");
  const end = wrapper.indexOf("now: () => Date.now()", start);
  assert.ok(start > 0 && end > start, "the updateChannel call site must be locatable");
  const call = wrapper.slice(start, end);
  assert.equal(
    wrapper.split("convex.mutation(").length - 1,
    1,
    "the wrapper must issue exactly ONE mutation",
  );
  assert.ok(call.includes("styleDNA: patch.styleDNA"), "wrapper forwards styleDNA");
  assert.ok(call.includes("qaRubric: patch.qaRubric"), "wrapper forwards qaRubric");
  for (const forbidden of ["name:", "identity:", "pipeline:", "template:", "status:", "family:"]) {
    assert.ok(!call.includes(forbidden), `the updateChannel call must not pass "${forbidden}"`);
  }
  assert.ok(
    !wrapper.includes("familyFromTemplate"),
    "the wrapper must never fall back to a template-derived family",
  );
}

async function main(): Promise<void> {
  await writesOnlyStyleDnaAndRubric();
  patchGuardRejectsWidening();
  await leakySynthCannotWidenPatch();
  familyMustBeExplicit();
  await familyIsNeverInferredFromTemplate();
  await storedFamilyWins();
  await refusesAlreadyGroundedChannel();
  await forceAllowsExplicitReground();
  await dryRunWritesNothing();
  await missingChannelIsASoftRefusal();
  await existingIdentityIsTheInput();
  triggerWrapperForwardsOnlyTwoFields();
  console.log("regroundChannel: all safety tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
