export type SupportedRasterContentType = "image/jpeg" | "image/png" | "image/webp";

export interface RasterImageDimensions {
  width: number;
  height: number;
  contentType: SupportedRasterContentType;
}

function positiveDimension(value: number, label: string): number {
  if (!Number.isInteger(value) || value <= 0 || value > 65_535) {
    throw new Error(`image dimensions: invalid ${label} ${value}`);
  }
  return value;
}

function pngDimensions(bytes: Uint8Array): RasterImageDimensions | null {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 24 || !signature.every((value, index) => bytes[index] === value)) {
    return null;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(8) !== 13 || String.fromCharCode(...bytes.subarray(12, 16)) !== "IHDR") {
    throw new Error("image dimensions: PNG is missing its leading IHDR chunk");
  }
  return {
    width: positiveDimension(view.getUint32(16), "PNG width"),
    height: positiveDimension(view.getUint32(20), "PNG height"),
    contentType: "image/png",
  };
}

function jpegDimensions(bytes: Uint8Array): RasterImageDimensions | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const startOfFrame = new Set([
    0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7,
    0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
  ]);
  let offset = 2;
  while (offset + 3 < bytes.length) {
    while (offset < bytes.length && bytes[offset] !== 0xff) offset++;
    while (offset < bytes.length && bytes[offset] === 0xff) offset++;
    if (offset >= bytes.length) break;
    const marker = bytes[offset++];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) continue;
    if (marker === 0xda || marker === 0xd9 || offset + 2 > bytes.length) break;
    const segmentLength = view.getUint16(offset);
    if (segmentLength < 2 || offset + segmentLength > bytes.length) {
      throw new Error("image dimensions: malformed JPEG segment");
    }
    if (startOfFrame.has(marker)) {
      if (segmentLength < 7) throw new Error("image dimensions: malformed JPEG frame header");
      return {
        width: positiveDimension(view.getUint16(offset + 5), "JPEG width"),
        height: positiveDimension(view.getUint16(offset + 3), "JPEG height"),
        contentType: "image/jpeg",
      };
    }
    offset += segmentLength;
  }
  throw new Error("image dimensions: JPEG has no supported frame header");
}

function uint24le(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

function webpDimensions(bytes: Uint8Array): RasterImageDimensions | null {
  if (
    bytes.length < 30 ||
    String.fromCharCode(...bytes.subarray(0, 4)) !== "RIFF" ||
    String.fromCharCode(...bytes.subarray(8, 12)) !== "WEBP"
  ) return null;
  const chunk = String.fromCharCode(...bytes.subarray(12, 16));
  if (chunk === "VP8X") {
    return {
      width: positiveDimension(uint24le(bytes, 24) + 1, "WebP width"),
      height: positiveDimension(uint24le(bytes, 27) + 1, "WebP height"),
      contentType: "image/webp",
    };
  }
  if (chunk === "VP8 ") {
    if (bytes.length < 30 || bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) {
      throw new Error("image dimensions: malformed lossy WebP frame header");
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return {
      width: positiveDimension(view.getUint16(26, true) & 0x3fff, "WebP width"),
      height: positiveDimension(view.getUint16(28, true) & 0x3fff, "WebP height"),
      contentType: "image/webp",
    };
  }
  if (chunk === "VP8L") {
    if (bytes[20] !== 0x2f) throw new Error("image dimensions: malformed lossless WebP frame header");
    const bits = uint24le(bytes, 21) | (bytes[24] << 24);
    return {
      width: positiveDimension((bits & 0x3fff) + 1, "WebP width"),
      height: positiveDimension(((bits >>> 14) & 0x3fff) + 1, "WebP height"),
      contentType: "image/webp",
    };
  }
  throw new Error(`image dimensions: unsupported WebP chunk ${JSON.stringify(chunk)}`);
}

/** Parse dimensions from the actual encoded bytes; caller-supplied MIME/dimensions are never trusted. */
export function rasterImageDimensions(bytes: Uint8Array): RasterImageDimensions {
  const result = pngDimensions(bytes) ?? jpegDimensions(bytes) ?? webpDimensions(bytes);
  if (!result) throw new Error("image dimensions: unsupported or malformed raster image");
  return result;
}
