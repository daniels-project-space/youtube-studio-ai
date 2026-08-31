import { NextResponse } from "next/server";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import {
  MAX_ROUTE_QUALIFICATION_BENCHMARK_COST_USD,
  routeQualificationBenchmarkRequestApprovalSubject,
} from "@/lib/routeQualificationBenchmark";
import { issueStudioActionApproval } from "@/lib/studioActionApproval";
import { StudioConvexHttpClient } from "@/lib/studioConvexHttpClient";
import { requireStudioActor, StudioAuthError } from "@/lib/operatorSession";

export const runtime = "nodejs";

const routeQualificationBenchmarkRunsApi = (api as unknown as {
  readonly routeQualificationBenchmarkRuns: {
    readonly createShell: never;
    readonly claimRequestApproval: never;
  };
}).routeQualificationBenchmarkRuns;

class RouteQualificationBenchmarkRequestError extends Error {}

function convexClient(): StudioConvexHttpClient {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
  if (!url) throw new Error("Convex URL is not configured");
  return new StudioConvexHttpClient(url);
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RouteQualificationBenchmarkRequestError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requiredId(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > 300 || /[\u0000-\u001f]/.test(value)) {
    throw new RouteQualificationBenchmarkRequestError(`${label} is required`);
  }
  return value;
}

function requestBody(value: unknown): {
  readonly channelId: string;
  readonly requestKey: string;
  readonly maximumCostUsd: number;
} {
  const body = record(value, "request body");
  const unexpected = Object.keys(body).filter((key) => ![
    "channelId",
    "requestKey",
    "maximumCostUsd",
    "confirmPrivateBenchmark",
  ].includes(key));
  if (unexpected.length) {
    throw new RouteQualificationBenchmarkRequestError(`unrecognized fields: ${unexpected.join(", ")}`);
  }
  if (body.confirmPrivateBenchmark !== true) {
    throw new RouteQualificationBenchmarkRequestError(
      "confirmPrivateBenchmark must be true; this runs a private final-master benchmark and can spend up to the stated ceiling",
    );
  }
  const maximumCostUsd = body.maximumCostUsd;
  if (
    typeof maximumCostUsd !== "number" ||
    !Number.isFinite(maximumCostUsd) ||
    maximumCostUsd <= 0 ||
    maximumCostUsd > MAX_ROUTE_QUALIFICATION_BENCHMARK_COST_USD
  ) {
    throw new RouteQualificationBenchmarkRequestError(
      `maximumCostUsd must be greater than zero and no more than $${MAX_ROUTE_QUALIFICATION_BENCHMARK_COST_USD}`,
    );
  }
  return {
    channelId: requiredId(body.channelId, "channelId"),
    requestKey: requiredId(body.requestKey, "requestKey"),
    maximumCostUsd,
  };
}

function responseError(error: unknown) {
  if (error instanceof StudioAuthError) {
    return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
  }
  if (error instanceof RouteQualificationBenchmarkRequestError) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
  }
  const message = error instanceof Error ? error.message : "Route qualification benchmark could not be requested";
  const status = /qualification|route|channel|benchmark/i.test(message) ? 422 : 500;
  return NextResponse.json({ ok: false, error: message }, { status });
}

/**
 * Explicit owner-only request. It intentionally records no pipeline, prompt,
 * model, source, or provider data from the browser. The durable dispatcher
 * reloads the current sealed route and only then prepares the exact private
 * benchmark envelope.
 */
export async function POST(request: Request) {
  try {
    const actor = await requireStudioActor(request);
    const body = requestBody(await request.json());
    const convex = convexClient();
    const channel = await convex.query(api.channels.getChannel, {
      channelId: body.channelId as Id<"channels">,
    }) as unknown as Record<string, unknown> | null;
    if (!channel || channel.ownerId !== actor.ownerId) {
      throw new RouteQualificationBenchmarkRequestError("channel is not owned by this operator");
    }
    const dispatchKey = `route-qualification-benchmark:${body.requestKey}`;
    // Allocate the durable id before signing the request. Any repeated click
    // reuses this exact owner/channel/request-key authority rather than
    // creating a second cost-bearing run.
    const provisional = await convex.mutation(routeQualificationBenchmarkRunsApi.createShell, {
      ownerId: actor.ownerId,
      channelId: body.channelId as Id<"channels">,
      dispatchKey,
      now: Date.now(),
    } as never) as unknown as { state: "created" | "shell" | "reused"; runId: Id<"runs"> };
    const durableRun = await convex.query(api.runs.getRun, { runId: provisional.runId }) as unknown as Record<string, unknown> | null;
    if (!durableRun || durableRun.ownerId !== actor.ownerId || String(durableRun.channelId) !== body.channelId) {
      throw new Error("route qualification benchmark durable shell could not be reloaded");
    }
    if (durableRun.routeQualificationBenchmarkRequestApproval === undefined) {
      const approval = issueStudioActionApproval({
        action: "route-qualification-benchmark-request",
        ownerId: actor.ownerId,
        subject: routeQualificationBenchmarkRequestApprovalSubject({
          ownerId: actor.ownerId,
          channelId: body.channelId,
          runId: String(provisional.runId),
          dispatchKey,
          maximumCostUsd: body.maximumCostUsd,
        }),
        actor: `authenticated-operator:${actor.ownerId}`,
        evidence: `Owner confirmed private route qualification benchmark request (${body.requestKey})`,
        maxCostUsd: body.maximumCostUsd,
      });
      await convex.mutation(routeQualificationBenchmarkRunsApi.claimRequestApproval, {
        ownerId: actor.ownerId,
        channelId: body.channelId as Id<"channels">,
        runId: provisional.runId,
        maximumCostUsd: body.maximumCostUsd,
        approval,
        now: Date.now(),
      } as never);
    } else if (durableRun.routeQualificationBenchmarkMaximumCostUsd !== body.maximumCostUsd) {
      throw new RouteQualificationBenchmarkRequestError(
        "this requestKey is already bound to a different private benchmark cost ceiling",
      );
    }
    return NextResponse.json(
      {
        ok: true,
        state: provisional.state === "reused" ? "reused" : "queued_for_preparation",
        runId: String(provisional.runId),
        privateOnly: true,
        publishAuthority: false,
        maximumCostUsd: body.maximumCostUsd,
      },
      { status: 202, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return responseError(error);
  }
}
