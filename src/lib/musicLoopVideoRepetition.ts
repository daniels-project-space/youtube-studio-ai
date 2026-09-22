import { createHash } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { open, stat } from "node:fs/promises";
import { promisify } from "node:util";
import { z } from "zod";

const integer = z.number().int().safe();
const packetSchema = z.object({
  pts: integer, dts: integer, duration: integer.positive(), size: integer.positive().max(32 * 1024 ** 2),
  pos: integer.nonnegative(), flags: z.enum(["K__", "___"]),
  data_hash: z.string().regex(/^SHA256:[a-f0-9]{64}$/u),
}).strict();
type Packet = z.infer<typeof packetSchema>;

/** Only numeric clocks/offsets, fixed flags and hexadecimal hashes are requested. */
export function parseLoopPacket(line: string): Packet {
  if (line.length > 1024) throw new Error("loop packet record exceeds its bounded schema");
  const fields: Record<string, unknown> = {};
  for (const field of line.split("|")) {
    const match = /^([a-z_]+)=([^=|]+)$/u.exec(field);
    if (!match || Object.hasOwn(fields, match[1])) throw new Error("malformed or duplicate loop packet field");
    const [, name, value] = match;
    fields[name] = ["flags", "data_hash"].includes(name) ? value
      : /^-?\d+$/u.test(value) ? Number(value) : Number.NaN;
  }
  return packetSchema.parse(fields);
}

/** Bounded state: retain one 900-packet body, not the complete long-form stream. */
export class MusicLoopPacketVerifier {
  private count = 0;
  private firstDts: number | undefined;
  private readonly positions = new Set<number>();
  private readonly template: string[] = [];
  private readonly digest = createHash("sha256");
  readonly idrPackets: Packet[] = [];
  readonly bodyPackets: Packet[] = [];
  constructor(readonly durationSec: number, readonly ticksPerFrame: number) {
    if (!Number.isSafeInteger(durationSec) || durationSec < 90 || durationSec > 28800 || durationSec % 30 !== 0 ||
      !Number.isSafeInteger(ticksPerFrame) || ticksPerFrame <= 0) {
      throw new Error("repetition qualification requires 90 seconds to 8 hours in complete 30-second units at 30fps");
    }
  }
  accept(input: Packet): void {
    const packet = packetSchema.parse(input);
    const index = this.count++, unit = Math.floor(index / 900), offset = index % 900;
    if (this.count > this.durationSec * 30) throw new Error("loop video has extra packets");
    if (this.firstDts === undefined) {
      this.firstDts = packet.dts;
      if (packet.dts > 0 || packet.dts < -16 * this.ticksPerFrame) throw new Error("unsupported initial decode clock");
    }
    if (packet.duration !== this.ticksPerFrame || packet.dts !== this.firstDts + index * this.ticksPerFrame) {
      throw new Error(`loop decode clock mismatch at packet ${index}`);
    }
    const frame = packet.pts / this.ticksPerFrame - unit * 900;
    if (!Number.isInteger(frame) || frame < 0 || frame >= 900 || this.positions.has(frame)) {
      throw new Error(`loop presentation clock mismatch at packet ${index}`);
    }
    this.positions.add(frame);
    if ((offset === 0 ? "K__" : "___") !== packet.flags || (offset === 0 && frame !== 0)) {
      throw new Error(`loop keyframe boundary mismatch at packet ${index}`);
    }
    if (offset === 0 && unit < 2) this.idrPackets.push(packet);
    const signature = `${frame}:${packet.duration}:${packet.flags}:${packet.size}:${packet.data_hash}`;
    if (unit === 1) { this.template.push(signature); this.bodyPackets.push(packet); }
    if (unit >= 2 && signature !== this.template[offset]) {
      throw new Error(`loop payload or presentation mismatch at packet ${index} (unit ${unit})`);
    }
    this.digest.update(`${index}:${signature}\n`);
    if (offset === 899) this.positions.clear();
  }
  finish() {
    if (this.count !== this.durationSec * 30 || this.template.length !== 900 || this.positions.size) {
      throw new Error("loop packet scan is incomplete");
    }
    return { packetCount: this.count, bodyUnitCount: this.durationSec / 30 - 1,
      comparedBodyPackets: this.count - 1800, uniqueVideoSeconds: 60,
      orderedVideoPacketSha256: this.digest.digest("hex"),
      bodyPacketTemplateSha256: createHash("sha256").update(this.template.join("\n")).digest("hex") };
  }
}

async function fileHash(path: string, signal: AbortSignal) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path, { signal })) hash.update(chunk);
  return hash.digest("hex");
}

/** Repeated units must not inherit changed parameter sets or persistent SEI. */
export function assertStableLoopBodyNal(nal: Buffer, boundaryParameters = false): void {
  const type = nal[0] & 31;
  if ([1, 5, 9, 12].includes(type)) return;
  if (boundaryParameters && (type === 7 || type === 8)) return;
  if (type !== 6) throw new Error(`loop body contains unsupported stateful NAL type ${type}`);
  const rbsp = Buffer.allocUnsafe(nal.length - 1);
  let length = 0;
  for (let i = 1; i < nal.length; i++) {
    if (i >= 3 && nal[i] === 3 && nal[i - 1] === 0 && nal[i - 2] === 0) continue;
    rbsp[length++] = nal[i];
  }
  let offset = 0;
  while (offset < length) {
    if (offset === length - 1 && rbsp[offset] === 0x80) return;
    let payloadType = 0, size = 0;
    while (rbsp[offset] === 255) { payloadType += 255; offset++; }
    if (offset >= length) break;
    payloadType += rbsp[offset++];
    while (rbsp[offset] === 255) { size += 255; offset++; }
    if (offset >= length) break;
    size += rbsp[offset++];
    // x264's encoder identification is unregistered user data, not a decoder
    // parameter update. Other SEI semantics require separate qualification.
    if (payloadType !== 5 || size < 16 || offset + size >= length) {
      throw new Error("loop body contains unsupported persistent or malformed SEI");
    }
    offset += size;
  }
  throw new Error("loop body contains malformed SEI framing");
}

/** Qualification oracle, not release authority or a substitute for visual/audio review. */
export async function verifyMusicLoopVideoRepetition(path: string, durationSec: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 300_000);
  const { signal } = controller;
  const started = performance.now();
  const ffprobe = process.env.FFPROBE_BIN ?? "ffprobe";
  try {
    // Validate the bounded layout before reading an operator-supplied file.
    new MusicLoopPacketVerifier(durationSec, 1);
    const file = await stat(path);
    if (!file.isFile()) throw new Error("loop verification requires a regular local master");
    const before = await fileHash(path, signal);
    const metadata = await promisify(execFile)(ffprobe, ["-v", "error", "-select_streams", "v",
      "-show_entries", "stream=codec_name,width,height,time_base,r_frame_rate,avg_frame_rate,duration_ts,nb_frames,is_avc,nal_length_size",
      "-of", "json", path], { encoding: "utf8", maxBuffer: 1024 * 1024, signal, killSignal: "SIGKILL" });
    const stream = z.object({ streams: z.array(z.object({
      codec_name: z.literal("h264"), is_avc: z.literal("true"), nal_length_size: z.literal("4"),
      r_frame_rate: z.literal("30/1"), avg_frame_rate: z.literal("30/1"),
      time_base: z.string().regex(/^1\/[1-9]\d*$/u), duration_ts: integer.positive(),
      nb_frames: z.string().regex(/^[1-9]\d*$/u), width: integer.positive(), height: integer.positive(),
    })).length(1) }).parse(JSON.parse(metadata.stdout)).streams[0];
    const ticksPerSecond = Number(stream.time_base.slice(2));
    const verifier = new MusicLoopPacketVerifier(durationSec, ticksPerSecond / 30);
    if (stream.duration_ts !== durationSec * ticksPerSecond || Number(stream.nb_frames) !== durationSec * 30) {
      throw new Error("loop stream metadata does not match the requested final clock");
    }
    const child = spawn(ffprobe, ["-v", "error", "-select_streams", "v:0", "-show_packets",
      "-show_data_hash", "sha256", "-show_entries", "packet=pts,dts,duration,size,pos,flags,data_hash",
      "-of", "compact=p=0:nk=0", path], { stdio: ["ignore", "pipe", "pipe"], signal, killSignal: "SIGKILL" });
    let processError: Error | undefined, stderr = "", pending = "";
    child.stderr.on("data", chunk => { stderr = (stderr + chunk.toString()).slice(-4096); });
    child.on("error", error => { processError = error; });
    const closed = new Promise<number | null>(resolve => child.once("close", resolve));
    try {
      for await (const chunk of child.stdout) {
        pending += chunk.toString();
        let newline: number;
        while ((newline = pending.indexOf("\n")) !== -1) {
          const line = pending.slice(0, newline).trim(); pending = pending.slice(newline + 1);
          if (line) verifier.accept(parseLoopPacket(line));
        }
        if (pending.length > 1024) throw new Error("unbounded loop packet record");
      }
      if (pending.trim()) verifier.accept(parseLoopPacket(pending.trim()));
      const code = await closed;
      if (processError || code !== 0 || stderr.trim()) throw new Error(`loop packet scan failed: ${processError?.message ?? stderr ?? code}`);
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      await closed;
    }
    const packets = verifier.finish();
    // A keyframe flag alone does not prove independent decoder reset. Inspect
    // AVCC NAL framing and require IDR slices at the intro and body boundaries.
    const handle = await open(path, "r");
    try {
      let sawSlice = false;
      const boundaryParameters = new Set<number>();
      for (const packet of verifier.bodyPackets) {
        signal.throwIfAborted();
        const bytes = Buffer.alloc(packet.size);
        const read = await handle.read(bytes, 0, bytes.length, packet.pos);
        if (read.bytesRead !== bytes.length || `SHA256:${createHash("sha256").update(bytes).digest("hex")}` !== packet.data_hash) {
          throw new Error("loop body changed during decoder-state inspection");
        }
        let offset = 0;
        while (offset < bytes.length) {
          if (offset + 4 >= bytes.length) throw new Error("invalid loop body AVCC framing");
          const size = bytes.readUInt32BE(offset); offset += 4;
          if (!size || offset + size > bytes.length) throw new Error("invalid loop body NAL length");
          const nal = bytes.subarray(offset, offset + size), type = nal[0] & 31;
          const boundaryParameter = packet === verifier.bodyPackets[0] && !sawSlice && (type === 7 || type === 8);
          if (boundaryParameter) {
            if (boundaryParameters.has(type)) throw new Error("loop body has ambiguous boundary parameter sets");
            boundaryParameters.add(type);
          }
          assertStableLoopBodyNal(nal, boundaryParameter);
          if (type === 1 || type === 5) sawSlice = true;
          offset += size;
        }
      }
      if (boundaryParameters.size !== 2) throw new Error("loop body lacks repeated SPS/PPS initialization before its IDR");
      for (const packet of verifier.idrPackets) {
        signal.throwIfAborted();
        const bytes = Buffer.alloc(packet.size);
        const read = await handle.read(bytes, 0, bytes.length, packet.pos);
        if (read.bytesRead !== bytes.length || `SHA256:${createHash("sha256").update(bytes).digest("hex")}` !== packet.data_hash) {
          throw new Error("loop boundary bytes changed during inspection");
        }
        let offset = 0, idr = false;
        while (offset < bytes.length) {
          if (offset + 4 >= bytes.length) throw new Error("invalid loop AVCC boundary");
          const size = bytes.readUInt32BE(offset); offset += 4;
          if (!size || offset + size > bytes.length) throw new Error("invalid loop NAL length");
          const type = bytes[offset] & 31;
          if (type >= 1 && type <= 4) throw new Error("loop boundary is not an IDR reset");
          if (type === 5) idr = true;
          offset += size;
        }
        if (!idr) throw new Error("loop boundary contains no IDR slice");
      }
    } finally { await handle.close(); }
    if (await fileHash(path, signal) !== before) throw new Error("master changed during loop qualification");
    const after = await stat(path);
    if (after.size !== file.size || after.ino !== file.ino || after.dev !== file.dev || after.mtimeMs !== file.mtimeMs) {
      throw new Error("master identity or size changed during loop qualification");
    }
    return { version: "music-loop-video-repetition/v1" as const, masterSha256: before, masterBytes: file.size,
      durationSec, width: stream.width, height: stream.height, fps: 30, unitSeconds: 30, ...packets,
      independentIdrBoundariesVerified: true, elapsedMs: Math.round(performance.now() - started),
      stableDecoderParametersVerified: true,
      scope: "all video packets and clocks; not decoded visual quality, audio continuity, source approval or release authority" };
  } finally { clearTimeout(timer); }
}
