export function admitProviderTaskOwner(args: {
  requestedOwnerId?: string;
  configuredOwnerId?: string;
  runtime?: string;
  developmentFallbackOwnerId?: string;
}): string {
  const requested = args.requestedOwnerId?.trim();
  const configured = args.configuredOwnerId?.trim();

  if (configured) {
    if (requested && requested !== configured) {
      throw new Error("provider task owner does not match STUDIO_OWNER_ID");
    }
    return configured;
  }

  if (args.runtime === "production") {
    throw new Error("provider task requires STUDIO_OWNER_ID in production");
  }

  const fallback = args.developmentFallbackOwnerId?.trim();
  const ownerId = requested || fallback;
  if (!ownerId) throw new Error("provider task owner is not configured");
  return ownerId;
}
