export type TopicIdentityFallback = {
  name?: string | null;
  identity?: {
    persona?: string;
    niche?: string;
    styleGrammar?: string;
    topicPool?: string[];
    bannedWords?: string[];
  } | null;
} | null;

export type TopicSelectionIdentity = {
  channelName: string;
  persona: string;
  niche: string;
  style: string;
  pool: string[];
  bannedWords: string[];
};

function completeFrozenIdentity(store: Record<string, unknown>): boolean {
  return typeof store.channelName === "string" &&
    typeof store.persona === "string" &&
    typeof store.niche === "string" &&
    typeof store.styleGrammar === "string" &&
    Array.isArray(store.topicPool) && store.topicPool.every((value) => typeof value === "string") &&
    Array.isArray(store.bannedWords) && store.bannedWords.every((value) => typeof value === "string");
}

function seededText(store: Record<string, unknown>, key: string): string | undefined {
  const value = store[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function seededStrings(value: unknown, fallback: string[] = []): string[] {
  const values = Array.isArray(value) ? value : fallback;
  return values.filter((item): item is string => typeof item === "string" && item.length > 0);
}

/** Prefer run-frozen identity; fetch the channel row only for legacy/direct callers. */
export async function loadTopicSelectionIdentity(
  store: Record<string, unknown>,
  loadChannel: () => Promise<TopicIdentityFallback>,
): Promise<TopicSelectionIdentity> {
  const channel = completeFrozenIdentity(store) ? null : await loadChannel();
  const identity = channel?.identity ?? {};
  return {
    channelName: seededText(store, "channelName") ?? channel?.name ?? "this channel",
    persona: seededText(store, "persona") ?? identity.persona ?? "",
    niche: seededText(store, "niche") ?? identity.niche ?? "",
    style: typeof store.styleGrammar === "string" ? store.styleGrammar : identity.styleGrammar ?? "",
    pool: seededStrings(store.topicPool, identity.topicPool ?? []),
    bannedWords: seededStrings(store.bannedWords, identity.bannedWords ?? []),
  };
}
