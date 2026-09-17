type Connector = {
  status: "active" | "revoked" | "error";
  scopeHealth: "healthy" | "partial" | "unknown";
  validatedAt?: number | null;
};

/** UI readiness must agree with the publish gate: unknown scopes are not healthy. */
export function youtubeConnectorPublishingReady(connector: Connector | undefined): boolean {
  return connector?.status === "active" && connector.scopeHealth === "healthy";
}

export function youtubeConnectionLabel(connector: Connector | undefined, loading: boolean): string {
  if (loading) return "Checking";
  if (!connector) return "Not linked";
  if (connector.status !== "active") return "Reconnect";
  if (connector.scopeHealth === "healthy") return "Healthy";
  return connector.scopeHealth === "partial" ? "Partial scopes" : "Scopes unverified";
}

/** `updatedAt` is a connector write, not proof that YouTube credentials worked. */
export function youtubeLastVerifiedLabel(
  connector: Connector | undefined,
  formatDate: (timestamp: number) => string,
): string {
  const validatedAt = connector?.validatedAt;
  return typeof validatedAt === "number" && Number.isFinite(validatedAt) && validatedAt > 0
    ? formatDate(validatedAt)
    : "Not yet verified";
}
