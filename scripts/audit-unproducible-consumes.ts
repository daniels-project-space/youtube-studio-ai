/**
 * UNPRODUCIBLE-CONSUMES AUDIT — a "required" input that nothing in the registry
 * can produce.
 *
 * The pipeline compiler binds a consumer to its producer like this:
 *
 *     const producer = producerByArtifact.get(key);
 *     if (producer) inputBindings[key] = `${producer}:${key}`;
 *
 * If there is no producer it simply does not bind, and nothing is thrown. The
 * one exception is a crew artifact, which does get a "has no producer" refusal.
 * So `requiredConsumes` does NOT mean "the compiler guarantees this is present";
 * it means "the store Proxy will permit this read". The block then reads
 * `undefined` at run time.
 *
 * That is correct and intended for a RUN SEED — a value placed in the store
 * before the first block, like a human-pasted evidence draft or the frozen
 * channel program route. No block produces those, and no block ever will.
 *
 * It is NOT correct for an artifact that a block is supposed to produce, because
 * then "required" is a promise the compiler never checks. This audit separates
 * the two the only way that can be done mechanically: an input that no
 * registered block produces is either a seed or a mistake, so it lists them and
 * asks. A seed is identified by having a declared artifact schema and no
 * producer anywhere — the same shape a mistake has, which is exactly why this
 * needs a human answer rather than a threshold.
 *
 * THE FIRST RUN FOUND FOUR. One was real and is fixed; three remain and are the
 * baseline:
 *
 *   editorialEvidencePacketInput   FIXED. The block, its contract, its artifact
 *                                  schema and its unit tests all existed, and
 *                                  RunPipelineInput had no field for it — so
 *                                  outside its tests it could only ever throw.
 *                                  Worse, familyPipelineConnectivity.test listed
 *                                  the key among "the exact `*Input` fields
 *                                  runPipeline accepts", so the check whose job
 *                                  is catching unreachable inputs was seeding
 *                                  the one input that could not arrive. The list
 *                                  now lives in src/lib/payloadSeedInputs.ts and
 *                                  a compile-time assertion forbids the drift.
 *   casefileEvidenceShotMapInput   CORRECT AS IT STANDS. The block deliberately
 *                                  auto-drafts when no human draft was pasted,
 *                                  so absence is handled rather than fatal.
 *                                  "Required" overstates it, but moving it to
 *                                  optionalConsumes would change where the
 *                                  compiler auto-inserts the block, which is a
 *                                  real behaviour change for a naming nicety.
 *   cinematicCaseDirection         INTENTIONAL PRIVATE-RELEASE GAP. Neither
 *   cinematicSequenceEditorialReview  has a producer or general run-payload
 *                                  field. Their draft/finalize blocks are
 *                                  explicitly private-review-only; adding a
 *                                  human-signature payload to ordinary pipeline
 *                                  intake is an authorization change, not a
 *                                  wiring fix. These remain visible below and
 *                                  are not counted as seeds or executable routes.
 */
import { registerAllBlocks } from "@/engine/blocks";
import { catalogExecutionBinding } from "@/engine/goldenExecution";
import { allManifests } from "@/engine/registry";
import { PAYLOAD_SEED_INPUT_KEYS } from "@/lib/payloadSeedInputs";

/**
 * Inputs placed in the store before the first block runs, so having no producing
 * block is correct rather than missing.
 *
 * The operator packets are IMPORTED from the one list runPipeline seeds from,
 * not re-typed. The first version of this audit hand-listed them and three of
 * the names — syntheticScenarioInput, serializedProgramEpisodeContextInput,
 * learningContractInput — did not exist anywhere in the codebase. Guessed
 * excuses in an allowlist do not merely add noise; they HIDE findings, which is
 * the same defect this audit is looking for, committed inside the audit.
 */
const KNOWN_SEEDS = new Set<string>([
  ...PAYLOAD_SEED_INPUT_KEYS,
  // Channel identity and route, frozen into the store by runPipeline's seed.
  "topic",
  "niche",
  "channelName",
  "persona",
  "palette",
  "styleDNA",
  "contentLane",
  "channelProgramRoute",
  // Set under a constant key by narrativeSeriesRunAdmissionSeed, which is why a
  // literal search for it finds nothing in runPipeline.
  "narrativeSeriesRunSelector",
]);

const PRIVATE_RELEASE_INPUTS = new Map<string, { catalogKey: string; reason: string }>([
  ["cinematic_case_sequence_draft:cinematicCaseDirection", {
    catalogKey: "cinematic-case-sequence",
    reason: "caller-authored direction has no general pipeline intake",
  }],
  ["cinematic_case_sequence_finalize:cinematicSequenceEditorialReview", {
    catalogKey: "cinematic-case-sequence",
    reason: "human editor signature has no general pipeline intake",
  }],
]);

function main(): void {
  registerAllBlocks();
  const manifests = allManifests();

  const produced = new Set<string>();
  for (const m of manifests) {
    for (const key of Object.keys(m.produces ?? {})) produced.add(key);
    for (const key of Object.keys(m.optionalProduces ?? {})) produced.add(key);
  }

  const unknown: { block: string; key: string }[] = [];
  const seeds: { block: string; key: string }[] = [];
  const privateReleaseGaps: { block: string; key: string; reason: string }[] = [];
  let requiredTotal = 0;

  for (const m of manifests) {
    for (const key of Object.keys(m.consumes ?? {})) {
      requiredTotal++;
      if (produced.has(key)) continue;
      if (KNOWN_SEEDS.has(key)) {
        seeds.push({ block: m.id, key });
        continue;
      }
      const external = PRIVATE_RELEASE_INPUTS.get(`${m.id}:${key}`);
      if (external) {
        const binding = catalogExecutionBinding(external.catalogKey);
        if (binding.kind === "registered-private-release" && binding.executableIds.includes(m.id)) {
          privateReleaseGaps.push({ block: m.id, key, reason: external.reason });
          continue;
        }
      }
      unknown.push({ block: m.id, key });
    }
  }

  unknown.sort((a, b) => a.key.localeCompare(b.key) || a.block.localeCompare(b.block));
  privateReleaseGaps.sort((a, b) => a.key.localeCompare(b.key) || a.block.localeCompare(b.block));
  console.log(`required consumes across all blocks: ${requiredTotal}`);
  console.log(`required, but no registered block produces them: ${unknown.length + seeds.length + privateReleaseGaps.length}`);
  console.log(`  of those, recognised run seeds: ${seeds.length}`);
  console.log(`  intentional private-release gaps: ${privateReleaseGaps.length}`);
  console.log(`  unaccounted for: ${unknown.length}\n`);
  for (const f of unknown) console.log(`  ${f.block} requires ${f.key}, which nothing produces`);
  for (const f of privateReleaseGaps) {
    console.log(`  PRIVATE ${f.block} requires ${f.key}: ${f.reason}`);
  }
  if (!unknown.length) console.log("  none unaccounted");
  console.log(
    `\nAn unaccounted-for entry is either a seed nobody listed here, or a block promising\n` +
      `an input the compiler will never supply — in which case it reads undefined at run\n` +
      `time and "required" was never true.`,
  );
  console.log(`AUDIT_FINDINGS ${unknown.length}`);
}

main();
