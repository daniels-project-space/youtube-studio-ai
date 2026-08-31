import type { OperationsAccessState } from "./OperationsAccess";

/** Compact, truthful replacement for an unauthorized private-desk request. */
export function OwnerOnlyNotice({
  access,
  desk,
}: {
  access: Exclude<OperationsAccessState, "owner">;
  desk: string;
}) {
  const checking = access === "checking";

  return (
    <section
      className="owner-only-notice"
      aria-live={checking ? "polite" : undefined}
      data-access-state={access}
    >
      <span className="owner-only-notice-rail" aria-hidden="true" />
      <div>
        <small>{checking ? "Checking access" : "Owner-only desk"}</small>
        <h2>{checking ? "Checking owner access…" : "Operations are locked"}</h2>
        <p>
          {checking
            ? `Confirming whether this browser may open ${desk}.`
            : `Unlock operations in the top bar to open ${desk}. No private data request was sent.`}
        </p>
      </div>
    </section>
  );
}
