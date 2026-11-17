import assert from "node:assert/strict";
import { scryptSync } from "node:crypto";
import { NextRequest } from "next/server";
import { POST } from "./route";
import { GET as convexToken } from "../convex-token/route";
import { proxy } from "@/proxy";

async function main() {
  process.env.YOUTUBE_AUTOMATION_PRIVATE = "1";
  process.env.STUDIO_SESSION_SECRET = "42".repeat(32);
  process.env.STUDIO_OWNER_ID = "local-auth-fixture";
  const password = "a private fixture password";
  const salt = Buffer.alloc(16, 7);
  process.env.YOUTUBE_AUTOMATION_PASSWORD_SCRYPT = `scrypt$${salt.toString("hex")}$${scryptSync(password, salt, 32).toString("hex")}`;
  const base = "http://127.0.0.1:39360";
  const form = (value: string, origin = base) => {
    const body = new URLSearchParams({ password: value }).toString();
    return new Request(`${base}/api/auth/local-login`, { method: "POST", headers: {
      origin, host: "127.0.0.1:39360", "content-type": "application/x-www-form-urlencoded", "content-length": String(Buffer.byteLength(body)),
    }, body });
  };
  const anonymous = await proxy(new NextRequest(`${base}/channels`));
  assert.equal(anonymous.status, 307);
  assert.equal(new URL(anonymous.headers.get("location")!).pathname, "/operator-login");
  assert.equal((await proxy(new NextRequest(`${base}/api/channel-settings`))).status, 401);
  assert.equal((await convexToken(new Request(`${base}/api/auth/convex-token`))).status, 401);
  assert.equal((await POST(form(password, "http://foreign.invalid"))).status, 403);
  const verifier = process.env.YOUTUBE_AUTOMATION_PASSWORD_SCRYPT;
  delete process.env.YOUTUBE_AUTOMATION_PASSWORD_SCRYPT;
  assert.equal((await POST(form(password))).status, 503);
  process.env.YOUTUBE_AUTOMATION_PASSWORD_SCRYPT = verifier;
  const wrong = await POST(form("incorrect"));
  assert.equal(new URL(wrong.headers.get("location")!).pathname, "/operator-login");
  assert.equal(wrong.headers.get("set-cookie"), null);
  const success = await POST(form(password));
  assert.equal(new URL(success.headers.get("location")!).pathname, "/channels");
  const cookie = success.headers.get("set-cookie")!.split(";")[0]!;
  assert.match(cookie, /^studio_session=/);
  const allowed = await proxy(new NextRequest(`${base}/channels`, { headers: { cookie } }));
  assert.equal(allowed.headers.get("x-middleware-next"), "1");
  const forwardedBody = new URLSearchParams({ password }).toString();
  const forwarded = await POST(new Request("http://internal.invalid/api/auth/local-login", { method: "POST", headers: {
    origin: "https://automation.example.test", host: "automation.example.test", "x-forwarded-proto": "https",
    "content-type": "application/x-www-form-urlencoded", "content-length": String(Buffer.byteLength(forwardedBody)),
  }, body: forwardedBody }));
  assert.equal(forwarded.headers.get("location"), "https://automation.example.test/channels");
  assert.match(forwarded.headers.get("set-cookie")!, /; Secure/i);
  for (let attempt = 0; attempt < 5; attempt++) await POST(form("wrong"));
  assert.equal((await POST(form(password))).status, 429);
  delete process.env.YOUTUBE_AUTOMATION_PRIVATE;
  assert.equal((await proxy(new NextRequest(`${base}/channels`))).headers.get("x-middleware-next"), "1");
  assert.equal((await POST(form(password))).status, 404);
  console.log("local owner login, private route and token gates, and throttling: passed");
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
