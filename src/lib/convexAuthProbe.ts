export const CONVEX_AUTH_PROBE_CONTRACT = "studio-auth-boundary-v2" as const;
export const STUDIO_SERVICE_SUBJECT = "service:youtube-studio-ai" as const;

export interface ConvexAuthProbeIdentity {
  role?: unknown;
  owner_id?: unknown;
  subject?: unknown;
}

export interface ConvexAuthProbeRequest {
  expectedOwnerId: string;
  challenge: string;
}

export interface ConvexAuthBoundaryResult {
  contract: typeof CONVEX_AUTH_PROBE_CONTRACT;
  challenge: string;
  access: "granted" | "denied";
  reason: "service_identity_verified" | "authentication_required" | "identity_scope_mismatch";
  identity: {
    role: "service" | "owner" | "invalid";
    ownerMatchesExpected: boolean;
    subjectMatchesService: boolean;
  } | null;
}

export interface ConvexAuthProbeEvidence {
  ok: true;
  contract: typeof CONVEX_AUTH_PROBE_CONTRACT;
  query: "runs:verifyAuthBoundary";
  authenticatedAccess: "granted";
  unauthenticatedAccess: "denied";
  serverObservedIdentity: {
    role: "service";
    ownerMatchesConfigured: true;
    subjectMatchesService: true;
  };
  freshChallengeResponses: true;
  checkedAt: number;
}

function safeTimestamp(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.trunc(value)
    : 0;
}

function assertChallenge(challenge: string): void {
  if (challenge.length < 16 || challenge.length > 128) {
    throw new Error("convex-auth-probe: invalid challenge length");
  }
}

/**
 * Evaluate the identity inside Convex and return only redacted comparison
 * evidence. No owner id, subject, token, data row, or deployment URL leaves the
 * server. The explicit denied result lets rollout verify the same endpoint with
 * a client that has no Authorization header.
 */
export function evaluateConvexAuthProbeIdentity(
  identity: ConvexAuthProbeIdentity | null,
  request: ConvexAuthProbeRequest,
): ConvexAuthBoundaryResult {
  assertChallenge(request.challenge);

  if (!identity) {
    return {
      contract: CONVEX_AUTH_PROBE_CONTRACT,
      challenge: request.challenge,
      access: "denied",
      reason: "authentication_required",
      identity: null,
    };
  }

  const role =
    identity.role === "service"
      ? "service"
      : identity.role === "owner"
        ? "owner"
        : "invalid";
  const ownerMatchesExpected = identity.owner_id === request.expectedOwnerId;
  const subjectMatchesService = identity.subject === STUDIO_SERVICE_SUBJECT;
  const verified =
    role === "service" && ownerMatchesExpected && subjectMatchesService;

  return {
    contract: CONVEX_AUTH_PROBE_CONTRACT,
    challenge: request.challenge,
    access: verified ? "granted" : "denied",
    reason: verified ? "service_identity_verified" : "identity_scope_mismatch",
    identity: {
      role,
      ownerMatchesExpected,
      subjectMatchesService,
    },
  };
}

/**
 * Fail closed unless both independently transported calls prove the complete
 * boundary: signed service access and unsigned denial. Returned evidence is
 * intentionally bounded and contains no raw identity or challenge values.
 */
export function buildConvexAuthProbeEvidence(input: {
  authenticated: ConvexAuthBoundaryResult;
  unauthenticated: ConvexAuthBoundaryResult;
  authenticatedChallenge: string;
  unauthenticatedChallenge: string;
  checkedAt?: number;
}): ConvexAuthProbeEvidence {
  const {
    authenticated,
    unauthenticated,
    authenticatedChallenge,
    unauthenticatedChallenge,
  } = input;
  assertChallenge(authenticatedChallenge);
  assertChallenge(unauthenticatedChallenge);
  if (authenticatedChallenge === unauthenticatedChallenge) {
    throw new Error("convex-auth-probe: challenges must be distinct");
  }
  if (
    authenticated.contract !== CONVEX_AUTH_PROBE_CONTRACT ||
    unauthenticated.contract !== CONVEX_AUTH_PROBE_CONTRACT
  ) {
    throw new Error("convex-auth-probe: server contract mismatch");
  }
  if (
    authenticated.challenge !== authenticatedChallenge ||
    unauthenticated.challenge !== unauthenticatedChallenge
  ) {
    throw new Error("convex-auth-probe: stale or mismatched challenge response");
  }
  if (
    authenticated.access !== "granted" ||
    authenticated.reason !== "service_identity_verified" ||
    authenticated.identity?.role !== "service" ||
    authenticated.identity.ownerMatchesExpected !== true ||
    authenticated.identity.subjectMatchesService !== true
  ) {
    throw new Error("convex-auth-probe: authenticated service identity was not verified");
  }
  if (
    unauthenticated.access !== "denied" ||
    unauthenticated.reason !== "authentication_required" ||
    unauthenticated.identity !== null
  ) {
    throw new Error("convex-auth-probe: unauthenticated access was not denied");
  }

  return {
    ok: true,
    contract: CONVEX_AUTH_PROBE_CONTRACT,
    query: "runs:verifyAuthBoundary",
    authenticatedAccess: "granted",
    unauthenticatedAccess: "denied",
    serverObservedIdentity: {
      role: "service",
      ownerMatchesConfigured: true,
      subjectMatchesService: true,
    },
    freshChallengeResponses: true,
    checkedAt: safeTimestamp(input.checkedAt ?? Date.now()),
  };
}
