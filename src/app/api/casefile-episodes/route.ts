import { NextResponse } from "next/server";

import { api } from "../../../../convex/_generated/api";
import { StudioConvexHttpClient } from "@/lib/studioConvexHttpClient";
import { requireStudioActor, StudioAuthError } from "@/lib/operatorSession";

export const runtime = "nodejs";

class CasefileRequestError extends Error {}

function convexClient(): StudioConvexHttpClient {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
  if (!url) throw new Error("Convex URL is not configured");
  return new StudioConvexHttpClient(url);
}

function requiredObject(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CasefileRequestError(`${name} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requiredArray(value: unknown, name: string): unknown[] {
  if (!Array.isArray(value)) throw new CasefileRequestError(`${name} must be an array`);
  return value;
}

function requiredId(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new CasefileRequestError("episodeId is required");
  }
  return value;
}

const sourceProofAttachmentFields = [
  "shotId",
  "sourceId",
  "assetId",
  "rightsEvidenceLocator",
  "assetUrl",
  "assetSha256",
  "approvalReceiptId",
] as const;

/**
 * Keep the browser's source-proof handoff deliberately narrow. The workflow
 * derives all packet/provenance fields from the owned episode before it can
 * freeze the exact approved asset obligation.
 */
export function sourceProofMediaAttachments(body: Record<string, unknown>): unknown[] {
  const permittedRequestFields = new Set(["action", "episodeId", "attachments"]);
  const unexpectedRequestFields = Object.keys(body).filter((key) => !permittedRequestFields.has(key));
  if (unexpectedRequestFields.length) {
    throw new CasefileRequestError(
      `source-proof media accepts only action, episodeId, and attachments; unrecognized ${unexpectedRequestFields.join(", ")}`,
    );
  }
  const attachments = requiredArray(body.attachments, "attachments");
  return attachments.map((attachment, index) => {
    const input = requiredObject(attachment, `attachments[${index}]`);
    const unexpectedFields = Object.keys(input).filter(
      (key) => !sourceProofAttachmentFields.includes(key as (typeof sourceProofAttachmentFields)[number]),
    );
    if (unexpectedFields.length) {
      throw new CasefileRequestError(
        `attachments[${index}] contains unrecognized ${unexpectedFields.join(", ")}; packet/provenance fields are server-derived`,
      );
    }
    const missingFields = sourceProofAttachmentFields.filter((key) => input[key] === undefined);
    if (missingFields.length) {
      throw new CasefileRequestError(`attachments[${index}] is missing ${missingFields.join(", ")}`);
    }
    return input;
  });
}

function responseError(error: unknown) {
  if (error instanceof StudioAuthError) {
    return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
  }
  if (error instanceof CasefileRequestError) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
  }
  const message = error instanceof Error ? error.message : "Casefile episode workflow failed";
  // The engine produces concrete remediation-rich admission errors. They are
  // an invalid operator submission, not an infrastructure outage.
  const status = /casefile|cinematic draft|expected awaiting_|required before/i.test(message) ? 422 : 500;
  return NextResponse.json({ ok: false, error: message }, { status });
}

/**
 * A private, authenticated editor API for the two-phase Casefile workflow.
 * It performs no provider calls, no render dispatch, and no publishing. The
 * final state is merely the exact package a separately approved Novita render
 * action must consume.
 */
export async function POST(request: Request) {
  try {
    const actor = await requireStudioActor(request);
    const body = (await request.json()) as Record<string, unknown>;
    const action = body.action;
    if (typeof action !== "string") throw new CasefileRequestError("action is required");
    const convex = convexClient();
    const now = Date.now();

    if (action === "admit_source") {
      const episode = await convex.mutation(api.casefileEpisodes.admitSource, {
        ownerId: actor.ownerId,
        sourcePacket: requiredObject(body.sourcePacket, "sourcePacket"),
        now,
      });
      return NextResponse.json({ ok: true, episode });
    }

    const episodeId = requiredId(body.episodeId);
    if (action === "attach_planning") {
      const episode = await convex.mutation(api.casefileEpisodes.attachPlanning, {
        ownerId: actor.ownerId,
        episodeId: episodeId as never,
        sceneManifest: requiredObject(body.sceneManifest, "sceneManifest"),
        shotList: Array.isArray(body.shotList)
          ? body.shotList
          : (() => { throw new CasefileRequestError("shotList must be an array"); })(),
        now,
      });
      return NextResponse.json({ ok: true, episode });
    }
    if (action === "admit_evidence_map") {
      const episode = await convex.mutation(api.casefileEpisodes.admitEvidenceMap, {
        ownerId: actor.ownerId,
        episodeId: episodeId as never,
        evidenceShotMapInput: requiredObject(body.evidenceShotMapInput, "evidenceShotMapInput"),
        now,
      });
      return NextResponse.json({ ok: true, episode });
    }
    if (action === "attach_reference_mechanics") {
      const episode = await convex.mutation(api.casefileEpisodes.attachReferenceMechanics, {
        ownerId: actor.ownerId,
        episodeId: episodeId as never,
        // This intentionally accepts only the seven original-expression
        // annotations and a human review draft. Source URLs/labels, hashes,
        // policies, and the current ShotPlan binding are derived server-side.
        mechanics: requiredObject(body.mechanics, "mechanics"),
        review: requiredObject(body.review, "review"),
        now,
      });
      return NextResponse.json({ ok: true, episode });
    }
    if (action === "attach_source_bound_story_spine") {
      const episode = await convex.mutation(api.casefileEpisodes.attachSourceBoundStorySpine, {
        ownerId: actor.ownerId,
        episodeId: episodeId as never,
        storySpine: requiredObject(body.storySpine, "storySpine"),
        now,
      });
      return NextResponse.json({ ok: true, episode });
    }
    if (action === "attach_narrative_evidence_ledger") {
      const episode = await convex.mutation(api.casefileEpisodes.attachNarrativeEvidenceLedger, {
        ownerId: actor.ownerId,
        episodeId: episodeId as never,
        // The desk derives the Casefile rail, canonical fingerprint, release,
        // and review binding. Operators may provide only claim annotations,
        // optional relations, and a human review draft.
        claims: requiredArray(body.claims, "claims"),
        ...(body.relations === undefined ? {} : { relations: requiredArray(body.relations, "relations") }),
        review: requiredObject(body.review, "review"),
        now,
      });
      return NextResponse.json({ ok: true, episode });
    }
    if (action === "draft_cinematic_sequence") {
      const episode = await convex.mutation(api.casefileEpisodes.draftCinematicSequence, {
        ownerId: actor.ownerId,
        episodeId: episodeId as never,
        direction: requiredObject(body.direction, "direction"),
        now,
      });
      return NextResponse.json({ ok: true, episode });
    }
    if (action === "attach_source_proof_media") {
      const episode = await convex.mutation(api.casefileEpisodes.attachSourceProofMedia, {
        ownerId: actor.ownerId,
        episodeId: episodeId as never,
        // The engine validates this strict attachment-only payload against the
        // owned episode's current source packet, rights entitlement, and
        // source-proof shot obligations before any workflow state is stored.
        attachments: sourceProofMediaAttachments(body),
        now,
      });
      return NextResponse.json({ ok: true, episode });
    }
    if (action === "finalize_cinematic_sequence") {
      const episode = await convex.mutation(api.casefileEpisodes.finalizeCinematicSequence, {
        ownerId: actor.ownerId,
        episodeId: episodeId as never,
        editorialReview: requiredObject(body.editorialReview, "editorialReview"),
        now,
      });
      return NextResponse.json({ ok: true, episode });
    }
    throw new CasefileRequestError("unknown Casefile workflow action");
  } catch (error) {
    return responseError(error);
  }
}

export async function GET(request: Request) {
  try {
    const actor = await requireStudioActor(request);
    const episodeId = new URL(request.url).searchParams.get("episodeId");
    const convex = convexClient();
    if (episodeId) {
      const episode = await convex.query(api.casefileEpisodes.get, {
        ownerId: actor.ownerId,
        episodeId: episodeId as never,
      });
      return NextResponse.json({ ok: true, episode });
    }
    const episodes = await convex.query(api.casefileEpisodes.listForOwner, {
      ownerId: actor.ownerId,
    });
    return NextResponse.json({ ok: true, episodes });
  } catch (error) {
    return responseError(error);
  }
}
