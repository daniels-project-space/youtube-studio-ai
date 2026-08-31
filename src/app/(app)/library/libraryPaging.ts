export const LIBRARY_PAGE_SIZE = 4;

export type LibraryPage<T> = {
  visible: T[];
  total: number;
  remaining: number;
  nextBatchSize: number;
};

/** Open the newest matching channel by default; explicit operator choices always win. */
export function isLibraryGroupExpanded(groupIndex: number, override?: boolean): boolean {
  return override ?? groupIndex === 0;
}

/** Keep one desktop row visible while retaining deterministic access to every match. */
export function pageLibraryGroup<T>(items: readonly T[], requestedLimit?: number): LibraryPage<T> {
  const limit = Math.max(
    LIBRARY_PAGE_SIZE,
    Number.isFinite(requestedLimit) ? Math.floor(requestedLimit as number) : LIBRARY_PAGE_SIZE,
  );
  const visible = items.slice(0, limit);
  const remaining = Math.max(0, items.length - visible.length);

  return {
    visible,
    total: items.length,
    remaining,
    nextBatchSize: Math.min(LIBRARY_PAGE_SIZE, remaining),
  };
}
