/** Native Fal Nano Banana channel-banner adapter with receipt-bound output. */
import { deflateSync } from "node:zlib";

import {
  generateFalNanoBananaWideImageWithReceipt,
  hasFalNanoBananaWideImage,
} from "@/lib/falNanoBananaWideImage";
import {
  FAL_NANO_BANANA_BANNER_PROFILE,
  type FalNanoBananaBannerReceipt,
} from "@/lib/falNanoBananaBannerContract";

export interface FalNanoBananaBannerResult {
  bytes: Buffer;
  receipt: FalNanoBananaBannerReceipt;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffff_ffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb8_8320 : 0);
  }
  return (crc ^ 0xffff_ffff) >>> 0;
}

function pngChunk(type: string, payload: Uint8Array): Buffer {
  const chunk = Buffer.allocUnsafe(12 + payload.byteLength);
  chunk.writeUInt32BE(payload.byteLength, 0);
  chunk.write(type, 4, 4, "ascii");
  Buffer.from(payload).copy(chunk, 8);
  chunk.writeUInt32BE(crc32(chunk.subarray(4, 8 + payload.byteLength)), 8 + payload.byteLength);
  return chunk;
}

/**
 * The original Nano Banana endpoint can return a 16:9 composition nested in
 * its own 7:4 result frame, or overfill a hero beyond the device-safe band.
 * Its edit route transforms this full-bleed canvas and its compact neutral
 * silhouette instead, so no textual or pixel post-processing is involved.
 */
function canonicalBannerCanvasDataUri(): string {
  const width = 1_344;
  const height = 756;
  const stride = width * 3 + 1;
  const raw = Buffer.allocUnsafe(stride * height);
  for (let y = 0; y < height; y++) {
    const offset = y * stride;
    raw[offset] = 0; // PNG filter: None.
    for (let x = 0; x < width; x++) {
      const pixel = offset + 1 + x * 3;
      const head = ((x - width / 2) / 58) ** 2 + ((y - 350) / 62) ** 2 <= 1;
      const shoulders = ((x - width / 2) / 145) ** 2 + ((y - 425) / 82) ** 2 <= 1;
      if (head || shoulders) {
        // A deliberately abstract guide, not reusable art: Nano Banana turns
        // this into the channel-specific motif while keeping it compact.
        raw[pixel] = 0x8a;
        raw[pixel + 1] = 0x90;
        raw[pixel + 2] = 0x94;
      } else {
        raw[pixel] = 0x16;
        raw[pixel + 1] = 0x1b;
        raw[pixel + 2] = 0x20;
      }
    }
  }
  const ihdr = Buffer.allocUnsafe(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolour RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
  return `data:image/png;base64,${png.toString("base64")}`;
}

export function hasFalNanoBananaBanner(): boolean {
  return hasFalNanoBananaWideImage();
}

export async function generateFalNanoBananaBannerWithReceipt(args: {
  prompt: string;
  idempotencyContext: string;
}): Promise<FalNanoBananaBannerResult> {
  const generated = await generateFalNanoBananaWideImageWithReceipt({
    profile: FAL_NANO_BANANA_BANNER_PROFILE,
    // Nano Banana occasionally interprets an aspect-ratio phrase in a creative
    // prompt as an instruction to *draw* a wide image inside its own canvas.
    // The reference is the geometry authority; give that edit instruction
    // before the channel brief so it paints one seamless scene into all edges.
    prompt: [
      "EDIT INSTRUCTION: the supplied reference is the complete output canvas. Replace it with one " +
        "seamless scene painted directly to all four edges. Preserve the reference canvas geometry; " +
        "do not depict, frame, inset, letterbox, pillarbox, or surround another image inside it.",
      "LAYOUT INSTRUCTION: the pale compact central head-and-shoulders silhouette in the reference is " +
        "a binding placement guide. Transform it into the requested hero, but keep the complete hero " +
        "within that guide's compact middle-band footprint; do not enlarge it, move it upward, or crop it.",
      args.prompt,
    ].join("\n\n"),
    idempotencyContext: args.idempotencyContext,
    label: "Fal Nano Banana channel banner",
    referenceImageDataUri: canonicalBannerCanvasDataUri(),
  });
  return {
    bytes: generated.bytes,
    receipt: generated.receipt as FalNanoBananaBannerReceipt,
  };
}
