export type ChannelCategoryKey =
  | "sound"
  | "mindset"
  | "stories"
  | "learning"
  | "money"
  | "other";

export type ChannelCategory = {
  key: ChannelCategoryKey;
  label: string;
};

export type CategoryAwareChannel = {
  name?: string | null;
  template?: string | null;
  identity?: {
    niche?: string | null;
    persona?: string | null;
  } | null;
};

export type ChannelCategoryGroup<T> = ChannelCategory & { channels: T[] };

const CATEGORIES: readonly ChannelCategory[] = [
  { key: "sound", label: "Sound & atmosphere" },
  { key: "mindset", label: "Mindset & wellbeing" },
  { key: "stories", label: "Stories & worlds" },
  { key: "learning", label: "Learning & ideas" },
  { key: "money", label: "Money & systems" },
  { key: "other", label: "Independent channels" },
];

function channelTerms(channel: CategoryAwareChannel): string {
  return [
    channel.name,
    channel.template,
    channel.identity?.niche,
    channel.identity?.persona,
  ]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase();
}

/**
 * Main-fleet categories are derived from durable channel identity rather than
 * a manually maintained UI list. New channels therefore arrive in a useful
 * section as soon as their admitted niche/persona is persisted.
 */
export function channelCategoryFor(channel: CategoryAwareChannel): ChannelCategoryKey {
  const terms = channelTerms(channel);
  if (/\blo[- ]?fi\b|ambient|study music|sleep music|rain ambience|soundscape|music/.test(terms)) return "sound";
  if (/stoic|mindset|motivation|psychology|meditation|gratitude|wellbeing|self[- ]?help/.test(terms)) return "mindset";
  // Economic language is more specific than a coincidental suffix such as
  // "Investory". Check it before the broad narrative category and keep
  // story itself word-bounded so new finance names cannot leak into history.
  if (/finance|invest|tax|money|compound|business|economy/.test(terms)) return "money";
  if (/history|lore|crime|mystery|heist|comic|drawn past|inked|\bstory\b|stories/.test(terms)) return "stories";
  if (/education|learning|whiteboard|explainer|science|quiz|tutorial/.test(terms)) return "learning";
  return "other";
}

export function groupChannelsByCategory<T extends CategoryAwareChannel>(
  channels: readonly T[],
): ChannelCategoryGroup<T>[] {
  const buckets = new Map<ChannelCategoryKey, T[]>();
  for (const channel of channels) {
    const key = channelCategoryFor(channel);
    const bucket = buckets.get(key) ?? [];
    bucket.push(channel);
    buckets.set(key, bucket);
  }
  return CATEGORIES.flatMap((category) => {
    const items = buckets.get(category.key) ?? [];
    return items.length ? [{ ...category, channels: items }] : [];
  });
}
