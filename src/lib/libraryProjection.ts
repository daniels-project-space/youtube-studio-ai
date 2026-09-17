/**
 * Small, pure rules shared by the bounded Library projections.
 *
 * The database query remains responsible for cursor order and the Convex
 * projection remains responsible for evidence-bound media selection. Keeping
 * these inexpensive predicates here prevents the paginated and legacy list
 * paths from slowly acquiring different archive/date/status semantics.
 */
export type LibraryRunScope = {
  ownerId: string;
  status?: string;
  includeArchived?: boolean;
  libraryState?: "active" | "archived";
  from?: number;
  to?: number;
};

export type LibraryRunTimestamp = {
  ownerId: string;
  status: string;
  libraryState?: "active" | "archived";
  startedAt?: number;
  _creationTime: number;
};

/** The display timestamp used by the existing Library cards and date filters. */
export function libraryRunCreatedAt(run: Pick<LibraryRunTimestamp, "startedAt" | "_creationTime">): number {
  return run.startedAt ?? run._creationTime;
}

/** Cheap run-level filters that can be applied before expensive media joins. */
export function matchesLibraryRunScope(run: LibraryRunTimestamp, scope: LibraryRunScope): boolean {
  if (run.ownerId !== scope.ownerId) return false;
  const libraryState = run.libraryState ?? "active";
  if (scope.libraryState && libraryState !== scope.libraryState) return false;
  if (!scope.includeArchived && libraryState === "archived") return false;
  if (scope.status && run.status !== scope.status) return false;

  const createdAt = libraryRunCreatedAt(run);
  if (scope.from !== undefined && createdAt < scope.from) return false;
  if (scope.to !== undefined && createdAt > scope.to) return false;
  return true;
}

/** Title filtering is deliberately separate because metadata is a paid join. */
export function matchesLibraryTitle(title: string, search?: string): boolean {
  const needle = search?.trim().toLowerCase() ?? "";
  return !needle || title.toLowerCase().includes(needle);
}

