import assert from "node:assert/strict";
import { assertLocalPublicationAllowed } from "../localPublicationPolicy";
import { uploadPrivateDraft } from "../youtube";
import { crosspost } from "../ayrshare";

const privateMode = { YOUTUBE_AUTOMATION_PRIVATE: "1" };
assert.doesNotThrow(() => assertLocalPublicationAllowed({}, privateMode));
assert.doesNotThrow(() => assertLocalPublicationAllowed({ privacyStatus: "private" }, privateMode));
for (const upload of [
  { privacyStatus: "public" },
  { privacyStatus: "unlisted" },
  { privacyStatus: "private", publishAt: "2030-01-01T00:00:00Z" },
]) assert.throws(() => assertLocalPublicationAllowed(upload, privateMode), /disabled/);
assert.doesNotThrow(() => assertLocalPublicationAllowed({ privacyStatus: "public" }, {}));
assert.doesNotThrow(() => assertLocalPublicationAllowed({ privacyStatus: "public" }, {
  ...privateMode, YOUTUBE_AUTOMATION_PUBLICATION_ENABLED: "1",
}));

async function main() {
  process.env.YOUTUBE_AUTOMATION_PRIVATE = "1";
  delete process.env.YOUTUBE_AUTOMATION_PUBLICATION_ENABLED;
  let networkCalls = 0;
  await assert.rejects(uploadPrivateDraft({
    filePath: "/missing/should-not-be-opened", title: "test", description: "", tags: [],
    refreshToken: "fixture", privacyStatus: "public",
    fetchImpl: async () => { networkCalls++; throw new Error("unexpected request"); },
  }), /uploads are disabled/);
  assert.equal(networkCalls, 0);
  process.env.AYRSHARE_API_KEY = "fixture";
  await assert.rejects(crosspost({ mediaUrl: "https://example.invalid/video", caption: "", platforms: ["instagram"] }), /cross-posting is disabled/);
  console.log("local publication gate: private allowed; external upload rejected before I/O");
}
void main();
