export const MAX_RESEARCH_BODY_BYTES = 4096;
export const MAX_RESEARCH_NICHE_LENGTH = 200;

export class ResearchInputError extends Error {}
export class ResearchChannelError extends Error {}

export function assertResearchOwner(ownerId: unknown, serviceOwnerId: string): asserts ownerId is string {
  if (typeof ownerId !== "string" || !ownerId || ownerId.length > 256 || ownerId !== serviceOwnerId) {
    throw new ResearchInputError("research owner does not match the worker identity");
  }
}

export function parseResearchInput(value: unknown): { niche: string; channelId?: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ResearchInputError("invalid research request");
  const input = value as Record<string, unknown>;
  if (typeof input.niche !== "string") throw new ResearchInputError("niche must be a string");
  const niche = input.niche.trim();
  if (!niche || niche.length > MAX_RESEARCH_NICHE_LENGTH) throw new ResearchInputError(`niche must be between 1 and ${MAX_RESEARCH_NICHE_LENGTH} characters`);
  if (input.channelId !== undefined && (typeof input.channelId !== "string" || !input.channelId.trim() || input.channelId.length > 128 || input.channelId !== input.channelId.trim())) {
    throw new ResearchInputError("invalid channel ID");
  }
  return { niche, ...(typeof input.channelId === "string" ? { channelId: input.channelId } : {}) };
}

export function assertResearchChannel(channel: { ownerId?: unknown; identity?: { niche?: unknown } } | null, ownerId: string, niche: string): void {
  if (!channel || channel.ownerId !== ownerId) throw new ResearchChannelError("channel not found");
  if (typeof channel.identity?.niche !== "string" || channel.identity.niche.trim() !== niche) {
    throw new ResearchChannelError("channel niche changed; review the current settings and retry");
  }
}

export async function readResearchBody(request: Request): Promise<unknown> {
  try { return JSON.parse(await readBoundedRequestText(request, MAX_RESEARCH_BODY_BYTES)) as unknown; }
  catch (error) {
    if (error instanceof RequestBodyTooLarge) throw new ResearchInputError("research request is too large");
    throw new ResearchInputError("invalid JSON body");
  }
}
import { readBoundedRequestText, RequestBodyTooLarge } from "@/lib/readBoundedRequestText";

