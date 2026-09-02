import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { importJWK, jwtVerify } from "jose";
import ts from "typescript";
import { api } from "../../../convex/_generated/api";
import { upsertCompetitors } from "../../../convex/competitors";
import {
  advanceSelfHealGeneration,
  assertRemoteChildWaitLease,
  beginRemoteChildWait,
  claimExecutionLease,
  claimInvocationSnapshot,
  completeRun,
  deferSerializedProgramEpisodeRetry,
  listDueSerializedProgramEpisodeRetries,
  markLeaseRecoveryDispatched,
  markPublishContinuationQueued,
  preparePublishContinuation,
  reapExpiredRunLeases,
  recordPublishContinuationEnqueueFailure,
  renewRemoteChildWaitLease,
  heartbeatExecutionLease,
  updateRun,
} from "../../../convex/runs";
import { upsertRunStage } from "../../../convex/runStages";
import { pipelineInvocationSha256 } from "../pipelineInvocationHash";
import type { PipelineInvocationSnapshot } from "../pipelineInvocationSnapshot";
import { RUN_QUEUE_LEASE_MS } from "../runLease";
import { upsertDatabank, upsertNiche } from "../../../convex/seo";
import {
  claimNext as claimSerializedProgramEpisode,
  complete as completeSerializedProgramEpisode,
  release as releaseSerializedProgramEpisode,
} from "../../../convex/serializedProgramEpisodes";
import { studioAuthorizationForTests } from "../../../convex/studioFunctions";
import {
  createOperatorSessionToken,
  hasValidOperatorSession,
  STUDIO_SESSION_COOKIE,
} from "../operatorSession";
import {
  getStudioConvexPublicJwk,
  getStudioConvexPublicJwks,
  issueStudioConvexToken,
  STUDIO_CONVEX_AUDIENCE,
  STUDIO_CONVEX_ISSUER,
} from "../studioConvexAuth";
import { StudioConvexHttpClient } from "../studioConvexHttpClient";

function identity(role: "viewer" | "owner" | "service", ownerId: string) {
  return {
    subject:
      role === "owner"
        ? ownerId
        : role === "viewer"
          ? `viewer:${ownerId}`
          : "service:youtube-studio-ai",
    issuer: STUDIO_CONVEX_ISSUER,
    tokenIdentifier: `${STUDIO_CONVEX_ISSUER}|${role}`,
    role,
    owner_id: ownerId,
  };
}

function fakeCtx(options: {
  role?: "viewer" | "owner" | "service";
  identityOwner?: string;
  documentOwner?: string;
}) {
  const owner = options.identityOwner ?? "owner_a";
  return {
    auth: {
      getUserIdentity: async () => identity(options.role ?? "owner", owner),
    },
    db: {
      normalizeId: (_table: string, value: string) => value,
      get: async () => ({ ownerId: options.documentOwner ?? owner }),
      query: () => ({
        withIndex: () => ({
          first: async () => ({ ownerId: options.documentOwner ?? owner }),
          collect: async () => [{ ownerId: options.documentOwner ?? owner }],
        }),
      }),
    },
  };
}

const serializedEpisodeRouteFingerprint = "a".repeat(64);
const serializedEpisodeSeriesTitle = "Atomic Questions";
const serializedEpisodeSeriesIdentity = [
  "serialized_program_episode/v1",
  serializedEpisodeRouteFingerprint,
  encodeURIComponent(serializedEpisodeSeriesTitle),
  "2",
].join("/");
const serializedEpisodeTopic = "Atomic Questions — Part 1 of 2: The first useful question";
const serializedEpisodeBaseArgs = {
  ownerId: "owner_a",
  channelId: "channel_a",
  runId: "run_a",
  seriesIdentity: serializedEpisodeSeriesIdentity,
  routeFingerprint: serializedEpisodeRouteFingerprint,
  routeRunSeedFingerprint: "b".repeat(64),
  seriesTitle: serializedEpisodeSeriesTitle,
  seriesCount: 2,
};
const serializedEpisodeCompleteArgs = {
  ...serializedEpisodeBaseArgs,
  claimToken: "serial-claim-token",
  episodeNumber: 1,
  topic: serializedEpisodeTopic,
  topicMemoryKey: `${serializedEpisodeSeriesIdentity}/episode/1/${encodeURIComponent(serializedEpisodeTopic)}`,
  storyState: { newPlotBeat: "The first useful question opens the arc." },
};

function serializedEpisodeCtx(options: {
  role: "owner" | "service";
  runChannelId?: string;
  liveClaimLeaseExpiresAt?: number;
}) {
  const writes = { insert: 0, patch: 0, delete: 0 };
  const channel = {
    ownerId: "owner_a",
    identity: {
      programRoute: {
        fingerprint: serializedEpisodeRouteFingerprint,
        family: "narrated_stock",
        directives: { claimMode: "editorial_framing" },
        serializedProgram: {
          version: "serialized_program/v1",
          seriesTitle: serializedEpisodeSeriesTitle,
          seriesCount: 2,
        },
      },
    },
  };
  return {
    writes,
    ctx: {
      auth: {
        getUserIdentity: async () => identity(options.role, "owner_a"),
      },
      db: {
        normalizeId: (_table: string, value: string) => value,
        get: async (value: string) => {
          if (value === "channel_a") return channel;
          if (value === "run_a") {
            return { ownerId: "owner_a", channelId: options.runChannelId ?? "channel_a" };
          }
          return null;
        },
        query: (table: string) => {
          if (
            table === "serializedProgramEpisodes" &&
            options.liveClaimLeaseExpiresAt !== undefined
          ) {
            return {
              withIndex: () => ({
                collect: async () => [{
                  status: "claimed",
                  leaseExpiresAt: options.liveClaimLeaseExpiresAt,
                }],
              }),
            };
          }
          throw new Error("serialized episode authorization/run binding must fail before any query");
        },
        insert: async () => {
          writes.insert += 1;
          return "unexpected-insert";
        },
        patch: async () => {
          writes.patch += 1;
        },
        delete: async () => {
          writes.delete += 1;
        },
      },
    },
  };
}

function serializedEpisodeRetryRunCtx(options: {
  retryAt: number;
  status?: "running" | "queued" | "failed";
  leaseOwner?: string;
  leaseRecoveryPending?: boolean;
  scheduledPlan?: {
    planItemId: string;
    topic: string;
    title: string;
    thumbnailKey: string;
    scheduledAt?: number;
    preparation?: {
      version: "plan-week-preparation/inputs-v1";
      manifestKey: string;
      manifestSha256: string;
    };
    mutateItem?: boolean;
  };
}) {
  const writes: Array<Record<string, unknown>> = [];
  const status = options.status ?? "running";
  const snapshot: PipelineInvocationSnapshot = {
    version: 1,
    ownerId: "owner_a",
    runId: "run_a",
    channelId: "channel_a",
    source: "channel",
    entries: [{ block: "topic_select" }],
    seedStore: {},
    budgetUsd: 0,
    keyPrefix: "owner_a/channel_a/run_a",
    remoteBlocks: [],
    defaultRetries: 0,
    compilationFingerprint: "a".repeat(64),
    compilationPolicyId: "test",
    compilationPolicyVersion: "1",
    compilationModules: [],
    compilationCapabilities: [],
    reservedMaxCostUsd: 0,
  };
  const run = {
    _id: "run_a",
    ownerId: "owner_a",
    channelId: "channel_a",
    status,
    leaseOwner: options.leaseOwner ?? "trigger-run-a",
    executionAttempts: status === "running" ? 1 : undefined,
    heartbeatAt: status === "running" ? Date.now() : undefined,
    leaseExpiresAt: status === "running" ? Date.now() + 60_000 : undefined,
    costTotal: 0,
    pipelineInvocationSnapshot: snapshot,
    pipelineInvocationSha256: pipelineInvocationSha256(snapshot),
    serializedProgramEpisodeRetryAt:
      status === "running" ? undefined : options.retryAt,
    serializedProgramEpisodeRetryAttempts: status === "running" ? undefined : 1,
    leaseRecoveryPending: options.leaseRecoveryPending,
    ...(options.scheduledPlan
      ? {
          planItemId: options.scheduledPlan.planItemId,
          plannedTopic: options.scheduledPlan.topic,
          plannedTitle: options.scheduledPlan.title,
          plannedThumbnailKey: options.scheduledPlan.thumbnailKey,
          ...(options.scheduledPlan.scheduledAt !== undefined
            ? { plannedPublishAt: options.scheduledPlan.scheduledAt }
            : {}),
          ...(options.scheduledPlan.preparation
            ? {
                plannedPreparationVersion: options.scheduledPlan.preparation.version,
                plannedPreparationManifestKey: options.scheduledPlan.preparation.manifestKey,
                plannedPreparationManifestSha256: options.scheduledPlan.preparation.manifestSha256,
              }
            : {}),
        }
      : {}),
  } as Record<string, unknown>;
  const channel = { ownerId: "owner_a" };
  const planItem = options.scheduledPlan
    ? {
        _id: options.scheduledPlan.planItemId,
        ownerId: "owner_a",
        channelId: "channel_a",
        scheduledRunId: "run_a",
        status: "ready",
        topic: options.scheduledPlan.mutateItem
          ? `${options.scheduledPlan.topic} mutated`
          : options.scheduledPlan.topic,
        title: options.scheduledPlan.title,
        thumbnailKey: options.scheduledPlan.thumbnailKey,
        ...(options.scheduledPlan.scheduledAt !== undefined
          ? { scheduledAt: options.scheduledPlan.scheduledAt }
          : {}),
        ...(options.scheduledPlan.preparation
          ? {
              preparationVersion: options.scheduledPlan.preparation.version,
              preparationManifestKey: options.scheduledPlan.preparation.manifestKey,
              preparationManifestSha256: options.scheduledPlan.preparation.manifestSha256,
            }
          : {}),
      }
    : null;
  return {
    run,
    writes,
    ctx: {
      auth: { getUserIdentity: async () => identity("service", "owner_a") },
      db: {
        normalizeId: (_table: string, value: string) => value,
        get: async (value: string) => {
          if (value === "channel_a") return channel;
          if (value === "run_a") return run;
          if (planItem && value === planItem._id) return planItem;
          return null;
        },
        query: (_table: string) => ({
          withIndex: (_name: string, range: (q: {
            eq: (field: string, value: unknown) => unknown;
            gt: (field: string, value: unknown) => unknown;
            lte: (field: string, value: unknown) => unknown;
          }) => unknown) => {
            const filters: Array<{ field: string; value: unknown; op: "eq" | "gt" | "lte" }> = [];
            const q = {
              eq: (field: string, value: unknown) => {
                filters.push({ field, value, op: "eq" });
                return q;
              },
              gt: (field: string, value: unknown) => {
                filters.push({ field, value, op: "gt" });
                return q;
              },
              lte: (field: string, value: unknown) => {
                filters.push({ field, value, op: "lte" });
                return q;
              },
            };
            range(q);
            return {
              take: async (_limit: number) =>
                filters.every((filter) =>
                  filter.op === "eq"
                    ? run[filter.field] === filter.value
                    : filter.op === "gt"
                      ? filter.value === undefined
                        ? run[filter.field] !== undefined
                        : typeof run[filter.field] === "number" &&
                          typeof filter.value === "number" &&
                          (run[filter.field] as number) > filter.value
                    : typeof run[filter.field] === "number" &&
                      typeof filter.value === "number" &&
                      (run[filter.field] as number) <= filter.value,
                )
                  ? [run]
                  : [],
            };
          },
        }),
        patch: async (_id: string, patch: Record<string, unknown>) => {
          writes.push(patch);
          Object.assign(run, patch);
        },
      },
    },
  };
}

async function expectRejected(work: Promise<unknown>, pattern: RegExp) {
  await assert.rejects(work, pattern);
}

async function invokeConvexDefinition(definition: unknown, ctx: unknown, args: unknown) {
  return await (definition as {
    _handler: (handlerContext: unknown, handlerArgs: unknown) => Promise<unknown>;
  })._handler(ctx, args);
}

function ownerDeniedWithoutWrites() {
  let writes = 0;
  return {
    writes: () => writes,
    ctx: {
      auth: { getUserIdentity: async () => identity("owner", "owner_a") },
      // The authenticated mutation wrapper performs normal owner scoping
      // reads before the handler can enforce its service-only boundary.
      db: {
        normalizeId: (_table: string, value: string) => value,
        get: async () => ({ ownerId: "owner_a", channelId: "channel_a" }),
        patch: async () => {
          writes += 1;
        },
        insert: async () => {
          writes += 1;
          return "unexpected-insert";
        },
        delete: async () => {
          writes += 1;
        },
      },
    },
  };
}

function serializedEpisodeRetryBatchCtx(rows: Array<Record<string, unknown>>) {
  return {
    auth: { getUserIdentity: async () => identity("service", "owner_a") },
    db: {
      get: async (_value: string) => null,
      query: (_table: string) => ({
        withIndex: (_name: string, range: (q: {
          eq: (field: string, value: unknown) => unknown;
          gt: (field: string, value: unknown) => unknown;
          lte: (field: string, value: unknown) => unknown;
        }) => unknown) => {
          const filters: Array<{ field: string; value: unknown; op: "eq" | "gt" | "lte" }> = [];
          const q = {
            eq: (field: string, value: unknown) => {
              filters.push({ field, value, op: "eq" });
              return q;
            },
            gt: (field: string, value: unknown) => {
              filters.push({ field, value, op: "gt" });
              return q;
            },
            lte: (field: string, value: unknown) => {
              filters.push({ field, value, op: "lte" });
              return q;
            },
          };
          range(q);
          return {
            take: async (limit: number) => rows.filter((row) =>
              filters.every((filter) => {
                const actual = row[filter.field];
                return filter.op === "eq"
                  ? actual === filter.value
                  : filter.op === "gt"
                    ? filter.value === undefined
                      ? actual !== undefined
                      : typeof actual === "number" &&
                        typeof filter.value === "number" &&
                        actual > filter.value
                  : typeof actual === "number" &&
                    typeof filter.value === "number" &&
                    actual <= filter.value;
              }),
            ).slice(0, limit),
          };
        },
      }),
    },
  };
}

async function filesBelow(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const target = path.join(directory, entry.name);
      return entry.isDirectory() ? filesBelow(target) : [target];
    }),
  );
  return nested.flat();
}

function importedValues(source: string, moduleName: string): string[] {
  const ast = ts.createSourceFile("audit.ts", source, ts.ScriptTarget.Latest, true);
  const names: string[] = [];
  for (const statement of ast.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    if (!ts.isStringLiteral(statement.moduleSpecifier)) continue;
    if (statement.moduleSpecifier.text !== moduleName) continue;
    const clause = statement.importClause;
    if (!clause || clause.isTypeOnly) continue;
    const bindings = clause.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) {
      if (!element.isTypeOnly) names.push(element.propertyName?.text ?? element.name.text);
    }
  }
  return names;
}

async function main() {
  const priorPrivateKey = process.env.STUDIO_CONVEX_JWT_PRIVATE_KEY;
  const priorPreviousJwks = process.env.STUDIO_CONVEX_PREVIOUS_PUBLIC_JWKS;
  const priorSessionSecret = process.env.STUDIO_SESSION_SECRET;
  try {
    delete process.env.STUDIO_CONVEX_JWT_PRIVATE_KEY;
    assert.throws(
      () => getStudioConvexPublicJwk(),
      /STUDIO_CONVEX_JWT_PRIVATE_KEY is required/,
      "missing signing configuration must fail clearly and closed",
    );
    const priorConsoleError = console.error;
    console.error = () => undefined;
    const { GET: getJwks } = await import("../../app/api/auth/convex-jwks/route");
    const unavailableJwks = await getJwks();
    console.error = priorConsoleError;
    assert.equal(unavailableJwks.status, 503);
    assert.deepEqual(await unavailableJwks.json(), {
      error: "Convex JWKS is not configured",
    });

    const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    const activePrivatePem = privateKey
      .export({ type: "pkcs8", format: "pem" })
      .toString();
    process.env.STUDIO_CONVEX_JWT_PRIVATE_KEY = activePrivatePem;

    const jwk = getStudioConvexPublicJwk();
    assert.equal(jwk.kty, "EC");
    assert.equal(jwk.crv, "P-256");
    assert.equal(jwk.d, undefined, "JWKS must never expose private key material");
    const readyJwks = await getJwks();
    assert.equal(readyJwks.status, 200);
    const readyJwksBody = (await readyJwks.json()) as { keys: Array<{ d?: unknown }> };
    assert.equal(readyJwksBody.keys.length, 1);
    assert.equal(readyJwksBody.keys[0]?.d, undefined);
    process.env.STUDIO_CONVEX_PREVIOUS_PUBLIC_JWKS = JSON.stringify([jwk]);
    assert.equal(
      getStudioConvexPublicJwks().length,
      1,
      "the active key must be deduplicated from the overlap keyring",
    );
    const { privateKey: rotatedPrivateKey } = generateKeyPairSync("ec", {
      namedCurve: "P-256",
    });
    process.env.STUDIO_CONVEX_JWT_PRIVATE_KEY = rotatedPrivateKey
      .export({ type: "pkcs8", format: "pem" })
      .toString();
    const overlapKeys = getStudioConvexPublicJwks();
    assert.equal(overlapKeys.length, 2);
    assert.notEqual(overlapKeys[0]?.kid, overlapKeys[1]?.kid);
    process.env.STUDIO_CONVEX_JWT_PRIVATE_KEY = activePrivatePem;
    process.env.STUDIO_CONVEX_PREVIOUS_PUBLIC_JWKS = JSON.stringify([{ ...jwk, d: "leak" }]);
    assert.throws(
      () => getStudioConvexPublicJwks(),
      /must never include private key material/,
    );
    delete process.env.STUDIO_CONVEX_PREVIOUS_PUBLIC_JWKS;

    const ownerToken = issueStudioConvexToken({ role: "owner", ownerId: "owner_a" });
    const verificationKey = await importJWK(jwk, "ES256");
    const verifiedOwner = await jwtVerify(ownerToken.token, verificationKey, {
      algorithms: ["ES256"],
      issuer: STUDIO_CONVEX_ISSUER,
      audience: STUDIO_CONVEX_AUDIENCE,
    });
    assert.equal(verifiedOwner.payload.sub, "owner_a");
    assert.equal(verifiedOwner.payload.owner_id, "owner_a");
    assert.equal(verifiedOwner.payload.role, "owner");

    const viewerToken = issueStudioConvexToken({
      role: "viewer",
      ownerId: "owner_a",
    });
    const verifiedViewer = await jwtVerify(viewerToken.token, verificationKey, {
      algorithms: ["ES256"],
      issuer: STUDIO_CONVEX_ISSUER,
      audience: STUDIO_CONVEX_AUDIENCE,
    });
    assert.equal(verifiedViewer.payload.sub, "viewer:owner_a");
    assert.equal(verifiedViewer.payload.owner_id, "owner_a");
    assert.equal(verifiedViewer.payload.role, "viewer");

    await assert.doesNotReject(() =>
      studioAuthorizationForTests.requireStudioServiceIdentity(
        fakeCtx({ role: "service", identityOwner: "owner_a" }) as never,
        "owner_a",
        "evidence write",
      ),
    );
    await expectRejected(
      studioAuthorizationForTests.requireStudioServiceIdentity(
        fakeCtx({ role: "owner", identityOwner: "owner_a" }) as never,
        "owner_a",
        "evidence write",
      ),
      /requires the bound studio service identity/,
    );
    await expectRejected(
      studioAuthorizationForTests.requireStudioServiceIdentity(
        fakeCtx({ role: "service", identityOwner: "owner_b" }) as never,
        "owner_a",
        "evidence write",
      ),
      /requires the bound studio service identity/,
    );
    const ownerOnlyContext = fakeCtx({ role: "owner", identityOwner: "owner_a" });
    await expectRejected(
      invokeConvexDefinition(claimInvocationSnapshot, ownerOnlyContext, {
        ownerId: "owner_a",
        channelId: "channel_a",
        runId: "run_a",
        snapshot: {},
        sha256: "a".repeat(64),
      }),
      /pipeline invocation snapshot claim requires the bound studio service identity/,
    );

    // An owner session can legitimately read its run, including its monotonic
    // execution token, but it must never consume that token to mutate the
    // worker-owned execution state. The normal Convex wrapper first performs
    // ownership reads, but these entry points reject before their handler can
    // write, so a browser cannot turn a known fence into an expensive repair
    // generation, remote-child receipt, terminal result, or stage update.
    const workerRunArgs = {
      ownerId: "owner_a",
      channelId: "channel_a",
      runId: "run_a",
      leaseOwner: "trigger-run-a",
      executionLeaseToken: 1,
    };
    const workerMutationOwnerDenials = [
      ["claim execution lease", claimExecutionLease, {
        ownerId: "owner_a",
        channelId: "channel_a",
        runId: "run_a",
        leaseOwner: "trigger-run-a",
        now: Date.now(),
      }],
      ["heartbeat execution lease", heartbeatExecutionLease, {
        ...workerRunArgs,
        now: Date.now(),
      }],
      ["self-heal generation advance", advanceSelfHealGeneration, {
        ...workerRunArgs,
        expectedGeneration: 0,
        rerunBlocks: ["qa_visual"],
        reason: "test repair",
      }],
      ["remote child wait start", beginRemoteChildWait, {
        ...workerRunArgs,
        blockId: "novita_render_video",
        dispatchKey: "dispatch-a",
        waitUntil: Date.now() + 60_000,
        deadline: Date.now() + 120_000,
      }],
      ["remote child execution fence", assertRemoteChildWaitLease, {
        ...workerRunArgs,
        blockId: "novita_render_video",
        dispatchKey: "dispatch-a",
        now: Date.now(),
      }],
      ["remote child wait renewal", renewRemoteChildWaitLease, {
        ...workerRunArgs,
        blockId: "novita_render_video",
        dispatchKey: "dispatch-a",
        purpose: "poll",
        now: Date.now(),
      }],
      ["lease recovery dispatch", markLeaseRecoveryDispatched, {
        ownerId: "owner_a",
        channelId: "channel_a",
        runId: "run_a",
      }],
      ["publish continuation preparation", preparePublishContinuation, {
        ...workerRunArgs,
        intentId: "intent_a",
        artifactId: "artifact_a",
        youtubeVideoId: "youtube_a",
        preparedAt: Date.now(),
      }],
      ["publish continuation queue receipt", markPublishContinuationQueued, {
        ...workerRunArgs,
        intentId: "intent_a",
        artifactId: "artifact_a",
        youtubeVideoId: "youtube_a",
        triggerRunId: "trigger-publish-a",
        queuedAt: Date.now(),
        enqueueAttempt: 1,
      }],
      ["publish continuation enqueue failure", recordPublishContinuationEnqueueFailure, {
        ...workerRunArgs,
        intentId: "intent_a",
        artifactId: "artifact_a",
        youtubeVideoId: "youtube_a",
        error: "test enqueue error",
        failedAt: Date.now(),
        enqueueAttempt: 1,
      }],
      ["execution-fenced completion", completeRun, {
        ...workerRunArgs,
        finishedAt: Date.now(),
        costTotal: 0,
      }],
      ["run stage write", upsertRunStage, {
        ...workerRunArgs,
        block: "qa_visual",
        status: "ok",
      }],
    ] as const;
    for (const [name, definition, args] of workerMutationOwnerDenials) {
      const ownerAttempt = ownerDeniedWithoutWrites();
      await expectRejected(
        invokeConvexDefinition(definition, ownerAttempt.ctx, args),
        /requires the bound studio service identity/,
      );
      assert.equal(
        ownerAttempt.writes(),
        0,
        `owner ${name} denial must occur before any handler write`,
      );
    }

    // `updateRun` deliberately keeps its no-fence legacy/operator path.
    // The fenced worker path must still be service-only, and fails before its
    // first possible patch even though it reads the record to obtain ownerId.
    let fencedUpdatePatches = 0;
    const fencedUpdateOwnerCtx = {
      auth: { getUserIdentity: async () => identity("owner", "owner_a") },
      db: {
        normalizeId: (_table: string, value: string) => value,
        get: async () => ({ ownerId: "owner_a" }),
        patch: async () => {
          fencedUpdatePatches += 1;
        },
      },
    };
    await expectRejected(
      invokeConvexDefinition(updateRun, fencedUpdateOwnerCtx, {
        runId: "run_a",
        status: "failed",
        leaseOwner: "trigger-run-a",
        executionLeaseToken: 1,
      }),
      /execution-fenced run update requires the bound studio service identity/,
    );
    assert.equal(fencedUpdatePatches, 0, "owner fenced run update must not patch the run");
    await expectRejected(
      invokeConvexDefinition(upsertNiche, ownerOnlyContext, {
        ownerId: "owner_a",
        niche: "stoicism",
        topTitlePatterns: [],
        powerWords: [],
        optimalTitleLen: 55,
        topTags: [],
        avgViewsTop50: 1,
        medianViewsTop50: 1,
        thumbnailStyleGuide: { dominantColors: [], hasTextOverlayPct: 0, notes: "" },
      }),
      /research evidence write requires the bound studio service identity/,
    );
    await expectRejected(
      invokeConvexDefinition(upsertDatabank, ownerOnlyContext, {
        ownerId: "owner_a",
        niche: "stoicism",
        titleTemplates: [],
        tagClusters: [],
        thumbnailRules: [],
        hookPatterns: [],
        competitorGaps: [],
      }),
      /SEO evidence write requires the bound studio service identity/,
    );
    await expectRejected(
      invokeConvexDefinition(upsertCompetitors, ownerOnlyContext, {
        ownerId: "owner_a",
        niche: "stoicism",
        competitors: [],
      }),
      /competitor evidence write requires the bound studio service identity/,
    );

    // Serialized episode lifecycle mutations are service-only even though a
    // normal owner may know a route fingerprint and a channel id.  Prove the
    // denial happens before any row can be inserted, patched, or deleted.
    for (const [name, definition, args] of [
      ["claim", claimSerializedProgramEpisode, serializedEpisodeBaseArgs],
      ["complete", completeSerializedProgramEpisode, serializedEpisodeCompleteArgs],
      ["release", releaseSerializedProgramEpisode, {
        ...serializedEpisodeBaseArgs,
        claimToken: "serial-claim-token",
      }],
    ] as const) {
      const ownerAttempt = serializedEpisodeCtx({ role: "owner" });
      await expectRejected(
        invokeConvexDefinition(definition, ownerAttempt.ctx, args),
        /serialized program episode .* requires the bound studio service identity/,
      );
      assert.deepEqual(
        ownerAttempt.writes,
        { insert: 0, patch: 0, delete: 0 },
        `owner ${name} denial must leave serialized episode storage untouched`,
      );
    }

    // A service token alone is insufficient: every lifecycle operation must
    // bind its real run to the same owner and channel before query/write work.
    for (const [name, definition, args] of [
      ["claim", claimSerializedProgramEpisode, serializedEpisodeBaseArgs],
      ["complete", completeSerializedProgramEpisode, serializedEpisodeCompleteArgs],
      ["release", releaseSerializedProgramEpisode, {
        ...serializedEpisodeBaseArgs,
        claimToken: "serial-claim-token",
      }],
    ] as const) {
      const crossChannelAttempt = serializedEpisodeCtx({
        role: "service",
        runChannelId: "channel_other",
      });
      await expectRejected(
        invokeConvexDefinition(definition, crossChannelAttempt.ctx, args),
        /run is missing or not bound to the requested owner and channel/,
      );
      assert.deepEqual(
        crossChannelAttempt.writes,
        { insert: 0, patch: 0, delete: 0 },
        `cross-channel run ${name} must be rejected before serialized episode storage mutates`,
      );
    }

    const liveLeaseExpiry = Date.now() + 300_000;
    const busyClaim = await invokeConvexDefinition(
      claimSerializedProgramEpisode,
      serializedEpisodeCtx({ role: "service", liveClaimLeaseExpiresAt: liveLeaseExpiry }).ctx,
      serializedEpisodeBaseArgs,
    ) as { kind: string; retryAfterMs?: number };
    assert.equal(busyClaim.kind, "busy");
    assert.ok(
      (busyClaim.retryAfterMs ?? 0) > 250_000,
      "a live serialized lease returns its remaining durable delay, not a one-second polling hint",
    );
    assert.ok(
      (busyClaim.retryAfterMs ?? Number.POSITIVE_INFINITY) <= 301_000,
      "the returned busy delay remains inside the bounded durable retry window",
    );

    // The durable busy receipt releases only its owning execution lease, keeps
    // the frozen run queued until its exact not-before time, and is idempotent
    // if Trigger's enqueue response is lost.
    const retryAt = Date.now() + 10_000;
    const deferral = serializedEpisodeRetryRunCtx({ retryAt });
    const deferred = await invokeConvexDefinition(
      deferSerializedProgramEpisodeRetry,
      deferral.ctx,
      {
        ownerId: "owner_a",
        channelId: "channel_a",
        runId: "run_a",
        leaseOwner: "trigger-run-a",
        executionLeaseToken: 1,
        retryAt,
        costTotal: 0,
        error: "topic_select: serialized_program/v1 episode claim is in progress",
      },
    ) as { retryAt: number; attempt: number };
    assert.deepEqual(deferred, { retryAt, attempt: 1 });
    assert.equal(deferral.run.status, "queued");
    assert.equal(deferral.run.serializedProgramEpisodeRetryAt, retryAt);
    assert.equal(deferral.run.leaseOwner, undefined);
    assert.equal(deferral.writes.length, 1, "the first busy receipt releases exactly one current execution lease");
    const replayedDeferral = await invokeConvexDefinition(
      deferSerializedProgramEpisodeRetry,
      deferral.ctx,
      {
        ownerId: "owner_a",
        channelId: "channel_a",
        runId: "run_a",
        leaseOwner: "trigger-run-a",
        executionLeaseToken: 1,
        retryAt,
        costTotal: 0,
        error: "topic_select: serialized_program/v1 episode claim is in progress",
      },
    ) as { retryAt: number; attempt: number };
    assert.deepEqual(replayedDeferral, deferred, "lost enqueue recovery must reuse the exact durable retry receipt");
    assert.equal(deferral.writes.length, 1, "lost enqueue recovery must not write a second retry attempt");

    const earlyClaim = serializedEpisodeRetryRunCtx({ retryAt, status: "queued" });
    await expectRejected(
      invokeConvexDefinition(claimExecutionLease, earlyClaim.ctx, {
        ownerId: "owner_a",
        channelId: "channel_a",
        runId: "run_a",
        leaseOwner: "trigger-run-early",
        now: Date.now(),
      }),
      /retry is not claimable before/,
    );
    assert.equal(earlyClaim.writes.length, 0, "an early delayed task cannot seize the run or reach a provider stage");

    // A lost Trigger enqueue is recovered from the durable receipt only when
    // it is due, immutable, and still bound to the exact planned-run payload.
    // This query is read-only: the execution lease remains the only place a
    // task can consume/release the receipt.
    const dueNow = Date.now();
    const dueRetry = serializedEpisodeRetryRunCtx({
      retryAt: dueNow - 1,
      status: "queued",
      scheduledPlan: {
        planItemId: "plan_a",
        topic: "A sealed episode topic",
        title: "A sealed episode title",
        thumbnailKey: "plans/a/thumb.png",
        scheduledAt: dueNow + 86_400_000,
        preparation: {
          version: "plan-week-preparation/inputs-v1",
          manifestKey: "owner/owner_a/channel/economics/plan-batches/batch_a/items/plan_a/preparation/inputs.json",
          manifestSha256: "b".repeat(64),
        },
      },
    });
    const dueReceipts = await invokeConvexDefinition(
      listDueSerializedProgramEpisodeRetries,
      dueRetry.ctx,
      { ownerId: "owner_a", now: dueNow },
    ) as Array<Record<string, unknown>>;
    assert.equal(dueReceipts.length, 1, "a due lost-enqueue receipt is available to the minute dispatcher");
    assert.deepEqual(dueReceipts[0]?.scheduledPlan, {
      planItemId: "plan_a",
      topic: "A sealed episode topic",
      title: "A sealed episode title",
      thumbnailKey: "plans/a/thumb.png",
      thumbnailSource: "planner_artwork",
      scheduledAt: dueNow + 86_400_000,
      preparation: {
        version: "plan-week-preparation/inputs-v1",
        manifestKey: "owner/owner_a/channel/economics/plan-batches/batch_a/items/plan_a/preparation/inputs.json",
        manifestSha256: "b".repeat(64),
      },
    });
    assert.equal(dueRetry.writes.length, 0, "outbox listing must not mutate a receipt before claimExecutionLease");
    await expectRejected(
      invokeConvexDefinition(
        listDueSerializedProgramEpisodeRetries,
        {
          ...dueRetry.ctx,
          auth: { getUserIdentity: async () => identity("owner", "owner_a") },
        },
        { ownerId: "owner_a", now: dueNow },
      ),
      /requires the bound studio service identity/,
    );

    const futureRetry = serializedEpisodeRetryRunCtx({
      retryAt: dueNow + 60_000,
      status: "queued",
    });
    assert.deepEqual(
      await invokeConvexDefinition(listDueSerializedProgramEpisodeRetries, futureRetry.ctx, {
        ownerId: "owner_a",
        now: dueNow,
      }),
      [],
      "the dispatcher does not pre-dispatch a not-before receipt",
    );

    const expiredQueuedRetry = serializedEpisodeRetryRunCtx({
      retryAt: dueNow - 1,
      status: "failed",
      leaseRecoveryPending: true,
    });
    const recoveredReceipts = await invokeConvexDefinition(
      listDueSerializedProgramEpisodeRetries,
      expiredQueuedRetry.ctx,
      { ownerId: "owner_a", now: dueNow },
    ) as Array<Record<string, unknown>>;
    assert.equal(
      recoveredReceipts.length,
      1,
      "a reaped queued receipt resumes through this same outbox instead of waiting for the six-hour scheduler",
    );

    const reapedRetry = serializedEpisodeRetryRunCtx({
      retryAt: dueNow - 1,
      status: "queued",
    });
    Object.assign(reapedRetry.run, {
      startedAt: dueNow - RUN_QUEUE_LEASE_MS - 1,
      heartbeatAt: dueNow - RUN_QUEUE_LEASE_MS - 1,
      leaseExpiresAt: dueNow - 1,
    });
    await invokeConvexDefinition(reapExpiredRunLeases, reapedRetry.ctx, {});
    assert.equal(reapedRetry.run.status, "failed");
    assert.equal(reapedRetry.run.leaseRecoveryPending, true);
    assert.equal(reapedRetry.run.serializedProgramEpisodeRetryAt, dueNow - 1,
      "reaping must retain the serial outbox timestamp rather than minting a replacement run");
    const reapedDueReceipts = await invokeConvexDefinition(
      listDueSerializedProgramEpisodeRetries,
      reapedRetry.ctx,
      { ownerId: "owner_a", now: dueNow },
    ) as Array<Record<string, unknown>>;
    assert.equal(
      reapedDueReceipts.length,
      1,
      "the outbox dispatcher recovers a reaped queued receipt using its same frozen run",
    );

    const makeFairnessRow = (runId: string, status: "queued" | "failed") => {
      const fixture = serializedEpisodeRetryRunCtx({
        retryAt: dueNow - 1,
        status,
        ...(status === "failed" ? { leaseRecoveryPending: true } : {}),
      });
      const snapshot = fixture.run.pipelineInvocationSnapshot as PipelineInvocationSnapshot;
      snapshot.runId = runId;
      fixture.run._id = runId;
      fixture.run.pipelineInvocationSha256 = pipelineInvocationSha256(snapshot);
      return fixture.run;
    };
    const fairRows = [
      ...Array.from({ length: 25 }, (_value, index) => makeFairnessRow(`queued-${index}`, "queued")),
      makeFairnessRow("reaped-failed", "failed"),
    ];
    const fairDue = await invokeConvexDefinition(
      listDueSerializedProgramEpisodeRetries,
      serializedEpisodeRetryBatchCtx(fairRows),
      { ownerId: "owner_a", now: dueNow },
    ) as Array<Record<string, unknown>>;
    assert.equal(fairDue.length, 26);
    assert.ok(
      fairDue.some((receipt) => receipt.runId === "reaped-failed"),
      "a queued backlog cannot starve a fenced failed/reaped same-run recovery",
    );

    const unsafeRecoveredRetry = serializedEpisodeRetryRunCtx({
      retryAt: dueNow - 1,
      status: "failed",
      leaseRecoveryPending: false,
    });
    assert.deepEqual(
      await invokeConvexDefinition(listDueSerializedProgramEpisodeRetries, unsafeRecoveredRetry.ctx, {
        ownerId: "owner_a",
        now: dueNow,
      }),
      [],
      "a failed row without a recovery fence cannot be dispatched from the outbox",
    );

    const mutatedPlanRetry = serializedEpisodeRetryRunCtx({
      retryAt: dueNow - 1,
      status: "queued",
      scheduledPlan: {
        planItemId: "plan_a",
        topic: "A sealed episode topic",
        title: "A sealed episode title",
        thumbnailKey: "plans/a/thumb.png",
        mutateItem: true,
      },
    });
    assert.deepEqual(
      await invokeConvexDefinition(listDueSerializedProgramEpisodeRetries, mutatedPlanRetry.ctx, {
        ownerId: "owner_a", now: dueNow,
      }),
      [],
      "a changed plan item cannot be silently re-admitted by the retry dispatcher",
    );

    await studioAuthorizationForTests.authorizeStudioCall(
      fakeCtx({}) as never,
      { ownerId: "owner_a" },
    );
    await studioAuthorizationForTests.authorizeStudioCall(
      fakeCtx({ role: "viewer" }) as never,
      { ownerId: "owner_a" },
      "query",
    );
    await expectRejected(
      studioAuthorizationForTests.authorizeStudioCall(
        fakeCtx({ role: "viewer" }) as never,
        { ownerId: "owner_a" },
        "mutation",
      ),
      /viewer mutations are not permitted/,
    );
    await expectRejected(
      studioAuthorizationForTests.authorizeStudioCall(
        fakeCtx({ role: "viewer" }) as never,
        { ownerId: "owner_a", secret: "must-remain-server-only" },
        "query",
      ),
      /viewer privileged query denied/,
    );
    await expectRejected(
      studioAuthorizationForTests.authorizeStudioCall(
        fakeCtx({ role: "viewer" }) as never,
        { limit: 100 },
        "query",
      ),
      /not owner scoped/,
    );
    await expectRejected(
      studioAuthorizationForTests.authorizeStudioCall(
        fakeCtx({}) as never,
        { ownerId: "owner_b" },
      ),
      /owner access denied/,
    );
    await expectRejected(
      studioAuthorizationForTests.authorizeStudioCall(
        fakeCtx({ documentOwner: "owner_b" }) as never,
        { ownerId: "owner_a", channelId: "channel_b" },
      ),
      /resource access denied/,
    );
    await expectRejected(
      studioAuthorizationForTests.authorizeStudioCall(
        fakeCtx({ documentOwner: "owner_b" }) as never,
        { groupId: "shared-group" },
      ),
      /group access denied/,
    );
    await studioAuthorizationForTests.authorizeStudioCall(
      fakeCtx({ role: "service" }) as never,
      { secret: "redacted-service-operation" },
    );
    await expectRejected(
      studioAuthorizationForTests.authorizeStudioCall(fakeCtx({}) as never, {
        secret: "cannot-turn-an-owner-session-into-a-fleet-scan",
      }),
      /not owner scoped/,
    );

    const convexFiles = (await filesBelow(path.resolve("convex"))).filter(
      (file) => file.endsWith(".ts") && !file.includes("/_generated/"),
    );
    for (const file of convexFiles) {
      if (file.endsWith("/studioFunctions.ts")) continue;
      const source = await readFile(file, "utf8");
      const rawBuilders = importedValues(source, "./_generated/server").filter(
        (name) => name === "query" || name === "mutation",
      );
      if (file.endsWith("/runs.ts") && rawBuilders.length > 0) {
        // The rollout probe is deliberately public and data-free: the same
        // endpoint must return a challenge-bound denial to an unsigned client
        // and a grant to the signed service client. Keep this exception exact
        // so it cannot become a back door to application data.
        assert.deepEqual(rawBuilders, ["query"]);
        assert.equal(
          [...source.matchAll(/=\s*publicQuery\s*\(/g)].length,
          1,
          "runs.ts may expose only the single data-free auth probe",
        );
        const probeSource = source.slice(
          source.indexOf("export const verifyAuthBoundary"),
          source.indexOf("export const createRun"),
        );
        assert.match(probeSource, /verifyAuthBoundary\s*=\s*publicQuery\s*\(/);
        assert.match(probeSource, /ctx\.auth\.getUserIdentity\(\)/);
        assert.doesNotMatch(
          probeSource,
          /ctx\.(?:db|storage|scheduler)|\.query\(|\.mutation\(|fetch\s*\(/,
          "the public auth probe must remain data-free and side-effect-free",
        );
        continue;
      }
      assert.deepEqual(
        rawBuilders,
        [],
        `${path.relative(process.cwd(), file)} bypasses the authenticated Convex builders`,
      );
    }

    const serverFiles = [
      ...(await filesBelow(path.resolve("src"))),
      ...(await filesBelow(path.resolve("scripts"))),
    ].filter((file) => file.endsWith(".ts") || file.endsWith(".tsx"));
    for (const file of serverFiles) {
      if (file.endsWith("/studioConvexHttpClient.ts")) continue;
      const source = await readFile(file, "utf8");
      const rawClients = importedValues(source, "convex/browser").filter(
        (name) => name === "ConvexHttpClient",
      );
      if (file.endsWith("/src/trigger/convexAuthProbe.ts") && rawClients.length > 0) {
        // The data-free rollout probe needs one intentionally unsigned client
        // to prove that the public boundary reports denial. Its companion
        // client is signed, and both are restricted to the probe endpoint.
        assert.deepEqual(rawClients, ["ConvexHttpClient"]);
        assert.equal(
          [...source.matchAll(/new\s+ConvexHttpClient\s*\(/g)].length,
          1,
          "the auth probe may construct exactly one unsigned client",
        );
        assert.equal(
          [...source.matchAll(/\.query\(api\.runs\.verifyAuthBoundary/g)].length,
          2,
          "signed and unsigned clients must call only the auth-boundary probe",
        );
        assert.doesNotMatch(source, /\.mutation\(|api\.(?!runs\.verifyAuthBoundary)/);
        continue;
      }
      assert.deepEqual(
        rawClients,
        [],
        `${path.relative(process.cwd(), file)} constructs an unauthenticated server Convex client`,
      );
    }

    let authorizationHeader: string | null = null;
    const client = new StudioConvexHttpClient("https://example.convex.cloud", {
      fetch: async (_input, init) => {
        authorizationHeader = new Headers(init?.headers).get("Authorization");
        return new Response(JSON.stringify({ status: "success", value: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    });
    await client.query(api.channels.listChannels, { ownerId: "owner_daniel" });
    assert.match(authorizationHeader ?? "", /^Bearer /);
    const serviceJwt = (authorizationHeader ?? "").replace(/^Bearer /, "");
    const verifiedService = await jwtVerify(serviceJwt, verificationKey, {
      algorithms: ["ES256"],
      issuer: STUDIO_CONVEX_ISSUER,
      audience: STUDIO_CONVEX_AUDIENCE,
    });
    assert.equal(verifiedService.payload.role, "service");
    assert.equal(verifiedService.payload.owner_id, "owner_daniel");

    process.env.STUDIO_SESSION_SECRET = Buffer.alloc(32, 7).toString("base64");
    assert.equal(await hasValidOperatorSession(undefined), false);
    assert.equal(await hasValidOperatorSession("forged.session.token"), false);
    const session = await createOperatorSessionToken();
    assert.equal(await hasValidOperatorSession(session), true);
    const { GET: getConvexToken } = await import("../../app/api/auth/convex-token/route");
    const noSessionResponse = await getConvexToken(
      new Request("https://youtube-studio-ai.vercel.app/api/auth/convex-token"),
    );
    assert.equal(noSessionResponse.status, 200);
    const noSessionBody = (await noSessionResponse.json()) as { token?: unknown };
    assert.equal(typeof noSessionBody.token, "string");
    const verifiedPublicViewer = await jwtVerify(
      noSessionBody.token as string,
      verificationKey,
      {
        algorithms: ["ES256"],
        issuer: STUDIO_CONVEX_ISSUER,
        audience: STUDIO_CONVEX_AUDIENCE,
      },
    );
    assert.equal(verifiedPublicViewer.payload.role, "viewer");
    assert.equal(
      verifiedPublicViewer.payload.sub,
      `viewer:${String(verifiedPublicViewer.payload.owner_id)}`,
    );
    const crossOriginResponse = await getConvexToken(
      new Request("https://youtube-studio-ai.vercel.app/api/auth/convex-token", {
        headers: {
          Cookie: `${STUDIO_SESSION_COOKIE}=${session}`,
          Origin: "https://attacker.invalid",
          "Sec-Fetch-Site": "cross-site",
        },
      }),
    );
    assert.equal(crossOriginResponse.status, 403);
    const tokenResponse = await getConvexToken(
      new Request("https://youtube-studio-ai.vercel.app/api/auth/convex-token", {
        headers: { Cookie: `${STUDIO_SESSION_COOKIE}=${session}` },
      }),
    );
    assert.equal(tokenResponse.status, 200);
    const tokenBody = (await tokenResponse.json()) as { token?: unknown };
    assert.equal(typeof tokenBody.token, "string");
    const verifiedSessionRequest = await jwtVerify(
      tokenBody.token as string,
      verificationKey,
      {
        algorithms: ["ES256"],
        issuer: STUDIO_CONVEX_ISSUER,
        audience: STUDIO_CONVEX_AUDIENCE,
      },
    );
    assert.equal(
      verifiedSessionRequest.payload.role,
      "owner",
      "a valid owner session must elevate Convex mutations without gating public reads",
    );

    console.log("CONVEX AUTHORIZATION PASS: owner spoofing denied");
    console.log("CONVEX AUTHORIZATION PASS: public viewer is query-only and scoped");
    console.log("CONVEX AUTHORIZATION PASS: server client sends verified service JWT");
    console.log("CONVEX AUTHORIZATION PASS: public viewer upgrades only with a valid owner session");
    console.log("CONVEX AUTHORIZATION PASS: missing key and JWKS readiness fail closed");
  } finally {
    if (priorPrivateKey === undefined) delete process.env.STUDIO_CONVEX_JWT_PRIVATE_KEY;
    else process.env.STUDIO_CONVEX_JWT_PRIVATE_KEY = priorPrivateKey;
    if (priorPreviousJwks === undefined) delete process.env.STUDIO_CONVEX_PREVIOUS_PUBLIC_JWKS;
    else process.env.STUDIO_CONVEX_PREVIOUS_PUBLIC_JWKS = priorPreviousJwks;
    if (priorSessionSecret === undefined) delete process.env.STUDIO_SESSION_SECRET;
    else process.env.STUDIO_SESSION_SECRET = priorSessionSecret;
  }
}

void main();
