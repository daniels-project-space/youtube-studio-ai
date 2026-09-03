/**
 * The studio's owner session is minted by exactly one thing: completing the
 * YouTube OAuth callback. With an 8-hour lifetime that meant a Google consent
 * round trip before most days' first change. The session is now long-lived AND
 * renewed while in use, so an owner who keeps using the studio is never signed
 * out — but only a session that is genuinely valid may be extended, or the
 * renewal becomes a way to resurrect a dead one.
 */
process.env.STUDIO_SESSION_SECRET = Buffer.alloc(32, 11).toString("base64url");
process.env.STUDIO_OWNER_ID = "owner-test";

import assert from "node:assert/strict";
import { SignJWT } from "jose";

import { requireSecretKey } from "@/lib/secretEnvelope";
import {
  createOperatorSessionToken,
  renewedOperatorSessionToken,
  sessionCookieOptions,
  verifyOperatorSessionToken,
} from "@/lib/operatorSession";

const DAY = 24 * 60 * 60;

async function tokenExpiringIn(seconds: number, overrides: { sub?: string; role?: string } = {}) {
  return new SignJWT({ role: overrides.role ?? "owner" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(overrides.sub ?? "owner-test")
    .setIssuer("youtube-studio-ai")
    .setAudience("youtube-studio-operator")
    .setIssuedAt()
    .setExpirationTime(`${seconds}s`)
    .sign(requireSecretKey("STUDIO_SESSION_SECRET"));
}

async function main(): Promise<void> {
  // A month of headroom, renewed on use, is what removes the daily login.
  const cookie = sessionCookieOptions("https://studio.example.com/x");
  assert.equal(cookie.maxAge, 30 * DAY, "session cookie should last 30 days");
  assert.equal(cookie.httpOnly, true, "session cookie must stay httpOnly");
  assert.equal(cookie.secure, true, "session cookie must stay secure over https");

  // Fresh session: nothing to do. Re-signing on every poll would emit a
  // Set-Cookie on every request for no benefit.
  const fresh = await createOperatorSessionToken();
  assert.equal(await renewedOperatorSessionToken(fresh), null, "fresh session should not renew");

  // Past halfway — including every session issued under the old 8-hour rule,
  // which is why nobody has to sign in again for this change to take effect.
  const legacy = await tokenExpiringIn(8 * 60 * 60);
  const renewed = await renewedOperatorSessionToken(legacy);
  assert.ok(renewed, "a session past halfway should renew");
  assert.notEqual(renewed, legacy, "renewal should issue a new token");
  const actor = await verifyOperatorSessionToken(renewed!);
  assert.deepEqual(actor, { ownerId: "owner-test", role: "owner", authKind: "session" });

  // Renewal must never resurrect something that is not a live owner session.
  assert.equal(await renewedOperatorSessionToken(await tokenExpiringIn(-60)), null,
    "an expired session must not renew");
  assert.equal(await renewedOperatorSessionToken(await tokenExpiringIn(60, { role: "viewer" })), null,
    "a viewer token must not renew into an owner session");
  assert.equal(await renewedOperatorSessionToken(await tokenExpiringIn(60, { sub: "someone-else" })), null,
    "another subject must not renew");
  assert.equal(await renewedOperatorSessionToken("not-a-jwt"), null, "garbage must not renew");
  assert.equal(await renewedOperatorSessionToken(undefined), null, "absent cookie must not renew");

  console.log("OPERATOR SESSION RENEWAL PASS");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
