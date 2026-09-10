/**
 * Routes where owner elevation is a meaningful, near-term action in the
 * page itself. Read-only surfaces keep their clean workspace chrome and ask
 * for elevation at the consequential control instead.
 */
const OWNER_ACTION_ROUTE_PREFIXES = [
  "/channels",
  "/settings",
  "/novita-render",
  "/casefile",
  "/editorial-evidence",
  "/studio-assets",
] as const;

export function shouldShowOperationsTrigger(pathname: string | null): boolean {
  if (!pathname) return false;
  return OWNER_ACTION_ROUTE_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}
