import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { DELETE, GET, POST } from "./route";
import { STUDIO_SESSION_COOKIE } from "@/lib/operatorSession";

process.env.STUDIO_SESSION_SECRET = Buffer.alloc(32, 17).toString("base64url");
process.env.STUDIO_OPERATOR_TOKEN = "test-operations-key-with-high-entropy";
process.env.STUDIO_OWNER_ID = "owner-test";

const endpoint = "https://studio.test/api/operations/elevation";

function mutationRequest(
  method: "POST" | "DELETE",
  options: { origin?: string; secret?: string } = {},
) {
  return new NextRequest(endpoint, {
    method,
    headers: {
      Origin: options.origin ?? "https://studio.test",
      "Sec-Fetch-Site": "same-origin",
      ...(method === "POST" ? { "Content-Type": "application/json" } : {}),
    },
    body: method === "POST" ? JSON.stringify({ secret: options.secret ?? "" }) : undefined,
  });
}

async function main() {
  const viewer = await GET(new NextRequest(endpoint));
  assert.equal(viewer.status, 200);
  assert.deepEqual(await viewer.json(), {
    ok: true,
    elevated: false,
    role: "viewer",
  });

  const crossOrigin = await POST(mutationRequest("POST", {
    origin: "https://attacker.invalid",
    secret: process.env.STUDIO_OPERATOR_TOKEN,
  }));
  assert.equal(crossOrigin.status, 403);
  assert.equal(crossOrigin.headers.get("set-cookie"), null);

  const missingOrigin = await POST(new NextRequest(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ secret: process.env.STUDIO_OPERATOR_TOKEN }),
  }));
  assert.equal(missingOrigin.status, 403);
  assert.equal(missingOrigin.headers.get("set-cookie"), null);

  const rejected = await POST(mutationRequest("POST", { secret: "wrong-key" }));
  assert.equal(rejected.status, 401);
  assert.equal(rejected.headers.get("set-cookie"), null);

  const elevated = await POST(mutationRequest("POST", {
    secret: process.env.STUDIO_OPERATOR_TOKEN,
  }));
  assert.equal(elevated.status, 200);
  assert.deepEqual(await elevated.json(), {
    ok: true,
    elevated: true,
    role: "owner",
  });
  const setCookie = elevated.headers.get("set-cookie") ?? "";
  assert.match(setCookie, new RegExp(`^${STUDIO_SESSION_COOKIE}=`));
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /SameSite=Lax/i);
  assert.match(setCookie, /Path=\//i);

  const cookie = setCookie.split(";")[0];
  const owner = await GET(new NextRequest(endpoint, {
    headers: { Cookie: cookie },
  }));
  assert.deepEqual(await owner.json(), {
    ok: true,
    elevated: true,
    role: "owner",
  });

  const crossOriginLock = await DELETE(mutationRequest("DELETE", {
    origin: "https://attacker.invalid",
  }));
  assert.equal(crossOriginLock.status, 403);

  const locked = await DELETE(mutationRequest("DELETE"));
  assert.equal(locked.status, 200);
  assert.match(locked.headers.get("set-cookie") ?? "", /Max-Age=0/i);

  console.log("Operations elevation boundary tests passed");
}

void main();
