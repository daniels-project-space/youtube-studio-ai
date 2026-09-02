export const LIBRARY_PAGE_SIZE = 8;

export type LibraryPage<T> = {
  visible: T[];
  total: number;
  remaining: number;
  nextBatchSize: number;
};

/** Keep two dense desktop rows visible while retaining deterministic access to every match. */
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
