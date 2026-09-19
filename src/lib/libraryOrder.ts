/** Saved-work ordering, never a competitor-derived performance forecast. */
export type LibrarySortKey = "date" | "oldest";

export function orderLibraryVideos<T extends { _id: string; createdAt: number }>(
  videos: readonly T[], order: LibrarySortKey,
): T[] {
  return [...videos].sort((a, b) => {
    const difference = a.createdAt - b.createdAt;
    if (difference) return order === "oldest" ? difference : -difference;
    return a._id < b._id ? -1 : a._id > b._id ? 1 : 0;
  });
}
