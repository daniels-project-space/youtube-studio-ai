# Convex authentication rollout

The studio now has one enforceable authorization boundary:

- browser requests receive a five-minute ES256 token only after the existing
  HttpOnly operator session is verified;
- Trigger, Next route handlers, and TypeScript maintenance tools use a scoped
  service JWT (maximum lifetime four hours);
- every public Convex query and mutation passes through `convex/studioFunctions.ts`,
  which checks both the authenticated owner claim and every referenced document;
- the primary route group redirects to `/operator-login` before mounting the
  Convex client or Jarvis widget.

## Required configuration

Generate one P-256 PKCS#8 key. Store the private PEM only as
`STUDIO_CONVEX_JWT_PRIVATE_KEY` in:

1. the controlled deployment/maintenance environment;
2. the Vercel project (Production and the intended Preview environments);
3. the Trigger project used by production workers.

Keep `STUDIO_OWNER_ID` identical in Vercel, Trigger, and maintenance shells.
`trigger.config.ts` forwards both values when a Trigger build is deployed. Convex
does not receive the private key: it verifies tokens from the public JWKS endpoint.

Never commit the PEM, print it in logs, or put it in Convex environment variables.

## First rollout (controlled maintenance window)

1. Pause new generation dispatch and confirm no Trigger pipeline is active. The
   current unauthenticated worker build cannot continue after the Convex boundary
   is enabled.
2. Configure Vercel's private key and deploy the app first. Verify:
   - `/api/auth/convex-jwks` returns `200`, one `EC` / `P-256` key, and no `d` field;
   - `/api/auth/convex-token` returns `401` without an operator cookie;
   - an unauthenticated primary page redirects to `/operator-login`.
3. Configure the same private key in Trigger and the deployment shell.
4. Deploy Convex (`auth.config.ts` plus the authenticated builders), then deploy
   the Trigger build immediately. Keep dispatch paused during this short cutover.
5. Run `npm run typecheck`,
   `npx tsx src/lib/__tests__/convexAuthorization.test.ts`, and one read-only live
   query through `StudioConvexHttpClient`. Then rerun the voice-readiness migration
   in read-only mode before any `--apply` use.
6. Resume dispatch only after a browser query and a Trigger read both succeed with
   the expected owner.

The deployment must fail rather than remove the auth wrapper if any key or JWKS
check is unhealthy.

## Rotation without worker interruption

1. Read the old public JWK from the production JWKS endpoint (public material only).
2. Generate a new P-256 private key. Set it as the active Vercel private key and put
   the old public JWK in `STUDIO_CONVEX_PREVIOUS_PUBLIC_JWKS` as a JSON array.
3. Deploy Vercel and verify the JWKS exposes both public `kid` values and no private
   `d` field.
4. Replace the Trigger/deployment-shell private key with the new key and deploy
   Trigger. Old in-flight service tokens remain valid through the overlap key.
5. After four hours (the maximum service-token lifetime), remove
   `STUDIO_CONVEX_PREVIOUS_PUBLIC_JWKS` and redeploy Vercel.

## Legacy script boundary

Eleven old `.mjs` experiments still construct raw Convex clients and are not part
of package scripts, Next, Trigger, or production deployment inputs. They are
intentionally denied by Convex after rollout: `test-architect`, `run-script-lab`,
`four-channels`, `test-forge`, `gen-3-thumbs`, `recraft-pipeline`,
`run-thumbnail-lab`, `thumbs-from-archive`, `anchor-lofi-refs`,
`anchor-invest-refs`, and `refine-thumb-winner`. Convert a needed script to
TypeScript and `StudioConvexHttpClient` before running it; never restore anonymous
Convex access for compatibility.
