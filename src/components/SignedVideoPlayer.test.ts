import assert from "node:assert/strict";
import Module, { createRequire } from "node:module";

const loader = Module as unknown as { _load: (...args: unknown[]) => unknown };
const originalLoad = loader._load;
const require = createRequire(import.meta.url);
loader._load = function (...args: unknown[]) {
  if (String(args[0]).endsWith("SignedVideoPlayer.module.css")) return { __esModule: true, default: {} };
  return originalLoad.apply(this, args);
};
try {
  const { signedVideoExpiresAt, sameSignedVideoObject } = require("./SignedVideoPlayer") as typeof import("./SignedVideoPlayer");
  const stamp = "20260909T120000Z";
  const signed = `https://media.example.test/owner/a/final.mp4?X-Amz-Date=${stamp}&X-Amz-Expires=3600&X-Amz-Signature=old`;
  assert.equal(signedVideoExpiresAt(signed), Date.parse("2026-09-09T13:00:00Z"));
  assert.equal(signedVideoExpiresAt(signed.replace("3600", "604800")), Date.parse("2026-09-16T12:00:00Z"));
  for (const url of ["/plain.mp4", "data:video/mp4,test", signed.replace(stamp,"20260230T120000Z"),
    signed.replace(stamp,"20260909T240000Z"), signed.replace("3600","0"), signed.replace("3600","-1"),
    signed.replace("3600","1.5"), signed.replace("3600","604801"), signed.replace("3600","Infinity")]) {
    assert.equal(signedVideoExpiresAt(url),null,`not demonstrable expiry: ${url}`);
  }
  assert.equal(sameSignedVideoObject(signed,signed.replace("old","new")),true);
  assert.equal(sameSignedVideoObject(signed,signed.replace("final.mp4","other.mp4")),false);
  assert.equal(sameSignedVideoObject(signed,signed.replace("media.example.test","other.example.test")),false);
  assert.equal(sameSignedVideoObject(signed,signed.replace("https:","http:")),false);
  assert.equal(sameSignedVideoObject("/final.mp4?old","https://studio.test/final.mp4?new","https://studio.test"),true);
  assert.equal(sameSignedVideoObject("javascript:alert(1)","javascript:alert(1)"),false);
  console.log("SignedVideoPlayer expiry and same-object boundaries passed");
} finally { loader._load = originalLoad; }
