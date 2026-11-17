import assert from "node:assert/strict";
import { allowedStudioMutationOrigin } from "../operatorSession";

const env = { YOUTUBE_STUDIO_WORKSHOP_PRIVATE: "1", YTS_LOCAL_WEB_ORIGIN: "http://127.0.0.1:39362" };
const req = (origin: string | null, host = "127.0.0.1:39362") => new Request("http://localhost:39362/api/settings", {
  method: "POST", headers: { host, ...(origin ? { origin } : {}) },
});
assert.equal(allowedStudioMutationOrigin(req("http://127.0.0.1:39362"), env), true);
assert.equal(allowedStudioMutationOrigin(req("http://localhost:39362"), {}), true);
assert.equal(allowedStudioMutationOrigin(req("http://localhost:39362"), env), false);
assert.equal(allowedStudioMutationOrigin(req("http://127.0.0.1:39362"), {}), false);
assert.equal(allowedStudioMutationOrigin(req("http://evil.example"), env), false);
assert.equal(allowedStudioMutationOrigin(req(null), env), false);
assert.equal(allowedStudioMutationOrigin(req("http://127.0.0.1:39362", "evil.example"), env), false);
assert.equal(allowedStudioMutationOrigin(req("http://evil.example", "evil.example"), { ...env, YTS_LOCAL_WEB_ORIGIN: "http://evil.example" }), false);
console.log("private loopback origin accepted and cross-origin requests rejected");
