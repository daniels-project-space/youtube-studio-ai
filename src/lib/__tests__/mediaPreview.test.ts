import assert from "node:assert/strict";
import { selectMediaPreview } from "../mediaPreview";

const r2Key = "channels/demo/thumb.png";
const youtube = "https://i.ytimg.com/vi/demo/hqdefault.jpg";

// Do not reveal a public thumbnail while its retained R2 counterpart is still
// resolving. Otherwise a transient signing delay looks like the final source.
assert.deepEqual(
  selectMediaPreview({
    assetKey: r2Key,
    signedState: "loading",
    signedUrl: null,
    r2ImageFailed: false,
    fallbackSrc: youtube,
    fallbackSource: "youtube",
    fallbackImageFailed: false,
  }),
  { source: "r2", src: null, state: "loading" },
);

assert.deepEqual(
  selectMediaPreview({
    assetKey: r2Key,
    signedState: "ready",
    signedUrl: "https://signed.example/thumb.png",
    r2ImageFailed: false,
    fallbackSrc: youtube,
    fallbackSource: "youtube",
    fallbackImageFailed: false,
  }),
  { source: "r2", src: "https://signed.example/thumb.png", state: "loading" },
);

// The fallback becomes eligible only after signing or image loading failed.
for (const r2Failure of [
  { signedState: "error" as const, r2ImageFailed: false },
  { signedState: "ready" as const, r2ImageFailed: true },
]) {
  assert.deepEqual(
    selectMediaPreview({
      assetKey: r2Key,
      signedUrl: r2Failure.signedState === "ready" ? "https://signed.example/thumb.png" : null,
      fallbackSrc: youtube,
      fallbackSource: "youtube",
      fallbackImageFailed: false,
      ...r2Failure,
    }),
    { source: "youtube", src: youtube, state: "loading" },
  );
}

assert.deepEqual(
  selectMediaPreview({
    assetKey: r2Key,
    signedState: "error",
    signedUrl: null,
    r2ImageFailed: false,
    fallbackSrc: youtube,
    fallbackSource: "youtube",
    fallbackImageFailed: true,
  }),
  { source: "unavailable", src: null, state: "unavailable" },
);

assert.deepEqual(
  selectMediaPreview({
    assetKey: null,
    signedState: "idle",
    signedUrl: null,
    r2ImageFailed: false,
    fallbackSrc: youtube,
    fallbackSource: "youtube",
    fallbackImageFailed: false,
  }),
  { source: "youtube", src: youtube, state: "loading" },
);

console.log("mediaPreview selection contract passed");
