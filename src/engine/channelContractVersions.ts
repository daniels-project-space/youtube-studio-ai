/**
 * Durable channel receipt versions shared by the Convex schema and the richer
 * engine codecs. Keep this module dependency-free: Convex must not import a
 * full planning or rendering graph merely to validate a literal version.
 */
export const CHANNEL_PROGRAM_BRIEF_VERSION = "channel-program-brief/v1" as const;
export const CHANNEL_SHOW_PROFILE_VERSION = "channel-show-profile/v1" as const;
export const CHANNEL_COMPOSITION_RECEIPT_VERSION = "certified-channel-composition-receipt/v2" as const;
