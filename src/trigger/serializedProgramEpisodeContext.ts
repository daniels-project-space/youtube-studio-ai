import type { StageContext } from "@/engine/types";
import {
  channelProgramRouteRunSeedFingerprint,
  parseChannelProgramRouteRunSeed,
  type ChannelProgramRouteRunSeed,
} from "@/engine/channelProgramRoute";
import {
  assertSerializedProgramEpisodeContextBinding,
  type SerializedProgramEpisodeContext,
} from "@/lib/serializedProgramEpisodeContext";
import { serializedProgramEpisodeIdentity } from "@/lib/serializedProgramEpisode";

function frozenSerializedProgramRoute(ctx: StageContext): ChannelProgramRouteRunSeed | undefined {
  const raw = ctx.store["channelProgramRoute"];
  if (raw === undefined) return undefined;
  const route = parseChannelProgramRouteRunSeed(raw);
  if (!route.serializedProgram) return undefined;
  return route;
}

/**
 * Optional consumer boundary for the immutable serial receipt. Non-serialized
 * and legacy routes retain their exact behavior; a supplied context always
 * has to bind to the frozen route/run/topic before a consumer can use it.
 */
export function serializedProgramEpisodeContextForStage(
  ctx: StageContext,
  stage: string,
): SerializedProgramEpisodeContext | undefined {
  const rawContext = ctx.store["serializedProgramEpisodeContext"];
  const route = frozenSerializedProgramRoute(ctx);
  if (rawContext === undefined) return undefined;
  if (!route) {
    throw new Error(`${stage}: serialized program episode context requires a frozen serialized_program/v1 route`);
  }
  const identity = serializedProgramEpisodeIdentity(route);
  if (!identity) {
    throw new Error(`${stage}: serialized program episode context route identity is unavailable`);
  }
  const topic = typeof ctx.store["topic"] === "string" ? ctx.store["topic"] : undefined;
  return assertSerializedProgramEpisodeContextBinding({
    context: rawContext,
    routeFingerprint: route.routeFingerprint,
    routeRunSeedFingerprint: channelProgramRouteRunSeedFingerprint(route),
    runId: ctx.runId,
    seriesIdentity: identity.value,
    seriesTitle: identity.seriesTitle,
    ...(identity.seriesCount === undefined ? {} : { seriesCount: identity.seriesCount }),
    ...(topic === undefined ? {} : { topic }),
  });
}

export function requireSerializedProgramEpisodeContextRoute(
  ctx: StageContext,
  stage: string,
): {
  readonly route: ChannelProgramRouteRunSeed;
  readonly identity: NonNullable<ReturnType<typeof serializedProgramEpisodeIdentity>>;
  readonly routeRunSeedFingerprint: string;
} {
  const route = frozenSerializedProgramRoute(ctx);
  if (!route) {
    throw new Error(`${stage}: block is route-owned and only valid for serialized_program/v1`);
  }
  const identity = serializedProgramEpisodeIdentity(route);
  if (!identity) throw new Error(`${stage}: serialized program route identity is unavailable`);
  return { route, identity, routeRunSeedFingerprint: channelProgramRouteRunSeedFingerprint(route) };
}
