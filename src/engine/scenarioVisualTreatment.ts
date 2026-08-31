/**
 * Sealed visual-treatment policy for fictional AI scenarios.
 *
 * A script disclosure alone is not enough to keep a future renderer from
 * cutting in real stock footage, portraits, or locations. This receipt is
 * derived only from the frozen Program Route and current topic, so every
 * renderer adapter receives the same non-real depiction rules without being
 * able to reinterpret a mutable prompt or channel setting.
 *
 * The receipt is policy/provenance, not a renderer admission, provider call,
 * render result, or publication authorization. A renderer must explicitly
 * implement it before a fictional route may use that renderer.
 */
import { z } from "zod";

import {
  parseChannelProgramRouteRunSeed,
  type ChannelProgramRouteRunSeed,
} from "@/engine/channelProgramRoute";
import {
  SYNTHETIC_SCENARIO_DISCLOSURE,
  SyntheticScenarioContractSchema,
  SyntheticScenarioDisclosureSchema,
  SyntheticScenarioProfileSchema,
  syntheticScenarioContract,
  type SyntheticScenarioContract,
  type SyntheticScenarioDisclosure,
  type SyntheticScenarioProfile,
} from "@/engine/syntheticScenario";
import { canonicalJson } from "@/lib/canonicalJson";
import { sha256Hex } from "@/lib/sha256";

export const SCENARIO_VISUAL_TREATMENT_VERSION = "scenario-visual-treatment/v1" as const;

const sha256 = z.string().regex(/^[a-f0-9]{64}$/i, "expected SHA-256 fingerprint");
const nonEmptyText = (max: number) => z.string().trim().min(1).max(max);

/**
 * These are deliberately restrictive until a renderer has an explicit safe
 * adapter. In particular, a visual source whose normal purpose is to depict
 * real people or places cannot silently become a scenario renderer.
 */
const ScenarioVisualTreatmentPolicySchema = z.object({
  depiction: z.literal("fictional_illustrative_only"),
  realEntityHandling: z.literal("prohibited"),
  realPlaceHandling: z.literal("prohibited"),
  stockFootage: z.literal("prohibited"),
  entityImagery: z.literal("prohibited"),
  factualVisualEvidence: z.literal("prohibited"),
  disclosure: z.object({
    visibleDisclosure: z.literal(SYNTHETIC_SCENARIO_DISCLOSURE),
    spokenOpening: z.literal("required"),
    onScreen: z.literal("per_scene_badge_required"),
  }).strict(),
}).strict();

export const ScenarioVisualTreatmentSchema = z.object({
  version: z.literal(SCENARIO_VISUAL_TREATMENT_VERSION),
  routeFingerprint: sha256,
  programBriefFingerprint: sha256,
  topicFingerprint: sha256,
  scenarioFingerprint: sha256,
  profile: SyntheticScenarioProfileSchema,
  policy: ScenarioVisualTreatmentPolicySchema,
  fingerprint: sha256,
}).strict().superRefine((treatment, ctx) => {
  const expectedScenarioFingerprint = scenarioVisualTreatmentScenarioFingerprint(
    syntheticScenarioContract(treatment.profile),
  );
  if (treatment.scenarioFingerprint !== expectedScenarioFingerprint) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "scenario visual treatment scenario fingerprint does not match its profile",
    });
  }
  if (treatment.fingerprint !== scenarioVisualTreatmentFingerprint(treatment)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "scenario visual treatment fingerprint does not match its payload",
    });
  }
});
export type ScenarioVisualTreatment = z.infer<typeof ScenarioVisualTreatmentSchema>;

/**
 * A compact, exact witness that a separately generated package-art artifact
 * belongs to a sealed fictional-scenario treatment.  Keep this distinct from
 * the full treatment: checkpoints and upload receipts need stable provenance,
 * not another mutable copy of policy prose.
 */
export const SCENARIO_VISUAL_TREATMENT_THUMBNAIL_BINDING_VERSION =
  "scenario-visual-treatment-thumbnail-binding/v1" as const;

export const ScenarioVisualTreatmentThumbnailBindingSchema = z.object({
  version: z.literal(SCENARIO_VISUAL_TREATMENT_THUMBNAIL_BINDING_VERSION),
  routeFingerprint: sha256,
  programBriefFingerprint: sha256,
  topicFingerprint: sha256,
  scenarioFingerprint: sha256,
  profile: SyntheticScenarioProfileSchema,
  treatmentFingerprint: sha256,
  fingerprint: sha256,
}).strict().superRefine((binding, ctx) => {
  if (binding.fingerprint !== scenarioVisualTreatmentThumbnailBindingFingerprint(binding)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "scenario visual treatment thumbnail binding fingerprint does not match its payload",
    });
  }
});

export type ScenarioVisualTreatmentThumbnailBinding =
  z.infer<typeof ScenarioVisualTreatmentThumbnailBindingSchema>;

/**
 * The completed thumbnail's byte- and QA-bound witness.  This is deliberately
 * separate from FinalMasterReleaseCertificate: the final-master certificate
 * seals video bytes, while upload verifies this package-art receipt against
 * the thumbnail bytes immediately before connector work.
 */
export const SCENARIO_VISUAL_TREATMENT_THUMBNAIL_PROVENANCE_VERSION =
  "scenario-visual-treatment-thumbnail-provenance/v1" as const;

export const ScenarioVisualTreatmentThumbnailProvenanceSchema = z.object({
  version: z.literal(SCENARIO_VISUAL_TREATMENT_THUMBNAIL_PROVENANCE_VERSION),
  binding: ScenarioVisualTreatmentThumbnailBindingSchema,
  thumbnailRequestHash: sha256,
  qaRequestHash: sha256,
  artifactSha256: sha256,
  visualTreatmentCompliant: z.literal(true),
  fingerprint: sha256,
}).strict().superRefine((provenance, ctx) => {
  if (provenance.fingerprint !== scenarioVisualTreatmentThumbnailProvenanceFingerprint(provenance)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "scenario visual treatment thumbnail provenance fingerprint does not match its payload",
    });
  }
});

export type ScenarioVisualTreatmentThumbnailProvenance =
  z.infer<typeof ScenarioVisualTreatmentThumbnailProvenanceSchema>;

/** Shared, renderer-neutral policy projection for any thumbnail adapter. */
export interface ScenarioVisualTreatmentThumbnailDirection {
  readonly artDirectionRules: readonly string[];
  readonly providerPromptRequirements: readonly string[];
  readonly reviewCriteria: readonly string[];
  /** Applied by the local compositor, never delegated to the image provider. */
  readonly disclosureBadge: string;
}

export interface ScenarioVisualTreatmentBinding {
  readonly routeFingerprint: string;
  readonly programBriefFingerprint: string;
  readonly topic: string;
  readonly profile: SyntheticScenarioProfile;
}

function treatmentIdentity(
  treatment: Omit<ScenarioVisualTreatment, "fingerprint"> | ScenarioVisualTreatment,
): Omit<ScenarioVisualTreatment, "fingerprint"> {
  return {
    version: treatment.version,
    routeFingerprint: treatment.routeFingerprint,
    programBriefFingerprint: treatment.programBriefFingerprint,
    topicFingerprint: treatment.topicFingerprint,
    scenarioFingerprint: treatment.scenarioFingerprint,
    profile: treatment.profile,
    policy: treatment.policy,
  };
}

function fictionalScenarioProfileForRoute(
  route: ChannelProgramRouteRunSeed,
  subject: string,
): SyntheticScenarioProfile {
  if (
    route.directives.claimMode !== "fictional_scenario_no_external_claims" ||
    !route.syntheticScenarioProfile
  ) {
    throw new Error(`${subject}: frozen channel program route is not a fictional synthetic-scenario route`);
  }
  return route.syntheticScenarioProfile;
}

function isFictionalScenarioRoute(route: ChannelProgramRouteRunSeed): boolean {
  return (
    route.directives.claimMode === "fictional_scenario_no_external_claims" &&
    route.syntheticScenarioProfile !== undefined
  );
}

export function scenarioVisualTreatmentTopicFingerprint(topic: unknown): string {
  return sha256Hex(nonEmptyText(500).parse(topic));
}

export function scenarioVisualTreatmentScenarioFingerprint(scenario: SyntheticScenarioContract): string {
  return sha256Hex(canonicalJson(SyntheticScenarioContractSchema.parse(scenario)));
}

export function scenarioVisualTreatmentFingerprint(
  treatment: Omit<ScenarioVisualTreatment, "fingerprint"> | ScenarioVisualTreatment,
): string {
  return sha256Hex(canonicalJson(treatmentIdentity(treatment)));
}

function scenarioVisualTreatmentThumbnailBindingIdentity(
  binding: Omit<ScenarioVisualTreatmentThumbnailBinding, "fingerprint"> |
    ScenarioVisualTreatmentThumbnailBinding,
): Omit<ScenarioVisualTreatmentThumbnailBinding, "fingerprint"> {
  return {
    version: binding.version,
    routeFingerprint: binding.routeFingerprint,
    programBriefFingerprint: binding.programBriefFingerprint,
    topicFingerprint: binding.topicFingerprint,
    scenarioFingerprint: binding.scenarioFingerprint,
    profile: binding.profile,
    treatmentFingerprint: binding.treatmentFingerprint,
  };
}

export function scenarioVisualTreatmentThumbnailBindingFingerprint(
  binding: Omit<ScenarioVisualTreatmentThumbnailBinding, "fingerprint"> |
    ScenarioVisualTreatmentThumbnailBinding,
): string {
  return sha256Hex(canonicalJson(scenarioVisualTreatmentThumbnailBindingIdentity(binding)));
}

export function createScenarioVisualTreatmentThumbnailBinding(
  treatment: unknown,
): ScenarioVisualTreatmentThumbnailBinding {
  const parsed = ScenarioVisualTreatmentSchema.parse(treatment);
  const unsigned: Omit<ScenarioVisualTreatmentThumbnailBinding, "fingerprint"> = {
    version: SCENARIO_VISUAL_TREATMENT_THUMBNAIL_BINDING_VERSION,
    routeFingerprint: parsed.routeFingerprint,
    programBriefFingerprint: parsed.programBriefFingerprint,
    topicFingerprint: parsed.topicFingerprint,
    scenarioFingerprint: parsed.scenarioFingerprint,
    profile: parsed.profile,
    treatmentFingerprint: parsed.fingerprint,
  };
  return ScenarioVisualTreatmentThumbnailBindingSchema.parse({
    ...unsigned,
    fingerprint: scenarioVisualTreatmentThumbnailBindingFingerprint(unsigned),
  });
}

export function assertScenarioVisualTreatmentThumbnailBinding(input: {
  readonly binding: unknown;
  readonly treatment: unknown;
  readonly consumer: string;
}): ScenarioVisualTreatmentThumbnailBinding {
  const binding = ScenarioVisualTreatmentThumbnailBindingSchema.parse(input.binding);
  const expected = createScenarioVisualTreatmentThumbnailBinding(input.treatment);
  if (canonicalJson(binding) !== canonicalJson(expected)) {
    throw new Error(`${input.consumer}: thumbnail treatment binding does not match the sealed scenario visual treatment`);
  }
  return binding;
}

interface ScenarioVisualTreatmentThumbnailProvenanceIdentity {
  version: typeof SCENARIO_VISUAL_TREATMENT_THUMBNAIL_PROVENANCE_VERSION;
  binding: Omit<ScenarioVisualTreatmentThumbnailBinding, "fingerprint">;
  thumbnailRequestHash: string;
  qaRequestHash: string;
  artifactSha256: string;
  visualTreatmentCompliant: true;
}

function scenarioVisualTreatmentThumbnailProvenanceIdentity(
  provenance: Omit<ScenarioVisualTreatmentThumbnailProvenance, "fingerprint"> |
    ScenarioVisualTreatmentThumbnailProvenance,
): ScenarioVisualTreatmentThumbnailProvenanceIdentity {
  return {
    version: provenance.version,
    binding: scenarioVisualTreatmentThumbnailBindingIdentity(provenance.binding),
    thumbnailRequestHash: provenance.thumbnailRequestHash,
    qaRequestHash: provenance.qaRequestHash,
    artifactSha256: provenance.artifactSha256,
    visualTreatmentCompliant: provenance.visualTreatmentCompliant,
  };
}

export function scenarioVisualTreatmentThumbnailProvenanceFingerprint(
  provenance: Omit<ScenarioVisualTreatmentThumbnailProvenance, "fingerprint"> |
    ScenarioVisualTreatmentThumbnailProvenance,
): string {
  return sha256Hex(canonicalJson(scenarioVisualTreatmentThumbnailProvenanceIdentity(provenance)));
}

export function createScenarioVisualTreatmentThumbnailProvenance(input: {
  readonly treatment: unknown;
  readonly binding?: unknown;
  readonly thumbnailRequestHash: unknown;
  readonly qaRequestHash: unknown;
  readonly artifactSha256: unknown;
  readonly visualTreatmentCompliant: true;
}): ScenarioVisualTreatmentThumbnailProvenance {
  const binding = input.binding === undefined
    ? createScenarioVisualTreatmentThumbnailBinding(input.treatment)
    : assertScenarioVisualTreatmentThumbnailBinding({
        binding: input.binding,
        treatment: input.treatment,
        consumer: "thumbnail provenance",
      });
  const unsigned: Omit<ScenarioVisualTreatmentThumbnailProvenance, "fingerprint"> = {
    version: SCENARIO_VISUAL_TREATMENT_THUMBNAIL_PROVENANCE_VERSION,
    binding,
    thumbnailRequestHash: sha256.parse(input.thumbnailRequestHash),
    qaRequestHash: sha256.parse(input.qaRequestHash),
    artifactSha256: sha256.parse(input.artifactSha256),
    visualTreatmentCompliant: true,
  };
  return ScenarioVisualTreatmentThumbnailProvenanceSchema.parse({
    ...unsigned,
    fingerprint: scenarioVisualTreatmentThumbnailProvenanceFingerprint(unsigned),
  });
}

export function assertScenarioVisualTreatmentThumbnailProvenance(input: {
  readonly provenance: unknown;
  readonly treatment: unknown;
  readonly thumbnailArtifactSha256?: unknown;
  readonly consumer: string;
}): ScenarioVisualTreatmentThumbnailProvenance {
  const provenance = ScenarioVisualTreatmentThumbnailProvenanceSchema.parse(input.provenance);
  assertScenarioVisualTreatmentThumbnailBinding({
    binding: provenance.binding,
    treatment: input.treatment,
    consumer: input.consumer,
  });
  if (
    input.thumbnailArtifactSha256 !== undefined &&
    provenance.artifactSha256 !== sha256.parse(input.thumbnailArtifactSha256)
  ) {
    throw new Error(`${input.consumer}: thumbnail bytes do not match their sealed scenario visual treatment provenance`);
  }
  return provenance;
}

/**
 * Dispatcher-safe thumbnail proof: a delayed publish has the frozen route and
 * package-art bytes, but not the mutable stage store.  This route-level check
 * therefore confirms the sealed provenance is self-valid, byte-bound, and
 * belongs to the exact fictional route/profile before a retry may apply the
 * thumbnail.  Full topic/treatment validation remains the upload_draft gate.
 */
export function assertScenarioVisualTreatmentThumbnailProvenanceForRoute(input: {
  readonly provenance: unknown;
  readonly route: unknown;
  readonly thumbnailArtifactSha256?: unknown;
  readonly consumer: string;
  readonly operation: string;
}): ScenarioVisualTreatmentThumbnailProvenance | undefined {
  const route = parseChannelProgramRouteRunSeed(input.route);
  if (!isFictionalScenarioRoute(route)) return undefined;
  if (!route.requiredBlocks.includes("scenario_visual_treatment")) {
    throw new Error(
      `${input.consumer}: legacy fictional route remains readable but cannot ${input.operation} ` +
        "without a sealed scenario visual treatment",
    );
  }
  if (input.provenance === undefined) {
    throw new Error(`${input.consumer}: fictional thumbnail lacks sealed scenario visual treatment provenance`);
  }
  const provenance = ScenarioVisualTreatmentThumbnailProvenanceSchema.parse(input.provenance);
  if (
    input.thumbnailArtifactSha256 !== undefined &&
    provenance.artifactSha256 !== sha256.parse(input.thumbnailArtifactSha256)
  ) {
    throw new Error(`${input.consumer}: thumbnail bytes do not match their sealed scenario visual treatment provenance`);
  }
  const binding = provenance.binding;
  if (
    binding.routeFingerprint !== route.routeFingerprint ||
    binding.programBriefFingerprint !== route.programBriefFingerprint ||
    binding.profile !== route.syntheticScenarioProfile
  ) {
    throw new Error(`${input.consumer}: thumbnail provenance does not belong to the frozen fictional route`);
  }
  return provenance;
}

/**
 * Derive the immutable binding from a frozen run seed. This is the only
 * creation seam; mutable block parameters are intentionally not accepted.
 */
export function scenarioVisualTreatmentBindingFromRoute(input: {
  readonly route: unknown;
  readonly topic: unknown;
}): ScenarioVisualTreatmentBinding {
  const route = parseChannelProgramRouteRunSeed(input.route);
  if (!route.requiredBlocks.includes("scenario_visual_treatment")) {
    throw new Error("scenario visual treatment is not admitted by the frozen channel program route");
  }
  return {
    routeFingerprint: route.routeFingerprint,
    programBriefFingerprint: route.programBriefFingerprint,
    topic: nonEmptyText(500).parse(input.topic),
    profile: fictionalScenarioProfileForRoute(route, "scenario visual treatment"),
  };
}

export function createScenarioVisualTreatmentFromRoute(input: {
  readonly route: unknown;
  readonly topic: unknown;
}): ScenarioVisualTreatment {
  const binding = scenarioVisualTreatmentBindingFromRoute(input);
  const scenario = syntheticScenarioContract(binding.profile);
  const unsigned: Omit<ScenarioVisualTreatment, "fingerprint"> = {
    version: SCENARIO_VISUAL_TREATMENT_VERSION,
    routeFingerprint: binding.routeFingerprint,
    programBriefFingerprint: binding.programBriefFingerprint,
    topicFingerprint: scenarioVisualTreatmentTopicFingerprint(binding.topic),
    scenarioFingerprint: scenarioVisualTreatmentScenarioFingerprint(scenario),
    profile: binding.profile,
    policy: {
      depiction: "fictional_illustrative_only",
      realEntityHandling: "prohibited",
      realPlaceHandling: "prohibited",
      stockFootage: "prohibited",
      entityImagery: "prohibited",
      factualVisualEvidence: "prohibited",
      disclosure: {
        visibleDisclosure: SYNTHETIC_SCENARIO_DISCLOSURE,
        spokenOpening: "required",
        onScreen: "per_scene_badge_required",
      },
    },
  };
  return ScenarioVisualTreatmentSchema.parse({
    ...unsigned,
    fingerprint: scenarioVisualTreatmentFingerprint(unsigned),
  });
}

/**
 * Validate a treatment at a consumer boundary. `topic` is optional because a
 * few legacy visual blocks do not carry it in their declared input ABI; the
 * creator, scene compiler, and final QA all supply it for the full binding.
 */
export function assertScenarioVisualTreatmentBinding(input: {
  readonly treatment: unknown;
  readonly route: unknown;
  readonly scenario?: unknown;
  readonly disclosure?: unknown;
  readonly topic?: unknown;
}): ScenarioVisualTreatment {
  const treatment = ScenarioVisualTreatmentSchema.parse(input.treatment);
  const route = parseChannelProgramRouteRunSeed(input.route);
  const profile = fictionalScenarioProfileForRoute(route, "scenario visual treatment");
  if (!route.requiredBlocks.includes("scenario_visual_treatment")) {
    throw new Error("scenario visual treatment is not admitted by the frozen channel program route");
  }
  if (treatment.routeFingerprint !== route.routeFingerprint) {
    throw new Error("scenario visual treatment route fingerprint does not match the frozen channel program route");
  }
  if (treatment.programBriefFingerprint !== route.programBriefFingerprint) {
    throw new Error("scenario visual treatment program brief fingerprint does not match the frozen channel program route");
  }
  if (treatment.profile !== profile) {
    throw new Error("scenario visual treatment profile does not match the frozen channel program route");
  }
  if (input.topic !== undefined && treatment.topicFingerprint !== scenarioVisualTreatmentTopicFingerprint(input.topic)) {
    throw new Error("scenario visual treatment topic fingerprint does not match the current topic");
  }
  const expectedScenario = syntheticScenarioContract(profile);
  if (treatment.scenarioFingerprint !== scenarioVisualTreatmentScenarioFingerprint(expectedScenario)) {
    throw new Error("scenario visual treatment scenario fingerprint does not match the frozen channel program route");
  }
  if (input.scenario !== undefined) {
    const scenario = SyntheticScenarioContractSchema.parse(input.scenario);
    if (scenarioVisualTreatmentScenarioFingerprint(scenario) !== treatment.scenarioFingerprint) {
      throw new Error("scenario visual treatment does not match the active synthetic scenario");
    }
  }
  if (input.disclosure !== undefined) {
    const disclosure = SyntheticScenarioDisclosureSchema.parse(input.disclosure);
    if (
      disclosure.profile !== treatment.profile ||
      disclosure.visibleDisclosure !== treatment.policy.disclosure.visibleDisclosure ||
      disclosure.openingVerified !== true
    ) {
      throw new Error("scenario visual treatment does not match the verified synthetic-scenario disclosure");
    }
  }
  return treatment;
}

/**
 * Resolve an optional treatment without making historical route-less work
 * unreadable. Every current fictional route contains the treatment block;
 * therefore a current route cannot bypass it, while a pre-treatment frozen
 * route remains explicitly legacy rather than silently reinterpreted.
 */
export function resolveScenarioVisualTreatmentForRoute(input: {
  readonly treatment: unknown;
  readonly route: unknown;
  readonly scenario?: unknown;
  readonly disclosure?: unknown;
  readonly topic?: unknown;
  readonly consumer: string;
}): ScenarioVisualTreatment | undefined {
  if (input.route === undefined) {
    if (input.treatment !== undefined) {
      throw new Error(`${input.consumer}: scenario visual treatment requires a frozen channel program route`);
    }
    return undefined;
  }
  const route = parseChannelProgramRouteRunSeed(input.route);
  if (!isFictionalScenarioRoute(route)) {
    if (input.treatment !== undefined) {
      throw new Error(`${input.consumer}: a non-fictional route cannot carry a scenario visual treatment`);
    }
    return undefined;
  }
  // A preserved legacy seed predates the treatment block. It remains readable
  // and resumable, but cannot be mistaken for a current route with the guard
  // missing because all current fictional routes include the block.
  if (!route.requiredBlocks.includes("scenario_visual_treatment")) {
    if (input.treatment !== undefined) {
      throw new Error(`${input.consumer}: legacy fictional route does not admit a scenario visual treatment`);
    }
    return undefined;
  }
  if (input.treatment === undefined) {
    throw new Error(`${input.consumer}: fictional route requires its sealed scenario visual treatment`);
  }
  if (input.scenario === undefined) {
    throw new Error(`${input.consumer}: fictional route requires its sealed synthetic scenario contract`);
  }
  return assertScenarioVisualTreatmentBinding({
    treatment: input.treatment,
    route,
    scenario: input.scenario,
    disclosure: input.disclosure,
    topic: input.topic,
  });
}

/**
 * Historical fictional seeds without the treatment block remain readable so
 * completed evidence can be inspected, but they must never be treated as
 * ordinary nonfiction when an operation would generate, certify, or publish
 * new visual/package-art output.  Call this at irreversible visual-artifact
 * boundaries; use the permissive resolver above only for legacy reads.
 */
export function resolveScenarioVisualTreatmentForNewVisualArtifact(input: {
  readonly treatment: unknown;
  readonly route: unknown;
  readonly scenario?: unknown;
  readonly disclosure?: unknown;
  readonly topic?: unknown;
  readonly consumer: string;
  readonly operation: string;
}): ScenarioVisualTreatment | undefined {
  if (input.route !== undefined) {
    const route = parseChannelProgramRouteRunSeed(input.route);
    if (
      isFictionalScenarioRoute(route) &&
      !route.requiredBlocks.includes("scenario_visual_treatment")
    ) {
      throw new Error(
        `${input.consumer}: legacy fictional route remains readable but cannot ${input.operation} ` +
          "without a sealed scenario visual treatment",
      );
    }
  }
  return resolveScenarioVisualTreatmentForRoute(input);
}

/** Reusable reviewer wording; it adds no review invocation or model spend. */
export function scenarioVisualTreatmentReviewCriteria(
  treatment: ScenarioVisualTreatment,
): readonly string[] {
  return [
    `The on-screen badge "${treatment.policy.disclosure.visibleDisclosure}" must remain visible in every fictional scenario scene.`,
    "Scenario visuals must read as clearly illustrative or abstracted fictional constructs, never documentary evidence or a real-world simulation.",
    "Reject real-person portraits, real-place depictions, stock footage, entity imagery, factual charts, or factual geographic evidence presented as the fictional scenario.",
  ];
}

/**
 * Package-art is generated independently of the scene compiler, so it gets a
 * first-class projection of the same sealed policy rather than a handwritten
 * fictional prompt.  The local disclosure is deliberately separate from the
 * image-provider request: provider pixels remain text-free and the compositor
 * owns exact wording.
 */
export function scenarioVisualTreatmentThumbnailDirection(
  treatment: ScenarioVisualTreatment,
): ScenarioVisualTreatmentThumbnailDirection {
  return {
    artDirectionRules: [
      "This is a disclosed fictional AI scenario. Treat every subject, setting, and consequence as an original illustrative or abstract construct, never documentary evidence or a real-world simulation.",
      "Do not use or imply a recognizable real person, real place, brand, organization, product, public institution, or other real-world entity.",
      "Do not use stock/editorial photography, photojournalistic framing, factual charts, maps, or geographic evidence. The thumbnail must read immediately as non-real illustrative package art.",
    ],
    providerPromptRequirements: [
      "MANDATORY SCENARIO VISUAL TREATMENT: original clearly illustrative or abstract fictional artwork only; never a photoreal documentary image or real-world simulation.",
      "PROHIBITED: recognizable real people, real places, brands, organizations, products, entities, stock/editorial photography, factual charts, maps, or geographic evidence.",
    ],
    reviewCriteria: [
      "Treatment compliance: pass only when the thumbnail is clearly fictional illustrative/abstract package art, not documentary or photoreal real-world evidence.",
      "Reject recognizable real-person portraits, real-place depictions, brands/entities/products, stock/editorial photography, factual charts, maps, or factual geographic evidence.",
      `The local disclosure badge must exactly read "${treatment.policy.disclosure.visibleDisclosure}" and remain legible.`,
    ],
    disclosureBadge: treatment.policy.disclosure.visibleDisclosure,
  };
}

/** The thumbnail reviewer must make an explicit, positive policy finding. */
export function scenarioVisualTreatmentThumbnailQaPassed(verdict: unknown): boolean {
  return Boolean(
    verdict &&
    typeof verdict === "object" &&
    (verdict as { visualTreatmentCompliant?: unknown }).visualTreatmentCompliant === true,
  );
}

/** Kept exported for consumers/tests that need a concrete disclosure type. */
export type { SyntheticScenarioDisclosure };
