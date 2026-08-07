import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  assessExactYoutubeProviderIdentity,
  assertExistingYoutubeProviderBinding,
  assertYoutubeChannelIdUniqueBinding,
  assertYoutubeCreationApprovalReceiptShape,
  assertYoutubeCreationClaimBinding,
  assertYoutubeCreationCompletionWasAbsent,
  assertYoutubeCreationCompletionOwner,
  assertYoutubePreProviderInventoryAllowsProviderStart,
  assertYoutubePreProviderInventoryProof,
  decideYoutubeCreationClaimAction,
  decideYoutubeCreationRecoveryAdmission,
  type YoutubeCreationBinding,
  type YoutubeCreationClaimSnapshot,
  type YoutubePreProviderInventoryProof,
} from "@/lib/youtubeChannelCreationClaim";
import {
  issueStudioActionApproval,
  studioActionApprovalFingerprint,
  verifyStudioActionApproval,
  youtubeChannelApprovalSubject,
  youtubeChannelCreationRequestKey,
  youtubeChannelIntentApprovalSubject,
} from "@/lib/studioActionApproval";
import {
  assessYoutubeExactIdentityInventory,
  chooseExactExistingYoutubeChannelLink,
  installYoutubeRecoveryGuards,
  isYoutubeRecoveryControlDenied,
  isYoutubeRecoveryRequestAllowed,
  type YoutubeRecoveryContext,
  type YoutubeRecoveryPage,
} from "@/lib/youtubeRecoveryBrowser";
import {
  executeYoutubeCreationProviderBoundary,
  YoutubeProviderBoundaryError,
} from "@/lib/youtubeCreationProviderBoundary";
import { youtubeCreationClaimGuardsForTests } from "../../../convex/youtubeCreationClaims";

const root = process.cwd();
const channelId = "jd7fak3zvx63y4n70k6aw0m8x57abcde";
const ownerId = "owner_daniel";
const requestKey = "a".repeat(64);
const receiptFingerprint = "b".repeat(64);
const ytChannelId = `UC${"x".repeat(22)}`;

function binding(overrides: Partial<YoutubeCreationBinding> = {}): YoutubeCreationBinding {
  return {
    ownerId,
    channelId,
    requestKey,
    name: "Exact Channel",
    requestedHandle: "exactchannel",
    receiptFingerprint,
    ...overrides,
  };
}

function snapshot(
  status: YoutubeCreationClaimSnapshot["status"],
  overrides: Partial<YoutubeCreationClaimSnapshot> = {},
): YoutubeCreationClaimSnapshot {
  return {
    ...binding(),
    status,
    workerId: "trigger-run-1",
    claimExpiresAt: 10_000,
    ...(status === "created" ? { ytChannelId } : {}),
    ...overrides,
  };
}

function inventory(
  overrides: Partial<YoutubePreProviderInventoryProof> = {},
): YoutubePreProviderInventoryProof {
  return {
    version: "youtube-pre-provider-inventory/v1",
    ...binding(),
    inventoryFingerprint: "c".repeat(64),
    candidateCount: 1,
    observedYtChannelIds: [`UC${"o".repeat(22)}`],
    exactIdentityState: "absent",
    observedAt: 1_000,
    ...overrides,
  };
}

async function main(): Promise<void> {
  // Lost provider response: once provider_started is durable, retry can only
  // recover. The simulated provider create click remains exactly one.
  let state = snapshot("claimed");
  let createClicks = 0;
  let recoveryReads = 0;
  const first = decideYoutubeCreationClaimAction({
    existing: state,
    requested: binding(),
    workerId: "trigger-run-1",
    now: 1,
  });
  assert.equal(first, "create");
  state = snapshot("provider_started");
  createClicks += 1;
  // Simulate the response being lost after YouTube accepted the click.
  const retry = decideYoutubeCreationClaimAction({
    existing: state,
    requested: binding(),
    workerId: "trigger-run-1",
    now: 2,
  });
  if (retry === "recover") recoveryReads += 1;
  if (retry === "create") createClicks += 1;
  assert.equal(retry, "recover");
  assert.equal(createClicks, 1, "lost response must not duplicate the provider click");
  assert.equal(recoveryReads, 1);

  // A duplicate Trigger delivery must not steal an in-flight provider lease.
  // Otherwise its early recovery pass can mark the claim ambiguous and reject
  // the original worker's successful completion.
  assert.equal(decideYoutubeCreationClaimAction({
    existing: snapshot("provider_started", {
      workerId: "creator-run",
      claimExpiresAt: 50_000,
    }),
    requested: binding(),
    workerId: "duplicate-run",
    now: 20_000,
  }), "wait");

  // Fake-provider causal inventory: an unrelated pre-existing UC id is frozen
  // before authorization. A new id may complete; that baseline id may never be
  // adopted by recovery.
  const absentInventory = inventory();
  assert.doesNotThrow(() => assertYoutubePreProviderInventoryProof(
    absentInventory,
    binding(),
  ));
  assert.doesNotThrow(() => assertYoutubePreProviderInventoryAllowsProviderStart(
    absentInventory,
    binding(),
  ));
  assert.doesNotThrow(() => assertYoutubeCreationCompletionWasAbsent(
    absentInventory,
    binding(),
    ytChannelId,
  ));
  assert.throws(() => assertYoutubeCreationCompletionWasAbsent(
    absentInventory,
    binding(),
    absentInventory.observedYtChannelIds[0],
  ), /existed in the pre-provider inventory/);

  const preExistingId = `UC${"p".repeat(22)}`;
  const preExistingCandidates = [{
    href: `https://www.youtube.com/channel/${preExistingId}`,
    textLines: ["Exact Channel", "@exactchannel"],
  }];
  const preExistingAssessment = assessYoutubeExactIdentityInventory(
    preExistingCandidates,
    { name: "Exact Channel", handle: "exactchannel" },
  );
  assert.deepEqual(preExistingAssessment, {
    candidateCount: 1,
    observedYtChannelIds: [preExistingId],
    exactIdentityState: "present",
  });
  const preExistingInventory = inventory({
    ...preExistingAssessment,
    inventoryFingerprint: "d".repeat(64),
  });
  assert.throws(() => assertYoutubePreProviderInventoryAllowsProviderStart(
    preExistingInventory,
    binding(),
  ), /existed before provider start/);
  assert.throws(() => assertYoutubeCreationCompletionWasAbsent(
    preExistingInventory,
    binding(),
    preExistingId,
  ), /existed before provider start/);

  // Fake race: the baseline was absent, but the exact identity appears before
  // provider authorization. The mandatory second DOM assessment must stop the
  // create closure rather than letting recovery claim the concurrent channel.
  const initialAssessment = assessYoutubeExactIdentityInventory([], {
    name: "Exact Channel",
    handle: "exactchannel",
  });
  const racedAssessment = assessYoutubeExactIdentityInventory(preExistingCandidates, {
    name: "Exact Channel",
    handle: "exactchannel",
  });
  let fakeProviderCreateClicks = 0;
  let fakeProviderCheckpoints = 0;
  await assert.rejects(async () => await executeYoutubeCreationProviderBoundary({
    action: "create",
    markProviderStarted: async () => {
      fakeProviderCheckpoints += 1;
      return { started: true, status: "provider_started" };
    },
    createExact: async (checkpointProviderStarted) => {
      assert.equal(initialAssessment.exactIdentityState, "absent");
      if (racedAssessment.exactIdentityState !== "absent") {
        throw new Error("exact identity appeared after the durable baseline");
      }
      await checkpointProviderStarted();
      fakeProviderCreateClicks += 1;
      return { channelId: ytChannelId };
    },
    markCreated: async () => assert.fail("raced provider result was persisted"),
    markAmbiguous: async () => assert.fail("pre-provider race became ambiguous"),
  }), (error: unknown) => {
    assert.ok(error instanceof YoutubeProviderBoundaryError);
    assert.equal(error.providerStarted, false);
    return true;
  });
  assert.equal(fakeProviderCreateClicks, 0);
  assert.equal(fakeProviderCheckpoints, 0);

  // A recovery match against a baseline-present exact identity remains
  // ambiguous; it cannot be promoted to a creation receipt.
  let preExistingRecoveryAmbiguous = 0;
  const preExistingRecovery = await executeYoutubeCreationProviderBoundary({
    action: "recover",
    beginRecovery: async () => ({ action: "recover" as const }),
    recoverExact: async () => ({ channelId: preExistingId }),
    markCreated: async (proof) => {
      assertYoutubeCreationCompletionWasAbsent(
        preExistingInventory,
        binding(),
        proof.channelId!,
      );
      return proof.channelId!;
    },
    markAmbiguous: async () => { preExistingRecoveryAmbiguous += 1; },
  });
  assert.equal(preExistingRecovery.kind, "ambiguous");
  assert.equal(preExistingRecoveryAmbiguous, 1);

  assert.doesNotThrow(() => assertYoutubeChannelIdUniqueBinding({
    channelId,
    claimChannelIds: [channelId],
    projectedChannelIds: [channelId],
  }));
  assert.throws(() => assertYoutubeChannelIdUniqueBinding({
    channelId,
    claimChannelIds: ["another-app-channel"],
    projectedChannelIds: [],
  }), /already bound to another app channel/);
  assert.throws(() => assertYoutubeChannelIdUniqueBinding({
    channelId,
    claimChannelIds: [],
    projectedChannelIds: ["another-app-channel"],
  }), /already bound to another app channel/);
  assert.equal(decideYoutubeCreationRecoveryAdmission({
    existing: snapshot("provider_started", {
      workerId: "creator-run",
      claimExpiresAt: 50_000,
    }),
    workerId: "duplicate-run",
    now: 20_000,
  }), "wait");
  assert.equal(decideYoutubeCreationRecoveryAdmission({
    existing: snapshot("provider_started", {
      workerId: "creator-run",
      claimExpiresAt: 50_000,
    }),
    workerId: "creator-run",
    now: 20_000,
  }), "recover", "the same Trigger run may reconcile its own lost response");
  assert.equal(decideYoutubeCreationRecoveryAdmission({
    existing: snapshot("provider_started", {
      workerId: "creator-run",
      claimExpiresAt: 50_000,
    }),
    workerId: "recovery-run",
    now: 50_001,
  }), "recover", "an expired provider lease may be taken over");
  assert.equal(decideYoutubeCreationClaimAction({
    existing: snapshot("recovery", {
      workerId: "recovery-run",
      claimExpiresAt: 50_000,
    }),
    requested: binding(),
    workerId: "duplicate-recovery-run",
    now: 20_000,
  }), "wait");

  assert.equal(decideYoutubeCreationClaimAction({
    existing: snapshot("ambiguous"),
    requested: binding(),
    workerId: "trigger-run-2",
    now: 20_000,
  }), "recover");
  assert.equal(decideYoutubeCreationClaimAction({
    existing: snapshot("recovery"),
    requested: binding(),
    workerId: "trigger-run-3",
    now: 20_000,
  }), "recover");
  assert.equal(decideYoutubeCreationClaimAction({
    existing: snapshot("created"),
    requested: binding(),
    workerId: "trigger-run-4",
    now: 20_000,
  }), "reuse");
  assert.equal(decideYoutubeCreationClaimAction({
    existing: snapshot("pre_provider_failed"),
    requested: binding(),
    workerId: "trigger-run-5",
    now: 20_000,
  }), "new_intent_required");

  assert.doesNotThrow(() => assertYoutubeCreationCompletionOwner({
    claim: {
      status: "provider_started",
      workerId: "trigger-run-1",
      providerAttemptId: "trigger-run-1",
    },
    workerId: "trigger-run-1",
  }));
  assert.throws(() => assertYoutubeCreationCompletionOwner({
    claim: {
      status: "provider_started",
      workerId: "trigger-run-1",
      providerAttemptId: "trigger-run-1",
    },
    workerId: "forged-service-worker",
  }), /does not own the exact provider attempt/);
  assert.throws(() => assertYoutubeCreationCompletionOwner({
    claim: {
      status: "recovery",
      workerId: "recovery-run-1",
      providerAttemptId: "trigger-run-1",
    },
    workerId: "stale-trigger-run",
  }), /does not own the active recovery claim/);

  assert.throws(
    () => assertYoutubeCreationClaimBinding(
      binding(),
      binding({ ownerId: "owner_leo" }),
    ),
    /immutable binding conflict/,
  );
  assert.doesNotThrow(() => assertYoutubeCreationClaimBinding(
    binding(),
    binding({ name: "  Exact   Channel  ", requestedHandle: "@ExactChannel" }),
  ));
  assert.throws(() => assertExistingYoutubeProviderBinding({
    projectedYtChannelId: ytChannelId,
    existingClaim: snapshot("pre_provider_failed"),
  }), /without this exact durable receipt/);
  assert.throws(() => assertExistingYoutubeProviderBinding({
    projectedYtChannelId: ytChannelId,
    existingClaim: snapshot("created", { ytChannelId: `UC${"z".repeat(22)}` }),
  }), /without this exact durable receipt/);
  assert.doesNotThrow(() => assertExistingYoutubeProviderBinding({
    projectedYtChannelId: ytChannelId,
    existingClaim: snapshot("created"),
  }));
  assert.throws(
    () => assertYoutubeCreationClaimBinding(
      binding(),
      binding({ requestKey: "c".repeat(64) }),
    ),
    /immutable binding conflict/,
  );

  assert.equal(assessExactYoutubeProviderIdentity({
    expectedName: "Exact Channel",
    expectedHandle: "exactchannel",
    observed: {
      name: "Exact Channel",
      handle: "@exactchannel",
      channelId: ytChannelId,
      studioChannelId: ytChannelId,
    },
  }).exact, true);
  assert.equal(assessExactYoutubeProviderIdentity({
    expectedName: "Exact Channel",
    expectedHandle: "exactchannel",
    observed: {
      name: "Lookalike Channel",
      handle: "@exactchannel",
      channelId: ytChannelId,
      studioChannelId: ytChannelId,
    },
  }).exact, false);
  assert.equal(assessExactYoutubeProviderIdentity({
    expectedName: "Exact Channel",
    expectedHandle: "exactchannel",
    observed: {
      name: "Exact Channel",
      handle: "@exactchannel2",
      channelId: ytChannelId,
      studioChannelId: ytChannelId,
    },
  }).exact, false);
  assert.equal(assessExactYoutubeProviderIdentity({
    expectedName: "Exact Channel",
    expectedHandle: "exactchannel",
    observed: {
      name: "Exact Channel",
      handle: "@exactchannel",
      channelId: ytChannelId,
      studioChannelId: `UC${"y".repeat(22)}`,
    },
  }).exact, false);

  const priorKey = process.env.STUDIO_CONVEX_JWT_PRIVATE_KEY;
  process.env.STUDIO_CONVEX_JWT_PRIVATE_KEY = "youtube-creation-test-signing-key";
  try {
    const intentOne = youtubeChannelCreationRequestKey({
      ownerId,
      channelId,
      intentKey: "intent-000000000001",
      name: "Exact Channel",
      handle: "exactchannel",
    });
    const intentTwo = youtubeChannelCreationRequestKey({
      ownerId,
      channelId,
      intentKey: "intent-000000000002",
      name: "Exact Channel",
      handle: "exactchannel",
    });
    assert.notEqual(intentOne, intentTwo, "a confirmed new pre-provider intent gets a new key");
    const subject = youtubeChannelApprovalSubject({
      ownerId,
      channelId,
      requestKey: intentOne,
      name: "Exact Channel",
      handle: "exactchannel",
    });
    const approval = issueStudioActionApproval({
      action: "youtube-channel-create",
      ownerId,
      subject,
      actor: `authenticated-operator:${ownerId}`,
      evidence: "explicit test confirmation",
      now: 1_000,
      ttlMs: 1_000,
    });
    const fingerprint = studioActionApprovalFingerprint(approval);
    assert.doesNotThrow(() => assertYoutubeCreationApprovalReceiptShape(approval, {
      ownerId,
      subject,
      actor: `authenticated-operator:${ownerId}`,
      evidence: "explicit test confirmation",
      issuedAt: 1_000,
      expiresAt: 2_000,
    }));
    assert.throws(() => assertYoutubeCreationApprovalReceiptShape(
      { ...approval, ownerId: "owner_leo" },
      {
        ownerId,
        subject,
        actor: `authenticated-operator:${ownerId}`,
        evidence: "explicit test confirmation",
        issuedAt: 1_000,
        expiresAt: 2_000,
      },
    ), /shape or binding is invalid/);
    assert.equal(verifyStudioActionApproval(approval, {
      action: "youtube-channel-create",
      ownerId,
      subject,
      now: 3_000,
      persistedReceiptFingerprint: fingerprint,
    }), true, "the exact persisted receipt may safely resume after expiry");
    assert.equal(verifyStudioActionApproval(approval, {
      action: "youtube-channel-create",
      ownerId,
      subject: youtubeChannelApprovalSubject({
        ownerId,
        channelId,
        requestKey: intentTwo,
        name: "Exact Channel",
        handle: "exactchannel",
      }),
      now: 1_500,
    }), false, "a receipt cannot cross request boundaries");
    assert.notEqual(subject, youtubeChannelApprovalSubject({
      ownerId,
      channelId,
      requestKey: intentOne,
      name: "Lookalike Channel",
      handle: "exactchannel",
    }), "the signed child subject binds the exact normalized name");
    assert.equal(subject, youtubeChannelApprovalSubject({
      ownerId,
      channelId,
      requestKey: intentOne,
      name: "  Exact   Channel ",
      handle: "@ExactChannel",
    }), "equivalent normalized provider identities share one signed digest");
    assert.notEqual(intentOne, youtubeChannelCreationRequestKey({
      ownerId,
      channelId,
      intentKey: "intent-000000000001",
      name: "Exact Channel",
      handle: "exactchannel2",
    }), "the durable request digest binds the exact normalized handle");
    assert.notEqual(
      youtubeChannelIntentApprovalSubject({
        ownerId,
        intentKey: "build-intent-000001",
        name: "Exact Channel",
        handle: "exactchannel",
      }),
      youtubeChannelIntentApprovalSubject({
        ownerId,
        intentKey: "build-intent-000001",
        name: "Exact Channel",
        handle: "exactchannel2",
      }),
      "the parent approval binds the exact visible provider identity",
    );
  } finally {
    if (priorKey === undefined) delete process.env.STUDIO_CONVEX_JWT_PRIVATE_KEY;
    else process.env.STUDIO_CONVEX_JWT_PRIVATE_KEY = priorKey;
  }

  await assert.doesNotReject(() => youtubeCreationClaimGuardsForTests.requireCreationService({
    auth: { getUserIdentity: async () => ({ role: "service", owner_id: ownerId }) },
  }, ownerId));
  await assert.rejects(() => youtubeCreationClaimGuardsForTests.requireCreationService({
    auth: { getUserIdentity: async () => ({ role: "service", owner_id: "owner_leo" }) },
  }, ownerId), /bound studio service identity/);
  await assert.rejects(() => youtubeCreationClaimGuardsForTests.requireCreationService({
    auth: { getUserIdentity: async () => ({ role: "owner", owner_id: ownerId }) },
  }, ownerId), /bound studio service identity/);

  const taskSource = readFileSync(join(root, "src/trigger/youtubeCreateChannel.ts"), "utf8");
  assert.ok(
    taskSource.indexOf("verifyStudioActionApproval") < taskSource.indexOf("if (!hasBrowserbase())"),
    "approval must fail before Browserbase admission",
  );
  const recoverySource = taskSource.slice(
    taskSource.indexOf('if (claimed.action === "recover")'),
    taskSource.indexOf('action: "create"'),
  );
  assert.doesNotMatch(recoverySource, /\.agent\(|agent\.execute\(/);
  assert.match(recoverySource, /installYoutubeRecoveryGuards/);
  assert.match(recoverySource, /selectExactExistingYoutubeChannel/);
  const inventoryCheckpoint = taskSource.indexOf("recordPreProviderInventory");
  const providerCheckpoint = taskSource.indexOf("await checkpointProviderStarted()");
  assert.ok(inventoryCheckpoint >= 0 && inventoryCheckpoint < providerCheckpoint,
    "the immutable inventory must commit before provider authorization");
  assert.ok(
    taskSource.indexOf("authorizationCandidates", inventoryCheckpoint) < providerCheckpoint,
    "the exact provider identity must be re-read after inventory commit and before authorization",
  );
  assert.match(taskSource, /markProviderStarted/);
  assert.match(taskSource, /proveExactActiveChannel/);
  assert.match(taskSource, /for \(let attempt = 1; attempt <= 3; attempt\+\+\)/);

  assert.equal(isYoutubeRecoveryRequestAllowed("POST", "https://www.youtube.com/youtubei/v1/browse"), false);
  assert.equal(isYoutubeRecoveryRequestAllowed("GET", "https://www.youtube.com/create_channel"), false);
  assert.equal(isYoutubeRecoveryRequestAllowed("GET", "https://www.youtube.com/@exactchannel/about"), true);
  assert.equal(isYoutubeRecoveryControlDenied("Create a channel"), true);
  type RoutedRequest = {
    request(): { method(): string; url(): string };
    abort(): Promise<void>;
    continue(): Promise<void>;
  };
  type RoutedSocket = { close(): Promise<void> };
  let requestGuard: ((route: RoutedRequest) => Promise<void> | void) | undefined;
  let websocketGuard: ((route: RoutedSocket) => Promise<void> | void) | undefined;
  let initScripts = 0;
  const cdpCommands: string[] = [];
  const fakeContext: YoutubeRecoveryContext = {
    route: async (_url, handler) => { requestGuard = handler; },
    routeWebSocket: async (_url, handler) => { websocketGuard = handler; },
    addInitScript: async () => { initScripts += 1; },
    newCDPSession: async () => ({
      send: async (method) => { cdpCommands.push(method); },
    }),
  };
  await installYoutubeRecoveryGuards(fakeContext, {} as YoutubeRecoveryPage);
  assert.equal(initScripts, 1);
  assert.deepEqual(cdpCommands, ["Network.enable", "Network.setBypassServiceWorker"]);
  let postAborted = false;
  await requestGuard!({
    request: () => ({
      method: () => "POST",
      url: () => "https://www.youtube.com/youtubei/v1/browse",
    }),
    abort: async () => { postAborted = true; },
    continue: async () => assert.fail("unsafe recovery request was continued"),
  });
  assert.equal(postAborted, true);
  let socketClosed = false;
  await websocketGuard!({ close: async () => { socketClosed = true; } });
  assert.equal(socketClosed, true);
  assert.deepEqual(chooseExactExistingYoutubeChannelLink([], {
    name: "Exact Channel",
    handle: "exactchannel",
  }), { selected: false, reason: "no exact existing-channel link was available" });
  assert.deepEqual(chooseExactExistingYoutubeChannelLink([{
    href: "https://www.youtube.com/channel/UCexisting1234567890123456",
    textLines: ["Exact Channel", "@exactchannel"],
  }], { name: "Exact Channel", handle: "exactchannel" }), {
    selected: true,
    href: "https://www.youtube.com/channel/UCexisting1234567890123456",
  });
  assert.equal(chooseExactExistingYoutubeChannelLink([{
    href: "https://www.youtube.com/create_channel?name=Exact%20Channel",
    textLines: ["Exact Channel", "@exactchannel"],
  }], { name: "Exact Channel", handle: "exactchannel" }).selected, false);

  const routeSource = readFileSync(join(root, "src/app/api/youtube-create/route.ts"), "utf8");
  assert.match(routeSource, /confirmedCreateNewChannel !== true/);
  assert.match(routeSource, /approvalReceipt as StudioActionApprovalReceipt/);
  const buildRouteSource = readFileSync(join(root, "src/app/api/build-channel/route.ts"), "utf8");
  assert.match(buildRouteSource, /youtubeChannelIntentApprovalSubject/);
  assert.match(buildRouteSource, /name the channel before authorizing real YouTube creation/);
  const inceptionSource = readFileSync(join(root, "src/trigger/designChannelInception.ts"), "utf8");
  assert.match(inceptionSource, /name: requestedYoutubeName/);
  assert.match(inceptionSource, /handle: requestedYoutubeHandle/);
  const uiSource = readFileSync(join(root, "src/app/(app)/channels/[slug]/page.tsx"), "utf8");
  assert.match(uiSource, /window\.confirm\(/);
  assert.match(uiSource, /confirmedCreateNewChannel: true/);
  const newChannelUiSource = readFileSync(join(root, "src/app/(app)/channels/new/page.tsx"), "utf8");
  assert.match(newChannelUiSource, /create exactly/);
  assert.match(newChannelUiSource, /requestedYoutubeName, requestedYoutubeHandle/);

  console.log("YouTube channel creation exactly-once and recovery contract passed");
}

void main();
