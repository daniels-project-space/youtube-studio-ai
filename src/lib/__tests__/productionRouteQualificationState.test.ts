import assert from "node:assert/strict";

import {
  getCurrentRouteQualificationReceipt,
  getRouteQualificationReceipt,
  recordRoutePreflightReady,
  recordRouteReleaseQualified,
} from "../../../convex/productionRouteQualificationState";
import { buildChannelInceptionPlan } from "@/engine/channelInceptionPlan";
import { createChannelProgramBrief } from "@/engine/channelProgramBrief";
import { resolveChannelProgramRoute } from "@/engine/channelProgramRoute";
import { createChannelShowProfile } from "@/engine/channelShowProfile";
import { designPipeline, type DesignOptions } from "@/engine/designer";
import {
  assessProductionRouteQualification,
  readProductionRouteInceptionEvidence,
  readProductionRoutePlannerEvidence,
  readProductionRouteProvenanceEvidence,
  readProductionRouteQualificationBinding,
  readProductionRouteQualityEvidence,
  readProductionRouteRuntimeEvidence,
  readProductionRouteVisualMatterEvidence,
} from "@/engine/productionRouteQualification";
import { routePreflightQualificationEvidence } from "@/engine/productionRouteQualificationReceipt";
import { buildQualityEvidence } from "@/engine/qualityEvidence";

type Stored = Record<string, unknown> & { _id: string };

const OWNER = "owner_route_qualification";
const CHANNEL = "channel_route_qualification";
const digest = (character: string): string => character.repeat(64);

function identity(role: "owner" | "service", ownerId = OWNER) {
  return {
    subject: role === "owner" ? ownerId : "service:youtube-studio-ai",
    issuer: "https://youtube-studio-ai.local",
    tokenIdentifier: `test|${role}`,
    role,
    owner_id: ownerId,
  };
}

function createMemoryState() {
  const tables = new Map<string, Stored[]>();
  const documents = new Map<string, Stored>([
    [CHANNEL, { _id: CHANNEL, ownerId: OWNER }],
  ]);
  let next = 0;
  const rows = (table: string): Stored[] => {
    const existing = tables.get(table);
    if (existing) return existing;
    const created: Stored[] = [];
    tables.set(table, created);
    return created;
  };
  const db = {
    normalizeId: (_table: string, value: string) => value,
    get: async (id: string) => documents.get(String(id)) ?? null,
    query: (table: string) => ({
      withIndex: (
        _index: string,
        select: (query: { eq: (field: string, value: unknown) => unknown }) => unknown,
      ) => {
        const predicates: Array<readonly [string, unknown]> = [];
        const query = {
          eq(field: string, value: unknown) {
            predicates.push([field, value]);
            return query;
          },
        };
        select(query);
        const matches = () => rows(table).filter((row) =>
          predicates.every(([field, value]) => row[field] === value),
        );
        return {
          unique: async () => {
            const found = matches();
            if (found.length > 1) throw new Error(`test database unique index collision in ${table}`);
            return found[0] ?? null;
          },
          collect: async () => matches(),
        };
      },
    }),
    insert: async (table: string, value: Record<string, unknown>) => {
      const id = `${table}:${++next}`;
      const row = { ...value, _id: id } as Stored;
      rows(table).push(row);
      documents.set(id, row);
      return id;
    },
  };
  return {
    rows,
    context(role: "owner" | "service", ownerId = OWNER) {
      return { auth: { getUserIdentity: async () => identity(role, ownerId) }, db };
    },
  };
}

async function invoke<T>(definition: unknown, context: unknown, args: unknown): Promise<T> {
  return await (definition as {
    _handler: (handlerContext: unknown, handlerArgs: unknown) => Promise<T>;
  })._handler(context, args);
}

async function expectRejected(operation: () => Promise<unknown>, pattern: RegExp): Promise<void> {
  await assert.rejects(operation, pattern);
}

/** Entire fixture is deterministic and provider-free. */
function qualificationFixture() {
  const programBrief = createChannelProgramBrief({
    family: "shorts",
    nicheKey: "educational",
    subcategory: "how-to-tutorials",
    locale: "en",
    concept: "Explain difficult everyday systems in a concise visual story.",
    audience: "Curious adults who want practical explanations without noise.",
    sampleTopics: ["How compound interest compounds over time"],
  });
  const programRoute = resolveChannelProgramRoute(programBrief);
  const options: DesignOptions = {
    family: "shorts",
    nicheKey: "educational",
    programBrief,
    programRoute,
    lengthMinutes: 1,
  };
  const design = designPipeline(options);
  const showProfile = createChannelShowProfile({ programBrief, programRoute, pipeline: design.pipeline });
  const binding = readProductionRouteQualificationBinding({
    programBrief,
    programRoute,
    showProfile,
    pipeline: design.pipeline,
  });
  const planner = readProductionRoutePlannerEvidence({ binding, options });
  const inception = readProductionRouteInceptionEvidence({
    binding,
    plan: buildChannelInceptionPlan({
      ownerId: OWNER,
      channelRef: CHANNEL,
      name: "Clear Systems",
      slug: "clear-systems",
      family: "shorts",
      nicheKey: "educational",
      sourceRevision: "route-qualification-state-test/v1",
      pipelineSourceFingerprint: binding.pipelineFingerprint,
      programBrief,
      programRoute,
      showProfile,
      includeProbe: false,
    }),
  });
  const runtime = readProductionRouteRuntimeEvidence({ binding, planner, pipeline: design.pipeline });
  const quality = readProductionRouteQualityEvidence({
    binding,
    qualityEvidence: buildQualityEvidence({
      episode: {
        lane: { key: "short_form", renderer: "stock_footage" },
        topic: "How compound interest compounds over time",
        title: "Compound Interest, Visualized",
        durationSec: design.episodeLengthSeconds,
        story: { source: "self-contained-short-plan/v1", beatCount: 4, shotCount: 8, coverageRatio: 1 },
      },
      technical: { passed: true, evaluator: "render-validator", evidence: ["Valid master streams."] },
      visual: { score: 8.3, minimumScore: 7, evaluator: "visual-review", evidence: ["Frames meet rubric."] },
      temporal: { passed: true, evaluator: "timing-review", evidence: ["Every beat is legible."] },
      narrative: { passed: true, evaluator: "story-review", evidence: ["Claims map to the teaching sequence."] },
      audio: { score: 8, minimumScore: 7, evaluator: "audio-review", evidence: ["Mix meets rubric."] },
      brand: { passed: true, evaluator: "identity-review", evidence: ["Identity remains coherent."] },
      requiredAudio: { required: true, minimumScore: 7, label: "audio aesthetics" },
    }),
  });
  const provenance = readProductionRouteProvenanceEvidence({
    binding,
    quality,
    claim: {
      version: "video-release-provenance/v1",
      releaseCertificateKey: "owners/test/runs/test/release-certificate.json",
      releaseCertificateFingerprint: digest("a"),
      finalMasterSha256: digest("b"),
      qualityBindingVersion: "final-master-quality-evidence-binding/v1",
      qualityBindingFingerprint: digest("c"),
      qualityEvidenceFingerprint: quality.qualityEvidenceFingerprint,
      contentLaneKey: "short_form",
      renderer: "stock_footage",
      programRoute: {
        routeFingerprint: binding.route.fingerprint,
        family: "shorts",
        contentLaneKey: "short_form",
        programBriefFingerprint: binding.programBrief.fingerprint,
      },
      evidenceStatus: "complete",
      storyMeasurementCoverage: "plan_only",
    },
  });
  const visualMatter = readProductionRouteVisualMatterEvidence({ binding });
  const qualification = assessProductionRouteQualification({
    binding,
    planner,
    inception,
    runtime,
    quality,
    provenance,
    visualMatter,
  });
  assert.equal(qualification.status, "qualified", "fixture must be an actual fully qualified route");
  return { binding, planner, inception, runtime, visualMatter, qualification };
}

async function main() {
  const state = createMemoryState();
  const owner = state.context("owner");
  const service = state.context("service");
  const fixture = qualificationFixture();
  const preflightArgs = {
    ownerId: OWNER,
    channelId: CHANNEL,
    binding: fixture.binding,
    planner: fixture.planner,
    inception: fixture.inception,
    runtime: fixture.runtime,
    visualMatter: fixture.visualMatter,
  };

  await expectRejected(
    () => invoke(recordRoutePreflightReady, owner, preflightArgs),
    /requires the bound studio service identity/i,
  );
  assert.equal(state.rows("productionRouteQualificationReceipts").length, 0);

  const preflightOneId = await invoke<string>(recordRoutePreflightReady, service, preflightArgs);
  assert.equal(
    await invoke<string>(recordRoutePreflightReady, service, preflightArgs),
    preflightOneId,
    "same preflight payload must be idempotent",
  );
  const preflightOne = state.rows("productionRouteQualificationReceipts")[0]!;
  const preflightOneReceipt = preflightOne.receipt as { receiptFingerprint: string };
  assert.equal((preflightOne.receipt as { benchmarkPermission?: string }).benchmarkPermission, "private_benchmark_only");
  const retainedPreflightEvidence = routePreflightQualificationEvidence(preflightOne.receipt);
  assert.equal(
    retainedPreflightEvidence.planner.evidenceFingerprint,
    fixture.planner.evidenceFingerprint,
    "fresh preflights retain their verified planner evidence for a later full private benchmark",
  );
  assert.equal(
    retainedPreflightEvidence.inception.planFingerprint,
    fixture.inception.planFingerprint,
    "preflight evidence retains the exact deterministic inception plan rather than mutable channel inputs",
  );
  const legacyCompactPreflight = structuredClone(preflightOne.receipt) as Record<string, unknown>;
  delete legacyCompactPreflight.qualificationEvidence;
  await expectRejected(
    () => Promise.resolve().then(() => routePreflightQualificationEvidence(legacyCompactPreflight)),
    /receipt fingerprint/i,
  );

  const preflightTwoId = await invoke<string>(recordRoutePreflightReady, service, {
    ...preflightArgs,
    supersedesReceiptFingerprint: preflightOneReceipt.receiptFingerprint,
  });
  assert.notEqual(preflightTwoId, preflightOneId, "a deliberate supersession writes a new immutable row");
  const preflightTwo = state.rows("productionRouteQualificationReceipts")[1]!;
  const preflightTwoReceipt = preflightTwo.receipt as { receiptFingerprint: string };
  const currentPreflight = await invoke<Stored | null>(getCurrentRouteQualificationReceipt, owner, {
    ownerId: OWNER,
    channelId: CHANNEL,
    level: "route_preflight_ready",
    bindingFingerprint: fixture.binding.bindingFingerprint,
  });
  assert.equal(currentPreflight?._id, preflightTwoId, "the superseding row is the only current preflight head");

  await expectRejected(
    () => invoke(recordRouteReleaseQualified, service, {
      ownerId: OWNER,
      channelId: CHANNEL,
      preflightReceiptFingerprint: preflightOneReceipt.receiptFingerprint,
      qualification: fixture.qualification,
    }),
    /current unsuperseded preflight/i,
  );
  await expectRejected(
    () => invoke(recordRouteReleaseQualified, service, {
      ownerId: OWNER,
      channelId: CHANNEL,
      preflightReceiptFingerprint: preflightTwoReceipt.receiptFingerprint,
      qualification: { ...fixture.qualification, automaticReady: false },
    }),
    /qualified status|fingerprint|engine-derived/i,
  );

  const releaseId = await invoke<string>(recordRouteReleaseQualified, service, {
    ownerId: OWNER,
    channelId: CHANNEL,
    preflightReceiptFingerprint: preflightTwoReceipt.receiptFingerprint,
    qualification: fixture.qualification,
  });
  assert.equal(
    await invoke<string>(recordRouteReleaseQualified, service, {
      ownerId: OWNER,
      channelId: CHANNEL,
      preflightReceiptFingerprint: preflightTwoReceipt.receiptFingerprint,
      qualification: fixture.qualification,
    }),
    releaseId,
    "same release qualification payload must be idempotent",
  );
  const release = state.rows("productionRouteQualificationReceipts")[2]!;
  const releaseReceipt = release.receipt as { receiptFingerprint: string; level: string; provenance: { finalMasterSha256: string } };
  assert.equal(releaseReceipt.level, "route_release_qualified");
  assert.equal(release.finalMasterSha256, digest("b"), "only final-master hash is projected into durable state");
  assert.equal((release.receipt as Record<string, unknown>).releaseCertificateKey, undefined, "no certificate path or raw payload is stored");

  await expectRejected(
    () => invoke(recordRouteReleaseQualified, service, {
      ownerId: OWNER,
      channelId: CHANNEL,
      preflightReceiptFingerprint: releaseReceipt.receiptFingerprint,
      qualification: fixture.qualification,
    }),
    /cannot use another release receipt as its preflight/i,
  );
  await expectRejected(
    () => invoke(getRouteQualificationReceipt, state.context("owner", "owner_other"), {
      ownerId: "owner_other",
      channelId: CHANNEL,
      receiptFingerprint: releaseReceipt.receiptFingerprint,
    }),
    /Studio resource access denied/i,
  );

  console.log("PRODUCTION ROUTE QUALIFICATION STATE TESTS PASS");
}

void main();
