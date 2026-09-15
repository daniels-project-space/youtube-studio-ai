import { NextResponse } from "next/server";

import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import {
  channelArtIdentityFromSource,
  generateChannelArtAssetWithProvenance,
} from "@/lib/channelArt";
import { requireStudioActor, StudioAuthError } from "@/lib/operatorSession";
import { StudioConvexHttpClient } from "@/lib/studioConvexHttpClient";

export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_ATTEMPTS = 3;
const MAX_PROVIDER_SPEND_USD = 0.12;

function client(): StudioConvexHttpClient {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
  if (!url) throw new Error("Convex URL is not configured");
  return new StudioConvexHttpClient(url);
}

function body(value: unknown): {
  slug: string;
  kind: "avatar" | "banner";
  expectedAssetKey: string | null;
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Channel-art refresh request must be an object");
  }
  const input = value as Record<string, unknown>;
  const allowed = ["slug", "kind", "expectedAssetKey", "expectedBannerKey"];
  const unexpected = Object.keys(input).filter((key) => !allowed.includes(key));
  if (unexpected.length) throw new Error(`Unrecognized channel-art refresh fields: ${unexpected.join(", ")}`);
  if (typeof input.slug !== "string" || !/^[a-z0-9][a-z0-9-]{1,120}$/u.test(input.slug)) {
    throw new Error("Channel-art refresh slug is invalid");
  }
  const kind = input.kind === undefined ? "banner" : input.kind;
  if (kind !== "avatar" && kind !== "banner") throw new Error("Channel-art refresh kind is invalid");
  // Keep the original banner field accepted for existing clients while using
  // one typed asset revision for the new avatar action.
  if (Object.prototype.hasOwnProperty.call(input, "expectedAssetKey") &&
      Object.prototype.hasOwnProperty.call(input, "expectedBannerKey") &&
      input.expectedAssetKey !== input.expectedBannerKey) {
    throw new Error("Channel-art refresh asset revisions disagree");
  }
  const rawExpected = Object.prototype.hasOwnProperty.call(input, "expectedAssetKey")
    ? input.expectedAssetKey
    : input.expectedBannerKey;
  if (rawExpected !== null && typeof rawExpected !== "string") {
    throw new Error(`Channel-art refresh ${kind} revision is invalid`);
  }
  if (rawExpected === undefined) throw new Error(`Channel-art refresh ${kind} revision is required`);
  return { slug: input.slug, kind, expectedAssetKey: rawExpected as string | null };
}

export async function POST(request: Request) {
  try {
    const actor = await requireStudioActor(request);
    const requested = body(await request.json());
    const convex = client();
    const channel = await convex.query(api.channels.getChannelBySlug, {
      ownerId: actor.ownerId,
      slug: requested.slug,
    });
    if (!channel) {
      return NextResponse.json({ ok: false, error: "Channel not found" }, { status: 404 });
    }
    if (channel.locked) {
      return NextResponse.json({ ok: false, error: `This channel is locked; unlock it before changing its ${requested.kind}` }, { status: 409 });
    }
    const currentAssetKey = requested.kind === "avatar"
      ? channel.identity?.imageKey ?? null
      : channel.identity?.bannerKey ?? null;
    if (currentAssetKey !== requested.expectedAssetKey) {
      return NextResponse.json({
        ok: false,
        error: `The ${requested.kind} changed before refresh started. The current image is still intact; reload and try again.`,
      }, { status: 409 });
    }

    const artIdentity = channelArtIdentityFromSource({
      name: channel.name,
      identity: channel.identity,
      styleDNA: channel.styleDNA,
    });
    const generated = await generateChannelArtAssetWithProvenance(
      actor.ownerId,
      channel.slug,
      requested.kind,
      artIdentity,
      () => {},
      {
        version: requested.kind === "avatar"
          ? { avatar: `operator-refresh-${Date.now()}-v1` }
          : { banner: `operator-refresh-${Date.now()}-v1` },
        maxAttempts: MAX_ATTEMPTS,
        maxProviderSpendUsd: MAX_PROVIDER_SPEND_USD,
      },
    );

    const result = await convex.mutation(api.channels.applyChannelArtAsset, {
      ownerId: actor.ownerId,
      channelId: channel._id as Id<"channels">,
      kind: requested.kind,
      expectedAssetKey: requested.expectedAssetKey,
      assetKey: generated.key,
      provenance: generated.provenance,
    });
    if (!result.applied) {
      return NextResponse.json({ ok: false, error: "The channel was locked while the candidate was rendering" }, { status: 409 });
    }
    return NextResponse.json({
      ok: true,
      ...(requested.kind === "avatar" ? { imageKey: generated.key } : { bannerKey: generated.key }),
      directionFingerprint: generated.provenance.directionFingerprint,
      approvalKey: generated.provenance.approvalKey,
      maximumAttempts: MAX_ATTEMPTS,
      maximumSpendUsd: MAX_PROVIDER_SPEND_USD,
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof StudioAuthError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Could not refresh the channel banner";
    const status = /invalid|unrecognized|changed|locked|judge|banner/i.test(message) ? 422 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
