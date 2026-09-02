import assert from "node:assert/strict";

import {
  CASEFILE_SOURCE_AUTO_VERIFIER_MIN_CONFIDENCE,
  CASEFILE_SOURCE_AUTO_VERIFIER_REVIEWER_ID,
  autoVerifyCasefileSourcePacket,
  type CasefileSourcePacketContentInput,
} from "@/engine/casefileSourceAutoVerifier";
import { casefileFingerprint } from "@/engine/casefile";
import {
  CASEFILE_SOURCE_PACKET_VERSION,
  assertCasefileSourcePacket,
  casefileSourcePacketContentFingerprint,
} from "@/engine/sourceFirstAdmission";
import { casefileSourcePacketBlocks } from "@/trigger/blocks/casefileSourcePacketBlocks";

const NOW = new Date();

// Same fixture shape already proven valid against the structural admission
// gate in casefileSourcePacket.test.ts — only the editorialReview production
// path differs here (automated instead of hand-authored).
const casePacket = {
  version: "casefile/v1" as const,
  id: "case-vault-closure",
  title: "The Vault Closure",
  kind: "historical_heist" as const,
  status: "historical_closed" as const,
  sourceLedger: [
    {
      id: "source-court-archive",
      kind: "court_record" as const,
      title: "Closure finding",
      publisher: "Regional Court Archive",
      locator: "https://court.example.org/records/vault-closure",
      excerpt: "The finding records the closure decision and the verified repair programme.",
      rights: {
        provenance: "licensed" as const,
        visualUse: "visual_clearance_confirmed" as const,
        evidenceLocator: "https://court.example.org/rights/vault-closure-license",
      },
    },
    {
      id: "source-city-paper",
      kind: "archival_news" as const,
      title: "Public response to the closure",
      publisher: "City Paper Archive",
      locator: "https://news.example.org/archive/vault-closure",
      excerpt: "The archive reports the documented public response after the closure.",
      rights: { provenance: "unknown" as const, visualUse: "citation_only" as const },
    },
    {
      id: "source-academic-study",
      kind: "academic_research" as const,
      title: "Repair programme impact study",
      publisher: "Regional History Institute",
      locator: "https://research.example.org/vault-repair-programme",
      excerpt: "The study independently documents the repair programme after closure.",
      rights: { provenance: "unknown" as const, visualUse: "citation_only" as const },
    },
  ],
  claims: [
    {
      id: "claim-closure-order",
      order: 10,
      text: "The court finding ordered the vault's closure.",
      state: "established" as const,
      sourceIds: ["source-court-archive"],
      operationalRisk: "none" as const,
    },
    {
      id: "claim-public-response",
      order: 20,
      text: "The documented closure prompted public response and a repair programme.",
      state: "established" as const,
      sourceIds: ["source-court-archive", "source-city-paper", "source-academic-study"],
      operationalRisk: "contextual" as const,
    },
  ],
  sensitivity: {
    activeAllegations: false,
    involvesMinors: false,
    includesGraphicDetail: false,
    actionableWrongdoing: false,
  },
  reconstruction: { mode: "none" as const },
};

const content: CasefileSourcePacketContentInput = {
  version: CASEFILE_SOURCE_PACKET_VERSION,
  caseId: casePacket.id,
  casePacket,
  claimPrimarySources: [
    {
      claimId: "claim-closure-order",
      sourceId: "source-court-archive",
      primarySourceUrl: "https://court.example.org/records/vault-closure",
      provenance: "court_record",
    },
    {
      claimId: "claim-public-response",
      sourceId: "source-court-archive",
      primarySourceUrl: "https://court.example.org/records/vault-closure",
      provenance: "court_record",
    },
  ],
  sourceUsage: [
    {
      sourceId: "source-court-archive",
      usage: "visual_media",
      assetId: "asset-court-closure-finding",
      rightsEvidenceLocator: "https://court.example.org/rights/vault-closure-license",
    },
    { sourceId: "source-city-paper", usage: "citation_only" },
    { sourceId: "source-academic-study", usage: "citation_only" },
  ],
};

function approvingFindings() {
  return content.claimPrimarySources.map((primary) => ({
    claimId: primary.claimId,
    sourceId: primary.sourceId,
    plausible: true,
    reason: "Locator path and excerpt are consistent with a court-records citation.",
  }));
}

function openRouterResponse(verdict: unknown) {
  return new Response(
    JSON.stringify({
      id: "or-source-auto-verifier-test",
      model: "google/gemini-3.7-flash",
      choices: [{ message: { content: JSON.stringify(verdict) } }],
      usage: { prompt_tokens: 10, completion_tokens: 10 },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

async function main(): Promise<void> {
  const previousOpenRouterKey = process.env.OPENROUTER_API_KEY;
  const previousAnthropicKey = process.env.ANTHROPIC_API_KEY;
  const originalFetch = global.fetch;
  try {
    // A retired direct credential must never bypass the pinned OpenRouter route.
    process.env.OPENROUTER_API_KEY = "test-openrouter-key";
    process.env.ANTHROPIC_API_KEY = "retired-direct-key";

    // --- A plausible source packet passes and produces a correctly
    // fingerprint-bound editorial review. This is the real integration proof:
    // feed the auto-generated review back through sourceFirstAdmission.ts's
    // UNMODIFIED structural gate and confirm it independently recomputes the
    // same fingerprints and admits the packet. ---
    let calls = 0;
    global.fetch = (async (_input: unknown, init?: RequestInit) => {
      calls += 1;
      const request = JSON.parse(String(init?.body));
      assert.equal(request.model, "google/gemini-3.7-flash");
      assert.match(request.messages[0].content, /cannot browse the internet/);
      assert.match(request.messages.at(-1).content, /CASEFILE_SOURCE_CANDIDATES/);
      return openRouterResponse({ pass: true, confidence: 0.92, issues: [], findings: approvingFindings() });
    }) as typeof fetch;

    const review = await autoVerifyCasefileSourcePacket(content, { now: NOW });
    assert.equal(calls, 1);
    assert.equal(review.decision, "approved");
    assert.equal(review.reviewerId, CASEFILE_SOURCE_AUTO_VERIFIER_REVIEWER_ID);
    assert.equal(review.reviewedPacketFingerprint, casefileFingerprint(casePacket));
    assert.equal(review.reviewedSourcePacketFingerprint, casefileSourcePacketContentFingerprint(content));
    assert.match(review.id, /^editorial-review-auto-vault-closure-[a-f0-9]{16}$/);

    const fullPacket = { ...content, editorialReview: review };
    const admitted = assertCasefileSourcePacket(fullPacket, { now: NOW });
    assert.equal(admitted.receipt.caseId, casePacket.id);
    assert.equal(admitted.receipt.editorialReview.reviewedPacketFingerprint, casefileFingerprint(casePacket));
    assert.equal(
      admitted.receipt.editorialReview.reviewedSourcePacketFingerprint,
      casefileSourcePacketContentFingerprint(content),
    );
    assert.equal(admitted.receipt.release, "private_human_editorial_review_only");

    // --- An implausible/fabricated source packet fails closed. ---
    global.fetch = (async () =>
      openRouterResponse({
        pass: false,
        confidence: 0.2,
        issues: ["source-court-archive uses a throwaway placeholder-style domain pattern"],
        findings: content.claimPrimarySources.map((primary) => ({
          claimId: primary.claimId,
          sourceId: primary.sourceId,
          plausible: false,
          reason: "Looks like placeholder content, not a real court-records system.",
        })),
      })) as typeof fetch;
    await assert.rejects(
      () => autoVerifyCasefileSourcePacket(content, { now: NOW }),
      /casefile source auto-verifier: automated review did not approve/,
    );

    // A verdict that claims pass:true but sits below the confidence floor
    // must still fail closed — pass alone is never sufficient.
    global.fetch = (async () =>
      openRouterResponse({
        pass: true,
        confidence: CASEFILE_SOURCE_AUTO_VERIFIER_MIN_CONFIDENCE - 0.1,
        issues: [],
        findings: approvingFindings(),
      })) as typeof fetch;
    await assert.rejects(
      () => autoVerifyCasefileSourcePacket(content, { now: NOW }),
      /automated review did not approve/,
    );

    // A verdict missing a finding for one of the expected claim/source pairs
    // is an incomplete response, not an implicit pass on the missing pair.
    global.fetch = (async () =>
      openRouterResponse({
        pass: true,
        confidence: 0.95,
        issues: [],
        findings: [approvingFindings()[0]],
      })) as typeof fetch;
    await assert.rejects(
      () => autoVerifyCasefileSourcePacket(content, { now: NOW }),
      /provider returned a malformed or incomplete verdict/,
    );

    // --- Simulated provider unavailability fails closed. ---
    global.fetch = (async () =>
      new Response(JSON.stringify({ error: { message: "upstream outage" } }), {
        status: 503,
        headers: { "content-type": "application/json" },
      })) as typeof fetch;
    await assert.rejects(
      () => autoVerifyCasefileSourcePacket(content, { now: NOW }),
      /casefile source auto-verifier: provider call failed/,
    );

    // Missing provider key must fail closed WITHOUT ever calling a provider.
    delete process.env.OPENROUTER_API_KEY;
    let unexpectedCall = false;
    global.fetch = (async () => {
      unexpectedCall = true;
      throw new Error("missing permitted key must not call a provider");
    }) as typeof fetch;
    await assert.rejects(
      () => autoVerifyCasefileSourcePacket(content, { now: NOW }),
      /no permitted provider is configured/,
    );
    assert.equal(unexpectedCall, false);

    // -----------------------------------------------------------------
    // Block wiring (casefile_source_packet): a human-pasted editorialReview
    // always wins unchanged and must never trigger the auto-verifier. No
    // provider key is configured at this point (deleted just above) and
    // global.fetch is still the call-counting stub from the previous
    // section, so if autoVerifyCasefileSourcePacket were mistakenly invoked
    // it would throw immediately — either on the missing-key check before
    // ever touching fetch, or via the stub itself — instead of silently
    // admitting.
    // -----------------------------------------------------------------
    const humanReview = {
      id: "editorial-review-vault-closure-human-001",
      decision: "approved" as const,
      reviewerId: "reviewer-documentary-desk",
      reviewedAt: new Date().toISOString(),
      reviewedPacketFingerprint: casefileFingerprint(casePacket),
      reviewedSourcePacketFingerprint: casefileSourcePacketContentFingerprint(content),
    };
    const humanInput = { ...content, editorialReview: humanReview };

    const humanLogs: string[] = [];
    const humanPatch = await casefileSourcePacketBlocks[0].run({
      ownerId: "owner-test",
      runId: "run-casefile-source-packet-human",
      channelId: "channel-test",
      keyPrefix: "owner/owner-test/channel/channel-test/",
      params: {},
      store: { casefileSourcePacketInput: humanInput },
      budgetUsd: 0,
      log: (message) => humanLogs.push(message),
    });
    assert.equal(
      (humanPatch.casefileSourceAdmission as { release: string }).release,
      "private_human_editorial_review_only",
    );
    assert.match(humanLogs.join("\n"), /human-drafted/);
    assert.doesNotMatch(humanLogs.join("\n"), /auto-drafted/);
    assert.match(humanLogs.join("\n"), /provider calls: 0/);

    // -----------------------------------------------------------------
    // Block wiring: when no human editorialReview is supplied, the block
    // calls autoVerifyCasefileSourcePacket, merges the returned review into
    // the content, and the exact same unmodified assertCasefileSourcePacket
    // gate admits the result.
    // -----------------------------------------------------------------
    process.env.OPENROUTER_API_KEY = "test-openrouter-key";
    process.env.ANTHROPIC_API_KEY = "retired-direct-key";
    let autoCalls = 0;
    global.fetch = (async () => {
      autoCalls += 1;
      return openRouterResponse({ pass: true, confidence: 0.93, issues: [], findings: approvingFindings() });
    }) as typeof fetch;

    const autoLogs: string[] = [];
    const autoPatch = await casefileSourcePacketBlocks[0].run({
      ownerId: "owner-test",
      runId: "run-casefile-source-packet-auto",
      channelId: "channel-test",
      keyPrefix: "owner/owner-test/channel/channel-test/",
      params: {},
      store: { casefileSourcePacketInput: content },
      budgetUsd: 0,
      log: (message) => autoLogs.push(message),
    });
    assert.equal(autoCalls, 1);
    assert.equal(
      (autoPatch.casefileSourceAdmission as { release: string }).release,
      "private_human_editorial_review_only",
    );
    assert.equal(
      (autoPatch.casefileSourceAdmission as { claimPrimarySourceCount: number }).claimPrimarySourceCount,
      content.claimPrimarySources.length,
    );
    assert.match(autoLogs.join("\n"), /auto-drafted/);
    assert.doesNotMatch(autoLogs.join("\n"), /human-drafted/);
    assert.match(autoLogs.join("\n"), /provider calls: 1/);

    console.log("casefile source packet block wiring tests passed");
    console.log("casefile source auto-verifier tests passed");
  } finally {
    global.fetch = originalFetch;
    if (previousOpenRouterKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = previousOpenRouterKey;
    if (previousAnthropicKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = previousAnthropicKey;
  }
}

void main();
