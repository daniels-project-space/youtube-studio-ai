import assert from "node:assert/strict";
import { whiteboardArtFileExtension } from "@/lib/whiteboardSync";

assert.equal(whiteboardArtFileExtension("image/png"), "png");
assert.equal(whiteboardArtFileExtension("image/jpeg"), "jpg");
assert.equal(whiteboardArtFileExtension("image/webp"), "webp");
assert.throws(
  () => whiteboardArtFileExtension("image/gif"),
  /unsupported Nano Banana Pro art content type image\/gif/,
);

console.log("whiteboard art file contract: PASS");
