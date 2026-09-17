import { redirect } from "next/navigation";

/**
 * Compatibility entry point for the former production URL. The canonical
 * production workspace is the persisted run history at /runs; keeping this
 * alias prevents stale deep links and the release audit from landing on a 404.
 */
export default function ProductionAliasPage(): never {
  redirect("/runs");
}
