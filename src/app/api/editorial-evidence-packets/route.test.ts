import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { POST } from "./route";

const INTERNAL_TOKEN = "studio-test-service-token-that-is-long-enough";

function request(body: unknown, authenticated = true): Request {
  return new Request("https://studio.test/api/editorial-evidence-packets", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(authenticated ? { authorization: `Bearer ${INTERNAL_TOKEN}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

async function main() {
  const originalToken = process.env.STUDIO_INTERNAL_API_TOKEN;
  const originalFetch = globalThis.fetch;
  process.env.STUDIO_INTERNAL_API_TOKEN = INTERNAL_TOKEN;

  const draft = {
    action: "validate",
    subject: "How a reviewed source becomes a factual visual",
    sources: [{
      id: "source-primary",
      name: "Primary evidence",
      url: "https://example.org/evidence",
      snapshotSha256: "a".repeat(64),
      kind: "primary",
    }],
    claims: [{
      id: "claim-grounded",
      sourceIds: ["source-primary"],
      approvedText: "The source was reviewed before the factual visual was planned.",
      context: "This restricted statement is safe for a supervised explainer.",
    }],
    review: {
      reviewerId: "editor-verified",
      reviewId: "review-evidence-route",
      reviewedAt: new Date().toISOString(),
    },
  };

  try {
    let remoteCalls = 0;
    globalThis.fetch = (async () => {
      remoteCalls += 1;
      throw new Error("private evidence validation must not call a provider or Convex");
    }) as typeof fetch;

    const validated = await POST(request(draft));
    assert.equal(validated.status, 200);
    const validation = await validated.json() as { ok: boolean; packet: Record<string, unknown> };
    assert.equal(validation.ok, true);
    assert.equal(validation.packet.release, "private_human_editorial_review_only");
    assert.equal(validation.packet.requiresHumanEditorialReview, true);
    assert.match(String(validation.packet.contentFingerprint), /^[a-f0-9]{64}$/);
    assert.equal(remoteCalls, 0);

    const missingConfirmation = await POST(request({
      action: "admit",
      packet: validation.packet,
      reviewerConfirmed: false,
    }));
    assert.equal(missingConfirmation.status, 400);
    assert.equal(remoteCalls, 0);

    const tampered = { ...validation.packet, contentFingerprint: "b".repeat(64) };
    const rejected = await POST(request({ action: "admit", packet: tampered, reviewerConfirmed: true }));
    assert.equal(rejected.status, 422);
    assert.match(String((await rejected.json() as { error: string }).error), /fingerprint/i);
    assert.equal(remoteCalls, 0, "tampered packets must be rejected before any persistence attempt");

    const unauthorized = await POST(request(draft, false));
    assert.equal(unauthorized.status, 401);

    const routeSource = readFileSync(new URL("./route.ts", import.meta.url), "utf8");
    assert.match(routeSource, /assertEditorialEvidencePacket\(object\(body\.packet, "packet"\), now\)/);
    assert.match(routeSource, /await requireStudioActor\(request\)/);
    assert.doesNotMatch(routeSource, /@trigger\.dev|novita|gemini|tasks\.trigger/);

    const persistenceSource = readFileSync(new URL("../../../../convex/editorialEvidencePackets.ts", import.meta.url), "utf8");
    assert.match(persistenceSource, /requireStudioServiceIdentity\(ctx, args\.ownerId, "editorial evidence persistence"\)/);
    assert.match(persistenceSource, /requireStudioServiceIdentity\(ctx, args\.ownerId, "editorial evidence retrieval"\)/);
    assert.doesNotMatch(persistenceSource, /\.\.\/src\/engine\/editorialEvidencePacket/);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv("STUDIO_INTERNAL_API_TOKEN", originalToken);
  }

  console.log("Private editorial evidence desk route tests passed");
}

void main();
