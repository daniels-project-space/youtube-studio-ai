import assert from "node:assert/strict";

import { rasterImageDimensions } from "@/lib/imageDimensions";

function png(width: number, height: number): Buffer {
  const bytes = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes);
  bytes.writeUInt32BE(13, 8);
  bytes.write("IHDR", 12, "ascii");
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}

function jpeg(width: number, height: number): Buffer {
  const bytes = Buffer.alloc(23);
  bytes.set([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x0b, 0x08]);
  bytes.writeUInt16BE(height, 13);
  bytes.writeUInt16BE(width, 15);
  bytes.set([0x01, 0x01, 0x11, 0x00, 0xff, 0xd9], 17);
  return bytes;
}

function webpExtended(width: number, height: number): Buffer {
  const bytes = Buffer.alloc(30);
  bytes.write("RIFF", 0, "ascii");
  bytes.writeUInt32LE(22, 4);
  bytes.write("WEBPVP8X", 8, "ascii");
  bytes.writeUInt32LE(10, 16);
  const write24 = (offset: number, value: number) => {
    bytes[offset] = value & 0xff;
    bytes[offset + 1] = (value >>> 8) & 0xff;
    bytes[offset + 2] = (value >>> 16) & 0xff;
  };
  write24(24, width - 1);
  write24(27, height - 1);
  return bytes;
}

assert.deepEqual(rasterImageDimensions(png(1_344, 768)), {
  width: 1_344,
  height: 768,
  contentType: "image/png",
});
assert.deepEqual(rasterImageDimensions(jpeg(1_280, 720)), {
  width: 1_280,
  height: 720,
  contentType: "image/jpeg",
});
assert.deepEqual(rasterImageDimensions(webpExtended(1_344, 768)), {
  width: 1_344,
  height: 768,
  contentType: "image/webp",
});
assert.throws(() => rasterImageDimensions(Buffer.from([1, 2, 3])), /unsupported or malformed/);
assert.throws(() => rasterImageDimensions(png(0, 720)), /invalid PNG width/);

console.log("IMAGE DIMENSIONS PASS");
