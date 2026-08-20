import { ARCHETYPES, type Archetype } from "./archetypes";
import {
  CONTENT_LANE_BY_FAMILY,
  CONTENT_LANE_POLICIES,
  contentLaneForFamily,
  type ContentLane,
  type ContentLaneDefinition,
  type ContentLaneKey,
} from "./contentLane";
import {
  FAMILIES,
  FAMILY_DURATION_CONTRACTS,
  FAMILY_KEYS,
  type Family,
  type FamilyDurationContract,
  type FamilyKey,
} from "./families";

/**
 * A read-only, provider-free view of the contracts that define a channel
 * family. The underlying catalogs deliberately remain independently owned:
 * family identity, visual lane, archetype, and cadence change at different
 * rates. This resolver is the boundary at which those facts must agree.
 */
export const CHANNEL_FAMILY_MANIFEST_VERSION = "channel-family-manifest/v1" as const;

export interface ChannelFamilyManifest {
  version: typeof CHANNEL_FAMILY_MANIFEST_VERSION;
  family: Family;
  archetype: Archetype;
  duration: FamilyDurationContract;
  contentLane: ContentLane;
  contentLanePolicy: ContentLaneDefinition;
}

function hasOwn(value: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function familyKeysFromCatalog(): FamilyKey[] {
  return Object.keys(FAMILIES) as FamilyKey[];
}

function assertExactFamilyKeyedRecord(
  label: string,
  record: object,
  expectedKeys: ReadonlySet<FamilyKey>,
): void {
  const keys = Object.keys(record);
  if (keys.length !== expectedKeys.size || keys.some((key) => !expectedKeys.has(key as FamilyKey))) {
    throw new Error(`channel family manifest drift: ${label} keys no longer match FAMILIES`);
  }
}

function assertDurationContract(family: FamilyKey, contract: FamilyDurationContract | undefined): asserts contract is FamilyDurationContract {
  if (!contract) {
    throw new Error(`channel family manifest drift: ${family} has no duration contract`);
  }
  if (contract.minimumSeconds <= 0 || contract.stepSeconds <= 0) {
    throw new Error(`channel family manifest drift: ${family} has a non-positive duration bound or step`);
  }
  if (contract.minimumSeconds > contract.defaultSeconds || contract.defaultSeconds > contract.maximumSeconds) {
    throw new Error(`channel family manifest drift: ${family} default duration falls outside its bounds`);
  }
  if (contract.inputUnit === "fixed" && (
    contract.minimumSeconds !== contract.defaultSeconds
    || contract.defaultSeconds !== contract.maximumSeconds
  )) {
    throw new Error(`channel family manifest drift: ${family} fixed cadence must have one duration`);
  }
}

function assertFamilyManifestRow(familyKey: FamilyKey): void {
  const family = FAMILIES[familyKey];
  if (!family) {
    throw new Error(`channel family manifest drift: missing family ${familyKey}`);
  }
  if (family.key !== familyKey) {
    throw new Error(`channel family manifest drift: ${familyKey} is declared as ${family.key}`);
  }

  const archetype = ARCHETYPES[family.archetypeKey];
  if (!archetype || archetype.key !== family.archetypeKey) {
    throw new Error(`channel family manifest drift: ${familyKey} references unknown archetype ${family.archetypeKey}`);
  }

  assertDurationContract(familyKey, FAMILY_DURATION_CONTRACTS[familyKey]);

  if (!hasOwn(CONTENT_LANE_BY_FAMILY, familyKey)) {
    throw new Error(`channel family manifest drift: ${familyKey} has no content lane`);
  }
  const laneKey = CONTENT_LANE_BY_FAMILY[familyKey];
  const policy = CONTENT_LANE_POLICIES[laneKey];
  if (!policy) {
    throw new Error(`channel family manifest drift: ${familyKey} maps to unknown content lane ${laneKey}`);
  }
  if (policy.key !== laneKey) {
    throw new Error(`channel family manifest drift: content lane ${laneKey} is declared as ${policy.key}`);
  }
  if (policy.family !== familyKey) {
    throw new Error(
      `channel family manifest drift: content lane ${laneKey} is owned by ${policy.family ?? "no family"}, not ${familyKey}`,
    );
  }
}

/**
 * Fail closed if independently-owned static catalogs no longer describe the
 * same family model. This is intentionally reusable by build admission and
 * catalog tooling without importing blocks, providers, storage, or runtime
 * configuration.
 */
export function assertChannelFamilyManifestIntegrity(): void {
  const catalogKeys = familyKeysFromCatalog();
  const expectedKeys = new Set(FAMILY_KEYS);
  if (catalogKeys.length !== FAMILY_KEYS.length || catalogKeys.some((key) => !expectedKeys.has(key))) {
    throw new Error("channel family manifest drift: FAMILY_KEYS no longer matches FAMILIES");
  }
  assertExactFamilyKeyedRecord("FAMILY_DURATION_CONTRACTS", FAMILY_DURATION_CONTRACTS, expectedKeys);
  assertExactFamilyKeyedRecord("CONTENT_LANE_BY_FAMILY", CONTENT_LANE_BY_FAMILY, expectedKeys);

  const laneKeys = new Set<ContentLaneKey>();
  for (const familyKey of FAMILY_KEYS) {
    assertFamilyManifestRow(familyKey);
    const laneKey = CONTENT_LANE_BY_FAMILY[familyKey];
    if (laneKeys.has(laneKey)) {
      throw new Error(`channel family manifest drift: content lane ${laneKey} belongs to more than one family`);
    }
    laneKeys.add(laneKey);
  }

  for (const laneKey of Object.keys(CONTENT_LANE_POLICIES) as ContentLaneKey[]) {
    const policy = CONTENT_LANE_POLICIES[laneKey];
    if (!policy.family) {
      if (laneKey !== "legacy_unclassified") {
        throw new Error(`channel family manifest drift: non-legacy lane ${laneKey} has no family owner`);
      }
      continue;
    }
    if (CONTENT_LANE_BY_FAMILY[policy.family] !== laneKey) {
      throw new Error(`channel family manifest drift: ${policy.family} does not map back to content lane ${laneKey}`);
    }
  }
}

/**
 * Resolve the authoritative, internally-consistent contract for one family.
 * Unlike `getArchetype`, this never falls back to a different archetype: a
 * catalog mismatch would change the channel's visual language and must stop
 * the caller instead.
 */
export function resolveChannelFamilyManifest(familyKey: FamilyKey): ChannelFamilyManifest {
  assertChannelFamilyManifestIntegrity();
  assertFamilyManifestRow(familyKey);

  const contentLane = contentLaneForFamily(familyKey);
  if (!contentLane) {
    throw new Error(`channel family manifest drift: could not resolve content lane for ${familyKey}`);
  }
  const contentLanePolicy = CONTENT_LANE_POLICIES[CONTENT_LANE_BY_FAMILY[familyKey]];
  if (
    contentLane.key !== contentLanePolicy.key
    || contentLane.family !== familyKey
    || contentLane.primaryRenderer !== contentLanePolicy.primaryRenderer
  ) {
    throw new Error(`channel family manifest drift: resolved content lane disagrees for ${familyKey}`);
  }

  return {
    version: CHANNEL_FAMILY_MANIFEST_VERSION,
    family: FAMILIES[familyKey],
    archetype: ARCHETYPES[FAMILIES[familyKey].archetypeKey],
    duration: FAMILY_DURATION_CONTRACTS[familyKey],
    contentLane,
    contentLanePolicy,
  };
}
