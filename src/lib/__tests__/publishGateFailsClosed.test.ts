/**
 * The highest-consequence invariant in the system: an unauthorized release must
 * not reach YouTube.
 *
 * The path to a public video has three independent locks, and this pins all
 * three, because until now they were guaranteed only by reading the code — no
 * test referenced the policy recheck at all.
 *
 *   1. DEFAULTS      upload_draft's publishMode defaults to "draft" and
 *                    privacyStatus to "private". A missing param cannot publish.
 *   2. CONFIGURATION a channel may only take an action its own pipeline declares.
 *                    A channel whose upload_draft has no publishMode: "public"
 *                    cannot be authorized for youtube_public, whatever any
 *                    stored approval says.
 *   3. RECHECK       the dispatcher does NOT trust the intent's stored `approved`
 *                    flag. It re-derives the decision at dispatch time, and on
 *                    refusal moves the intent to awaiting_approval and returns
 *                    without uploading. That ordering is the thing that makes a
 *                    stale approval harmless.
 *
 * The three checks that fail closed BEFORE any network call — missing channel,
 * tenant mismatch, unconfigured action — are exercised for real here, with an
 * injected convex client that fails the test if it is ever consulted. A gate
 * that reaches the network to say "no" is a gate that says "yes" during an
 * outage.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { channelPublishConfiguration, evaluateChannelPublishAction } from "@/lib/channelPublishPolicy";
import type { Id } from "../../../convex/_generated/dataModel";

const DISPATCHER = readFileSync(join(process.cwd(), "src/lib/publishDispatcher.ts"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const UPLOAD = readFileSync(join(process.cwd(), "src/trigger/blocks/lofiBlocks.ts"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const CHANNEL_ID = "channel-1" as unknown as Id<"channels">;

/** Any use of this client is a failure: these refusals must not need the network. */
const forbiddenConvex = {
  query: async () => {
    throw new Error("the policy consulted the network to refuse — it must fail closed locally");
  },
  mutation: async () => {
    throw new Error("the policy must not mutate while refusing");
  },
} as never;

async function main(): Promise<void> {
  // ---- 2. configuration ---------------------------------------------------
  const publicPipeline = [{ block: "upload_draft", params: { publishMode: "public" } }];
  const draftPipeline = [{ block: "upload_draft", params: { publishMode: "draft" } }];
  assert.ok(
    channelPublishConfiguration(publicPipeline).actions.includes("youtube_public"),
    "a channel that declares publishMode: public must be able to request it",
  );
  assert.ok(
    !channelPublishConfiguration(draftPipeline).actions.includes("youtube_public"),
    "a draft-only channel must never be able to request a public release",
  );
  assert.deepEqual(
    channelPublishConfiguration(undefined).actions,
    [],
    "a channel with no pipeline at all declares no publish actions",
  );

  // ---- fail closed, locally ----------------------------------------------
  const missing = await evaluateChannelPublishAction({
    ownerId: "owner-1", channelId: CHANNEL_ID, action: "youtube_public",
    channel: null, convex: forbiddenConvex,
  });
  assert.equal(missing.authorized, false, "a missing channel cannot publish");
  assert.equal(missing.reason, "channel_missing");

  const otherTenant = await evaluateChannelPublishAction({
    ownerId: "owner-1", channelId: CHANNEL_ID, action: "youtube_public",
    channel: { ownerId: "someone-else", pipeline: publicPipeline } as never,
    convex: forbiddenConvex,
  });
  assert.equal(otherTenant.authorized, false, "one owner must not publish to another's channel");
  assert.equal(otherTenant.reason, "tenant_mismatch");

  const notConfigured = await evaluateChannelPublishAction({
    ownerId: "owner-1", channelId: CHANNEL_ID, action: "youtube_public",
    channel: { ownerId: "owner-1", pipeline: draftPipeline } as never,
    convex: forbiddenConvex,
  });
  assert.equal(notConfigured.authorized, false, "a draft-only channel is refused a public release");
  assert.equal(notConfigured.reason, "action_not_configured");

  // ---- 3. the recheck, and its ORDER --------------------------------------
  // Presence is not enough: the refusal has to come before the upload, and it
  // has to return rather than fall through.
  assert.match(
    DISPATCHER,
    /const externallyVisible =\s*\n?\s*intent\.privacyStatus !== "private" \|\| intent\.publishAt !== undefined;/,
    "external visibility must be derived from the intent's own privacy/schedule",
  );
  assert.ok(
    !/intent\.approved/.test(DISPATCHER),
    "the dispatcher must NOT trust a stored approval flag — a stale approval would publish",
  );
  const recheckAt = DISPATCHER.indexOf("evaluateChannelPublishAction");
  const refuseAt = DISPATCHER.indexOf("requireReapproval");
  const uploadAt = DISPATCHER.search(/uploadVideo|resumable|uploadLocalVideo/);
  assert.ok(recheckAt > 0 && refuseAt > 0, "the dispatcher must recheck policy and be able to refuse");
  assert.ok(recheckAt < refuseAt, "the refusal must follow the recheck it is based on");
  if (uploadAt > 0) {
    assert.ok(
      recheckAt < uploadAt && refuseAt < uploadAt,
      "the policy recheck and its refusal must both precede any upload",
    );
  }
  assert.match(
    DISPATCHER,
    /if \(!decision\.authorized\) \{[\s\S]{0,600}?return \{\s*\n?\s*kind: "deferred"/,
    "an unauthorized recheck must RETURN deferred, never fall through to the upload",
  );
  // Content binding: the bytes uploaded must be the bytes that were reviewed.
  assert.match(
    DISPATCHER,
    /if \(actualSha256 !== intent\.videoSha256\)/,
    "the dispatched file must be the exact artifact the intent was built from",
  );

  // ---- 1. defaults ---------------------------------------------------------
  assert.match(
    UPLOAD,
    /const publishMode = \(ctx\.params\["publishMode"\] as string \| undefined\) \?\? "draft";/,
    "publishMode must default to draft",
  );
  assert.match(
    UPLOAD,
    /let privacyStatus: "private" \| "public" \| "unlisted" = "private";/,
    "privacyStatus must default to private",
  );
  assert.match(
    UPLOAD,
    /throw new Error\("upload_draft: qa did not pass — refusing to upload"\)/,
    "a failed QA must refuse the upload outright",
  );
  assert.match(
    UPLOAD,
    /children-learning episodes may only create private drafts/,
    "the children lane must stay hard-gated to private drafts",
  );

  console.log("PUBLISH GATE PASS — an unauthorized release cannot reach YouTube");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
