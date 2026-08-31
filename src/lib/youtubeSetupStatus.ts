/**
 * A deliberately conservative view of the external YouTube setup state.
 *
 * A valid refresh token is not enough to call a channel production-ready: the
 * selected destination and every required OAuth scope must be present.  Nor
 * can this application prove a Google profile-photo change, so that remains an
 * explicit owner handoff instead of a falsely-complete checkbox.
 */

export type YouTubeSetupConnector = {
  status?: "active" | "revoked" | "error";
  scopeHealth?: "healthy" | "partial" | "unknown";
  ytChannelId?: string | null;
  ytTitle?: string | null;
};

export type YouTubeCreatedSetup = {
  ytChannelId?: string;
  handle?: string;
  url?: string;
  status?: string;
};

export type YouTubeSetupAssessment = {
  destination: "creating" | "verified" | "created_needs_oauth" | "unverified" | "needs_channel";
  oauth: "ready" | "incomplete" | "reconnect_required" | "connect_required" | "waiting_for_channel" | "needs_channel";
  targetChannelId?: string;
  targetLabel?: string;
  canConnect: boolean;
  canAutoCreate: boolean;
  profileHandoff: "owner_action_required" | "waiting_for_target" | "missing_generated_asset";
  brandingSync: "attempted_unverified" | "waiting_for_oauth";
};

function clean(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

/**
 * Derive UI state only from provider-bound records.  This intentionally never
 * reports the profile image or branding request as completed: neither has a
 * reliable receipt in the YouTube Data API integration today.
 */
export function assessYouTubeSetup(args: {
  connector?: YouTubeSetupConnector;
  created?: YouTubeCreatedSetup;
  generatedAvatarKey?: string;
}): YouTubeSetupAssessment {
  const connector = args.connector;
  const created = args.created;
  const connectorTarget = connector?.status === "active" ? clean(connector.ytChannelId) : undefined;
  const createdTarget = clean(created?.ytChannelId);
  const targetChannelId = connectorTarget ?? createdTarget;
  // A title saved by a revoked/error connector may describe a different old
  // destination. Only use it when its active connector supplied the target.
  const targetLabel = connectorTarget
    ? clean(connector?.ytTitle) ?? connectorTarget
    : clean(created?.handle) ?? targetChannelId;
  const creating = created?.status === "creating";
  const oauthReady = Boolean(
    connectorTarget && connector?.status === "active" && connector.scopeHealth === "healthy",
  );
  const activeButIncomplete = Boolean(
    connectorTarget && connector?.status === "active" && !oauthReady,
  );

  const destination: YouTubeSetupAssessment["destination"] = creating
    ? "creating"
    : connectorTarget
      ? "verified"
      : createdTarget
        ? "created_needs_oauth"
        : connector
          ? "unverified"
          : "needs_channel";

  const oauth: YouTubeSetupAssessment["oauth"] = oauthReady
    ? "ready"
    : activeButIncomplete
      ? "incomplete"
      : connector?.status === "revoked" || connector?.status === "error"
        ? "reconnect_required"
        : creating
          ? "waiting_for_channel"
          : createdTarget
            ? "connect_required"
            : "needs_channel";

  return {
    destination,
    oauth,
    targetChannelId,
    targetLabel,
    canConnect: !creating,
    // Do not offer another irreversible create after either a stored connector
    // or a durable provider-created target already exists.
    canAutoCreate: !creating && !createdTarget && !connector,
    profileHandoff: args.generatedAvatarKey
      ? targetChannelId
        ? "owner_action_required"
        : "waiting_for_target"
      : "missing_generated_asset",
    brandingSync: oauthReady ? "attempted_unverified" : "waiting_for_oauth",
  };
}
