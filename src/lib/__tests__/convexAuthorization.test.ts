import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { importJWK, jwtVerify } from "jose";
import ts from "typescript";
import { api } from "../../../convex/_generated/api";
import { studioAuthorizationForTests } from "../../../convex/studioFunctions";
import {
  createOperatorSessionToken,
  hasValidOperatorSession,
  STUDIO_SESSION_COOKIE,
} from "../operatorSession";
import {
  getStudioConvexPublicJwk,
  getStudioConvexPublicJwks,
  issueStudioConvexToken,
  STUDIO_CONVEX_AUDIENCE,
  STUDIO_CONVEX_ISSUER,
} from "../studioConvexAuth";
import { StudioConvexHttpClient } from "../studioConvexHttpClient";

function identity(role: "owner" | "service", ownerId: string) {
  return {
    subject: role === "owner" ? ownerId : "service:youtube-studio-ai",
    issuer: STUDIO_CONVEX_ISSUER,
    tokenIdentifier: `${STUDIO_CONVEX_ISSUER}|${role}`,
    role,
    owner_id: ownerId,
  };
}

function fakeCtx(options: {
  role?: "owner" | "service";
  identityOwner?: string;
  documentOwner?: string;
}) {
  const owner = options.identityOwner ?? "owner_a";
  return {
    auth: {
      getUserIdentity: async () => identity(options.role ?? "owner", owner),
    },
    db: {
      normalizeId: (_table: string, value: string) => value,
      get: async () => ({ ownerId: options.documentOwner ?? owner }),
      query: () => ({
        withIndex: () => ({
          first: async () => ({ ownerId: options.documentOwner ?? owner }),
          collect: async () => [{ ownerId: options.documentOwner ?? owner }],
        }),
      }),
    },
  };
}

async function expectRejected(work: Promise<unknown>, pattern: RegExp) {
  await assert.rejects(work, pattern);
}

async function filesBelow(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const target = path.join(directory, entry.name);
      return entry.isDirectory() ? filesBelow(target) : [target];
    }),
  );
  return nested.flat();
}

function importedValues(source: string, moduleName: string): string[] {
  const ast = ts.createSourceFile("audit.ts", source, ts.ScriptTarget.Latest, true);
  const names: string[] = [];
  for (const statement of ast.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    if (!ts.isStringLiteral(statement.moduleSpecifier)) continue;
    if (statement.moduleSpecifier.text !== moduleName) continue;
    const clause = statement.importClause;
    if (!clause || clause.isTypeOnly) continue;
    const bindings = clause.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) {
      if (!element.isTypeOnly) names.push(element.propertyName?.text ?? element.name.text);
    }
  }
  return names;
}

async function main() {
  const priorPrivateKey = process.env.STUDIO_CONVEX_JWT_PRIVATE_KEY;
  const priorPreviousJwks = process.env.STUDIO_CONVEX_PREVIOUS_PUBLIC_JWKS;
  const priorSessionSecret = process.env.STUDIO_SESSION_SECRET;
  try {
    delete process.env.STUDIO_CONVEX_JWT_PRIVATE_KEY;
    assert.throws(
      () => getStudioConvexPublicJwk(),
      /STUDIO_CONVEX_JWT_PRIVATE_KEY is required/,
      "missing signing configuration must fail clearly and closed",
    );
    const priorConsoleError = console.error;
    console.error = () => undefined;
    const { GET: getJwks } = await import("../../app/api/auth/convex-jwks/route");
    const unavailableJwks = await getJwks();
    console.error = priorConsoleError;
    assert.equal(unavailableJwks.status, 503);
    assert.deepEqual(await unavailableJwks.json(), {
      error: "Convex JWKS is not configured",
    });

    const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    const activePrivatePem = privateKey
      .export({ type: "pkcs8", format: "pem" })
      .toString();
    process.env.STUDIO_CONVEX_JWT_PRIVATE_KEY = activePrivatePem;

    const jwk = getStudioConvexPublicJwk();
    assert.equal(jwk.kty, "EC");
    assert.equal(jwk.crv, "P-256");
    assert.equal(jwk.d, undefined, "JWKS must never expose private key material");
    const readyJwks = await getJwks();
    assert.equal(readyJwks.status, 200);
    const readyJwksBody = (await readyJwks.json()) as { keys: Array<{ d?: unknown }> };
    assert.equal(readyJwksBody.keys.length, 1);
    assert.equal(readyJwksBody.keys[0]?.d, undefined);
    process.env.STUDIO_CONVEX_PREVIOUS_PUBLIC_JWKS = JSON.stringify([jwk]);
    assert.equal(
      getStudioConvexPublicJwks().length,
      1,
      "the active key must be deduplicated from the overlap keyring",
    );
    const { privateKey: rotatedPrivateKey } = generateKeyPairSync("ec", {
      namedCurve: "P-256",
    });
    process.env.STUDIO_CONVEX_JWT_PRIVATE_KEY = rotatedPrivateKey
      .export({ type: "pkcs8", format: "pem" })
      .toString();
    const overlapKeys = getStudioConvexPublicJwks();
    assert.equal(overlapKeys.length, 2);
    assert.notEqual(overlapKeys[0]?.kid, overlapKeys[1]?.kid);
    process.env.STUDIO_CONVEX_JWT_PRIVATE_KEY = activePrivatePem;
    process.env.STUDIO_CONVEX_PREVIOUS_PUBLIC_JWKS = JSON.stringify([{ ...jwk, d: "leak" }]);
    assert.throws(
      () => getStudioConvexPublicJwks(),
      /must never include private key material/,
    );
    delete process.env.STUDIO_CONVEX_PREVIOUS_PUBLIC_JWKS;

    const ownerToken = issueStudioConvexToken({ role: "owner", ownerId: "owner_a" });
    const verificationKey = await importJWK(jwk, "ES256");
    const verifiedOwner = await jwtVerify(ownerToken.token, verificationKey, {
      algorithms: ["ES256"],
      issuer: STUDIO_CONVEX_ISSUER,
      audience: STUDIO_CONVEX_AUDIENCE,
    });
    assert.equal(verifiedOwner.payload.sub, "owner_a");
    assert.equal(verifiedOwner.payload.owner_id, "owner_a");
    assert.equal(verifiedOwner.payload.role, "owner");

    await studioAuthorizationForTests.authorizeStudioCall(
      fakeCtx({}) as never,
      { ownerId: "owner_a" },
    );
    await expectRejected(
      studioAuthorizationForTests.authorizeStudioCall(
        fakeCtx({}) as never,
        { ownerId: "owner_b" },
      ),
      /owner access denied/,
    );
    await expectRejected(
      studioAuthorizationForTests.authorizeStudioCall(
        fakeCtx({ documentOwner: "owner_b" }) as never,
        { ownerId: "owner_a", channelId: "channel_b" },
      ),
      /resource access denied/,
    );
    await expectRejected(
      studioAuthorizationForTests.authorizeStudioCall(
        fakeCtx({ documentOwner: "owner_b" }) as never,
        { groupId: "shared-group" },
      ),
      /group access denied/,
    );
    await studioAuthorizationForTests.authorizeStudioCall(
      fakeCtx({ role: "service" }) as never,
      { secret: "redacted-service-operation" },
    );
    await expectRejected(
      studioAuthorizationForTests.authorizeStudioCall(fakeCtx({}) as never, {
        secret: "cannot-turn-an-owner-session-into-a-fleet-scan",
      }),
      /not owner scoped/,
    );

    const convexFiles = (await filesBelow(path.resolve("convex"))).filter(
      (file) => file.endsWith(".ts") && !file.includes("/_generated/"),
    );
    for (const file of convexFiles) {
      if (file.endsWith("/studioFunctions.ts")) continue;
      const source = await readFile(file, "utf8");
      const rawBuilders = importedValues(source, "./_generated/server").filter(
        (name) => name === "query" || name === "mutation",
      );
      assert.deepEqual(
        rawBuilders,
        [],
        `${path.relative(process.cwd(), file)} bypasses the authenticated Convex builders`,
      );
    }

    const serverFiles = [
      ...(await filesBelow(path.resolve("src"))),
      ...(await filesBelow(path.resolve("scripts"))),
    ].filter((file) => file.endsWith(".ts") || file.endsWith(".tsx"));
    for (const file of serverFiles) {
      if (file.endsWith("/studioConvexHttpClient.ts")) continue;
      const source = await readFile(file, "utf8");
      const rawClients = importedValues(source, "convex/browser").filter(
        (name) => name === "ConvexHttpClient",
      );
      assert.deepEqual(
        rawClients,
        [],
        `${path.relative(process.cwd(), file)} constructs an unauthenticated server Convex client`,
      );
    }

    let authorizationHeader: string | null = null;
    const client = new StudioConvexHttpClient("https://example.convex.cloud", {
      fetch: async (_input, init) => {
        authorizationHeader = new Headers(init?.headers).get("Authorization");
        return new Response(JSON.stringify({ status: "success", value: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    });
    await client.query(api.channels.listChannels, { ownerId: "owner_daniel" });
    assert.match(authorizationHeader ?? "", /^Bearer /);
    const serviceJwt = (authorizationHeader ?? "").replace(/^Bearer /, "");
    const verifiedService = await jwtVerify(serviceJwt, verificationKey, {
      algorithms: ["ES256"],
      issuer: STUDIO_CONVEX_ISSUER,
      audience: STUDIO_CONVEX_AUDIENCE,
    });
    assert.equal(verifiedService.payload.role, "service");
    assert.equal(verifiedService.payload.owner_id, "owner_daniel");

    process.env.STUDIO_SESSION_SECRET = Buffer.alloc(32, 7).toString("base64");
    assert.equal(await hasValidOperatorSession(undefined), false);
    assert.equal(await hasValidOperatorSession("forged.session.token"), false);
    const session = await createOperatorSessionToken();
    assert.equal(await hasValidOperatorSession(session), true);
    const { GET: getConvexToken } = await import("../../app/api/auth/convex-token/route");
    const noSessionResponse = await getConvexToken(
      new Request("https://youtube-studio-ai.vercel.app/api/auth/convex-token"),
    );
    assert.equal(noSessionResponse.status, 401);
    const crossOriginResponse = await getConvexToken(
      new Request("https://youtube-studio-ai.vercel.app/api/auth/convex-token", {
        headers: {
          Cookie: `${STUDIO_SESSION_COOKIE}=${session}`,
          Origin: "https://attacker.invalid",
          "Sec-Fetch-Site": "cross-site",
        },
      }),
    );
    assert.equal(crossOriginResponse.status, 403);
    const tokenResponse = await getConvexToken(
      new Request("https://youtube-studio-ai.vercel.app/api/auth/convex-token", {
        headers: { Cookie: `${STUDIO_SESSION_COOKIE}=${session}` },
      }),
    );
    assert.equal(tokenResponse.status, 200);
    const tokenBody = (await tokenResponse.json()) as { token?: unknown };
    assert.equal(typeof tokenBody.token, "string");

    console.log("CONVEX AUTHORIZATION PASS: owner spoofing denied");
    console.log("CONVEX AUTHORIZATION PASS: server client sends verified service JWT");
    console.log("CONVEX AUTHORIZATION PASS: app session gate rejects missing/forged sessions");
    console.log("CONVEX AUTHORIZATION PASS: missing key and JWKS readiness fail closed");
  } finally {
    if (priorPrivateKey === undefined) delete process.env.STUDIO_CONVEX_JWT_PRIVATE_KEY;
    else process.env.STUDIO_CONVEX_JWT_PRIVATE_KEY = priorPrivateKey;
    if (priorPreviousJwks === undefined) delete process.env.STUDIO_CONVEX_PREVIOUS_PUBLIC_JWKS;
    else process.env.STUDIO_CONVEX_PREVIOUS_PUBLIC_JWKS = priorPreviousJwks;
    if (priorSessionSecret === undefined) delete process.env.STUDIO_SESSION_SECRET;
    else process.env.STUDIO_SESSION_SECRET = priorSessionSecret;
  }
}

void main();
