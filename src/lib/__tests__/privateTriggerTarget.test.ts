import assert from "node:assert/strict";
import { privateTriggerApiOrigin, privateTriggerRequestOptions } from "../privateTriggerTarget";

for (const value of [undefined, "", "https://api.trigger.dev", "http://example.com", "https://localhost:8030", "http://127.0.0.1.evil:8030", "http://user:password@127.0.0.1:8030", "http://127.0.0.1:8030/path", "http://localhost:8030/?x=1", "http://localhost:8030/#x"]) {
  assert.throws(() => privateTriggerApiOrigin({ TRIGGER_API_URL: value }), /explicit loopback/);
}
for (const value of ["http://127.0.0.1:8030", "http://localhost:8030/", "http://[::1]:8030"]) {
  assert.equal(privateTriggerApiOrigin({ TRIGGER_API_URL: value }), new URL(value).origin);
  assert.deepEqual(privateTriggerRequestOptions({ YOUTUBE_AUTOMATION_PRIVATE: "1", TRIGGER_API_URL: value }), { clientConfig: { baseURL: new URL(value).origin } });
}
for (const value of [undefined, "https://api.trigger.dev"]) {
  assert.equal(privateTriggerRequestOptions({ YOUTUBE_AUTOMATION_PRIVATE: "0", TRIGGER_API_URL: value }), undefined);
  assert.throws(() => privateTriggerRequestOptions({ YOUTUBE_AUTOMATION_PRIVATE: "1", TRIGGER_API_URL: value }), /explicit loopback/);
}
console.log("Private Trigger target requires an explicit uncredentialed loopback origin");
