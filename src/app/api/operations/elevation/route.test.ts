import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { DELETE, GET } from "./route";

process.env.STUDIO_SESSION_SECRET = Buffer.alloc(32, 17).toString("base64url");
process.env.STUDIO_OWNER_ID = "owner-test";

const endpoint = "https://studio.test/api/operations/elevation";

function mutationRequest(
  options: { origin?: string } = {},
) {
  return new NextRequest(endpoint, {
    method: "DELETE",
    headers: {
      Origin: options.origin ?? "https://studio.test",
      "Sec-Fetch-Site": "same-origin",
    },
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

  const crossOriginLock = await DELETE(mutationRequest({
    origin: "https://attacker.invalid",
  }));
  assert.equal(crossOriginLock.status, 403);
  assert.equal(crossOriginLock.headers.get("set-cookie"), null);

  const locked = await DELETE(mutationRequest());
  assert.equal(locked.status, 200);
  assert.match(locked.headers.get("set-cookie") ?? "", /Max-Age=0/i);

  console.log("Operations elevation boundary tests passed");
}

void main();
