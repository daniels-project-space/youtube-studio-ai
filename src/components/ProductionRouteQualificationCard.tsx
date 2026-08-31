import type { CSSProperties } from "react";

import type {
  ProductionRouteQualification,
  ProductionRouteQualificationBlocker,
} from "@/engine/productionRouteQualification";

export type ProductionRouteQualificationBlockerSummary = Pick<
  ProductionRouteQualificationBlocker,
  "code" | "domain" | "message" | "remediation"
>;

/**
 * Deliberately browser-safe projection of a sealed qualification receipt.
 * Route bindings, evidence payloads, fingerprints, and artifact keys stay out
 * of the Studio surface; operators only need the decision and its remediation.
 */
export type ProductionRouteQualificationSummary = Readonly<{
  mode: ProductionRouteQualification["mode"];
  status: ProductionRouteQualification["status"];
  automaticReady: boolean;
  blockers: readonly ProductionRouteQualificationBlockerSummary[];
}>;

export function productionRouteQualificationSummary(
  qualification: Pick<
    ProductionRouteQualification,
    "mode" | "status" | "automaticReady" | "blockers"
  >,
): ProductionRouteQualificationSummary {
  return {
    mode: qualification.mode,
    status: qualification.status,
    automaticReady: qualification.automaticReady,
    blockers: qualification.blockers.map(({ code, domain, message, remediation }) => ({
      code,
      domain,
      message,
      remediation,
    })),
  };
}

type ProductionRouteQualificationCardProps = {
  qualification?: ProductionRouteQualificationSummary | null;
  unavailableMessage?: string;
};

const statusPresentation = {
  qualified: {
    label: "Automatic",
    chip: "AUTOMATIC",
    color: "var(--color-ok)",
    description: "All required frozen evidence is bound. This route may run automatically.",
  },
  supervised_review: {
    label: "Supervised",
    chip: "SUPERVISED",
    color: "var(--color-gold)",
    description: "This route is qualified for supervised review, not automatic production.",
  },
  blocked: {
    label: "Blocked",
    chip: "BLOCKED",
    color: "var(--color-warning)",
    description: "Production is held until every listed evidence blocker is resolved.",
  },
} as const;

export function ProductionRouteQualificationCard({
  qualification,
  unavailableMessage = "No persisted per-channel qualification receipt is connected to this surface.",
}: ProductionRouteQualificationCardProps) {
  if (!qualification) {
    return (
      <section aria-label="Production route qualification" style={CARD}>
        <CardHeading title="Route qualification" chip="NO RECEIPT CONNECTED" tone="var(--color-warning)" />
        <p style={BODY}>{unavailableMessage}</p>
        <p style={{ ...BODY, marginTop: "0.25rem" }}>
          Family admission is policy-level information, not proof that a concrete channel route is ready to produce.
        </p>
      </section>
    );
  }

  const presentation = statusPresentation[qualification.status];
  const hasBlockers = qualification.blockers.length > 0;

  return (
    <section aria-label="Production route qualification" style={CARD}>
      <CardHeading title="Route qualification" chip={presentation.chip} tone={presentation.color} />
      <div style={{ display: "grid", gap: "0.16rem" }}>
        <strong style={{ fontSize: "0.84rem", color: presentation.color }}>{presentation.label}</strong>
        <span style={BODY}>{presentation.description}</span>
      </div>
      <div style={STATUS_GRID}>
        <StatusFact label="Operating mode" value={qualification.mode === "automatic" ? "Automatic" : "Supervised"} />
        <StatusFact label="Automatic ready" value={qualification.automaticReady ? "Yes" : "No"} />
        <StatusFact label="Evidence blockers" value={String(qualification.blockers.length)} />
      </div>
      {hasBlockers ? (
        <ol style={BLOCKER_LIST}>
          {qualification.blockers.map((blocker) => (
            <li key={`${blocker.domain}-${blocker.code}`} style={BLOCKER}>
              <span style={{ ...LABEL, color: presentation.color }}>
                {blocker.domain.replaceAll("_", " ")} · {blocker.code.replaceAll("_", " ")}
              </span>
              <strong style={{ fontSize: "0.72rem", lineHeight: 1.34 }}>{blocker.message}</strong>
              <span style={BODY}>Next: {blocker.remediation}</span>
            </li>
          ))}
        </ol>
      ) : (
        <span style={{ ...BODY, borderTop: "1px solid var(--color-border)", paddingTop: "0.55rem" }}>
          {qualification.status === "supervised_review"
            ? "No evidence blockers were reported; human review remains the selected operating mode."
            : "No evidence blockers were reported in this qualification receipt."}
        </span>
      )}
    </section>
  );
}

function CardHeading({ title, chip, tone }: { title: string; chip: string; tone: string }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "0.5rem", flexWrap: "wrap" }}>
      <span style={LABEL}>{title}</span>
      <span className="status-chip" style={{ borderColor: `color-mix(in srgb, ${tone} 58%, var(--color-border))`, color: tone }}>
        {chip}
      </span>
    </div>
  );
}

function StatusFact({ label, value }: { label: string; value: string }) {
  return (
    <div style={FACT}>
      <span style={LABEL}>{label}</span>
      <strong style={{ fontSize: "0.74rem" }}>{value}</strong>
    </div>
  );
}

const CARD: CSSProperties = {
  display: "grid",
  gap: "0.58rem",
  padding: "0.85rem",
  border: "1px solid var(--color-border)",
  borderRadius: 10,
  background: "var(--color-surface-solid)",
};

const LABEL: CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: "0.56rem",
  lineHeight: 1.35,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "var(--color-faint)",
};

const BODY: CSSProperties = {
  margin: 0,
  fontSize: "0.7rem",
  lineHeight: 1.42,
  color: "var(--color-muted)",
};

const STATUS_GRID: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))",
  gap: "0.38rem",
};

const FACT: CSSProperties = {
  display: "grid",
  gap: "0.16rem",
  padding: "0.45rem",
  border: "1px solid var(--color-border)",
  borderRadius: 7,
  background: "var(--color-surface)",
};

const BLOCKER_LIST: CSSProperties = {
  display: "grid",
  gap: "0.4rem",
  margin: 0,
  padding: 0,
  listStyle: "none",
};

const BLOCKER: CSSProperties = {
  display: "grid",
  gap: "0.18rem",
  padding: "0.52rem",
  borderTop: "1px solid var(--color-border)",
};
