import { compareValues, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";

export const runLogLineValidator = v.object({
  block: v.optional(v.string()), level: v.string(), message: v.string(),
  at: v.number(), seq: v.optional(v.number()),
});

type Line = { block?: string; level: string; message: string; at: number; seq?: number };
type TailLine = Omit<Doc<"runLogs">, "_id"> & { _id: string };
const MAX_CHUNK_LINES = 25;
const MAX_CHUNK_BYTES = 64 * 1024;
const MIN_CHUNK_LINES = 4;

export function compareLogPosition(a: Pick<Line, "at" | "seq">, b: Pick<Line, "at" | "seq">): number {
  return compareValues(a.at, b.at) || compareValues(a.seq, b.seq);
}

function packLines(lines: Line[]): Line[][] {
  const packets: Line[][] = [];
  let packet: Line[] = [], bytes = 2;
  const encoder = new TextEncoder();
  for (const line of [...lines].sort(compareLogPosition)) {
    const size = encoder.encode(JSON.stringify(line)).byteLength;
    if (packet.length && (packet.length === MAX_CHUNK_LINES || bytes + size + 1 > MAX_CHUNK_BYTES)) {
      packets.push(packet); packet = []; bytes = 2;
    }
    packet.push(line); bytes += size + 1;
  }
  if (packet.length) packets.push(packet);
  return packets;
}

export async function appendRunLogChunks(ctx: MutationCtx, ownerId: string, runId: Id<"runs">, lines: Line[]) {
  // Small and unusual legacy batches retain their original storage path.
  const finite = lines.every(line => Number.isFinite(line.at) && (line.seq === undefined || Number.isFinite(line.seq)));
  const packets = finite ? packLines(lines) : [lines];
  const canChunk = finite && packets.some(packet => packet.length >= MIN_CHUNK_LINES);
  const head = canChunk ? await ctx.db.query("runLogChunkHeads")
    .withIndex("by_run", q => q.eq("runId", runId)).unique() : null;
  if (head && head.ownerId !== ownerId) throw new Error("Run log chunk owner mismatch");
  let newest = head ? { at: head.endAt, seq: head.endSeq } : undefined;
  let wroteChunk = false;
  for (const packet of packets) {
    // Disjoint ranges bound tail reads even when multiple workers log late.
    if (canChunk && packet.length >= MIN_CHUNK_LINES && (!newest || compareLogPosition(packet[0], newest) > 0)) {
      const end = packet[packet.length - 1];
      await ctx.db.insert("runLogChunks", { ownerId, runId, endAt: end.at, endSeq: end.seq, lines: packet });
      newest = { at: end.at, seq: end.seq }; wroteChunk = true;
    } else {
      for (const line of packet) await ctx.db.insert("runLogs", { ownerId, runId, ...line });
    }
  }
  if (wroteChunk && newest) {
    const next = { ownerId, runId, endAt: newest.at, endSeq: newest.seq };
    if (head) await ctx.db.patch(head._id, next);
    else await ctx.db.insert("runLogChunkHeads", next);
  }
  return lines.length;
}

export async function readRunLogTail(ctx: QueryCtx, runId: Id<"runs">, limit: number): Promise<TailLine[]> {
  const legacy = await ctx.db.query("runLogs")
    .withIndex("by_run_seq", q => q.eq("runId", runId)).order("desc").take(limit);
  const lines: TailLine[] = [...legacy];
  let chunkLines = 0;
  const chunks = ctx.db.query("runLogChunks")
    .withIndex("by_run_end", q => q.eq("runId", runId)).order("desc");
  for await (const chunk of chunks) {
    chunk.lines.forEach((line, index) => lines.push({
      ...line, ownerId: chunk.ownerId, runId: chunk.runId, _creationTime: chunk._creationTime,
      _id: `${chunk._id}:${String(index).padStart(3, "0")}`,
    }));
    chunkLines += chunk.lines.length;
    if (chunkLines >= limit) break;
  }
  if (!chunkLines) return legacy.reverse();
  return lines.sort((a, b) => compareLogPosition(a, b) || a._creationTime - b._creationTime ||
    (a._id < b._id ? -1 : a._id > b._id ? 1 : 0)).slice(-limit);
}

export async function deleteRunLogChunks(ctx: MutationCtx, runId: Id<"runs">): Promise<void> {
  for await (const chunk of ctx.db.query("runLogChunks").withIndex("by_run_end", q => q.eq("runId", runId))) {
    await ctx.db.delete(chunk._id);
  }
  const head = await ctx.db.query("runLogChunkHeads").withIndex("by_run", q => q.eq("runId", runId)).unique();
  if (head) await ctx.db.delete(head._id);
}
