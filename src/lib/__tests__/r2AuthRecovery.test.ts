import assert from "node:assert/strict";
import { isR2AuthFailure } from "@/lib/storage";

assert.equal(isR2AuthFailure({ $metadata: { httpStatusCode: 401 } }), true);
assert.equal(isR2AuthFailure({ $metadata: { httpStatusCode: 403 } }), true);
assert.equal(isR2AuthFailure({ name: "SignatureDoesNotMatch" }), true);
assert.equal(isR2AuthFailure({ $metadata: { httpStatusCode: 404 }, name: "NoSuchKey" }), false);
assert.equal(isR2AuthFailure({ $metadata: { httpStatusCode: 500 }, name: "InternalError" }), false);

console.log("R2 auth recovery classification contracts passed");
