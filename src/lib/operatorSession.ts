import { timingSafeEqual } from "node:crypto";
import { jwtVerify, SignJWT } from "jose";
import { requireSecretKey } from "@/lib/secretEnvelope";

export const STUDIO_SESSION_COOKIE = "studio_session";
const SESSION_ISSUER = "youtube-studio-ai";
const SESSION_AUDIENCE = "youtube-studio-operator";
const SESSION_TTL_SECONDS = 8 * 60 * 60;

export interface StudioActor {
  ownerId: string;
  role: "owner";
  authKind: "session" | "service";
}

export class StudioAuthError extends Error {
  constructor(
    message: string,
    readonly status: 401 | 403 | 503 = 401,
  ) {
    super(message);
    this.name = "StudioAuthError";
  }
}

function ownerId(): string {
  return process.env.STUDIO_OWNER_ID ?? "owner_daniel";
}

function safeEqualText(actual: string, expected: string): boolean {
  const a = Buffer.from(actual, "utf8");
  const b = Buffer.from(expected, "utf8");
  return a.byteLength === b.byteLength && timingSafeEqual(a, b);
}

export async function createOperatorSessionToken(): Promise<string> {
  return new SignJWT({ role: "owner" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(ownerId())
    .setIssuer(SESSION_ISSUER)
    .setAudience(SESSION_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(requireSecretKey("STUDIO_SESSION_SECRET"));
}

export async function verifyOperatorSessionToken(
  token: string,
): Promise<StudioActor | null> {
  try {
    const { payload } = await jwtVerify(
      token,
      requireSecretKey("STUDIO_SESSION_SECRET"),
      {
        algorithms: ["HS256"],
        issuer: SESSION_ISSUER,
        audience: SESSION_AUDIENCE,
      },
    );
    if (payload.role !== "owner" || payload.sub !== ownerId()) return null;
    return { ownerId: payload.sub, role: "owner", authKind: "session" };
  } catch {
    return null;
  }
}

export async function hasValidOperatorSession(token?: string): Promise<boolean> {
  if (!token) return false;
  const actor = await verifyOperatorSessionToken(token);
  return actor?.authKind === "session" && actor.role === "owner";
}

function readCookie(request: Request, name: string): string | undefined {
  const header = request.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const [rawName, ...rawValue] = part.trim().split("=");
    if (rawName !== name) continue;
    try {
      return decodeURIComponent(rawValue.join("="));
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function serviceActor(request: Request): StudioActor | null {
  const expected = process.env.STUDIO_INTERNAL_API_TOKEN;
  if (!expected) return null;
  const authorization = request.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) return null;
  const actual = authorization.slice("Bearer ".length);
  return safeEqualText(actual, expected)
    ? { ownerId: ownerId(), role: "owner", authKind: "service" }
    : null;
}

export async function getStudioActor(
  request: Request,
): Promise<StudioActor | null> {
  const service = serviceActor(request);
  if (service) return service;
  const session = readCookie(request, STUDIO_SESSION_COOKIE);
  return session ? verifyOperatorSessionToken(session) : null;
}

export async function requireStudioActor(
  request: Request,
): Promise<StudioActor> {
  const actor = await getStudioActor(request);
  if (!actor) throw new StudioAuthError("authentication required");

  if (
    actor.authKind === "session" &&
    !["GET", "HEAD", "OPTIONS"].includes(request.method.toUpperCase())
  ) {
    const origin = request.headers.get("origin");
    if (!origin || origin !== new URL(request.url).origin) {
      throw new StudioAuthError("cross-origin state change refused", 403);
    }
  }
  return actor;
}

/** Route-level guard for endpoints that do not otherwise need the actor. */
export async function authorizeStudioRoute(request: Request): Promise<Response | null> {
  try {
    await requireStudioActor(request);
    return null;
  } catch (error) {
    if (error instanceof StudioAuthError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    return Response.json({ error: "authentication unavailable" }, { status: 500 });
  }
}

export function sessionCookieOptions(requestUrl: string) {
  return {
    httpOnly: true,
    secure: new URL(requestUrl).protocol === "https:",
    sameSite: "lax" as const,
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
    priority: "high" as const,
  };
}
