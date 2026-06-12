import { GOLDEN_MODULES, GOLDEN_SPINE, type GoldenModule } from "@/engine/golden";
import { PageHeader, SectionTitle } from "@/components/PageHeader";

/**
 * Golden Pipeline — the template every channel inherits, module by module.
 * Pure static render of the GOLDEN_MODULES registry (src/engine/golden.ts):
 * the engine and this page share one source of truth, so certifying a module
 * "golden" there is what lights it up here.
 */
export default function GoldenPipelinePage() {
  const golden = GOLDEN_MODULES.filter((m) => m.status === "golden");
  const active = GOLDEN_MODULES.filter((m) => m.status !== "golden");
  const stageOrder = GOLDEN_SPINE.map((s) => s.stage);

  return (
    <>
      <PageHeader
        title="Golden Pipeline"
        subtitle="The template every channel inherits — refine a module once here, lift every channel at once. Gold = certified at the golden bar."
      />

      <SectionTitle>
        Certified golden — {golden.length} of {GOLDEN_MODULES.length} modules
      </SectionTitle>
      <div style={{ display: "grid", gap: "1rem", marginBottom: "2.25rem" }}>
        {golden.map((m) => (
          <ModuleCard key={m.key} module={m} hero />
        ))}
      </div>

      <SectionTitle>The spine — stage order every channel runs</SectionTitle>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))",
          gap: "1rem",
        }}
      >
        {active.map((m) => (
          <ModuleCard key={m.key} module={m} stageIndex={stageOrder.indexOf(m.stage) + 1} />
        ))}
      </div>
    </>
  );
}

function ModuleCard({
  module: m,
  hero = false,
  stageIndex,
}: {
  module: GoldenModule;
  hero?: boolean;
  stageIndex?: number;
}) {
  const isGolden = m.status === "golden";
  return (
    <article
      className={`glass glass-shine lift${isGolden ? " golden-glow" : ""}`}
      style={{ padding: hero ? "1.5rem 1.6rem" : "1.15rem 1.25rem" }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "0.75rem",
          marginBottom: "0.6rem",
        }}
      >
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "0.7rem",
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "var(--color-faint)",
          }}
        >
          {stageIndex ? `stage ${stageIndex} · ` : ""}
          {m.stage}
        </span>
        {isGolden ? (
          <span className="golden-chip">★ GOLDEN</span>
        ) : (
          <span
            style={{
              padding: "0.2rem 0.6rem",
              borderRadius: 999,
              fontSize: "0.68rem",
              fontWeight: 600,
              letterSpacing: "0.08em",
              color: "var(--color-muted)",
              border: "1px solid var(--color-border-strong)",
            }}
          >
            ACTIVE
          </span>
        )}
      </div>

      <h3 style={{ fontSize: hero ? "1.45rem" : "1.08rem", fontWeight: 600 }}>{m.title}</h3>
      <p
        style={{
          margin: "0.35rem 0 0.7rem",
          fontFamily: "var(--font-mono)",
          fontSize: "0.74rem",
          color: isGolden ? "var(--color-gold)" : "var(--color-secondary)",
        }}
      >
        {m.engine}
      </p>
      <p style={{ margin: 0, fontSize: "0.88rem", lineHeight: 1.55, color: "var(--color-muted)" }}>
        {m.how}
      </p>

      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem", marginTop: "0.85rem" }}>
        {m.gates.map((g) => (
          <span
            key={g}
            style={{
              padding: "0.16rem 0.55rem",
              borderRadius: 999,
              fontSize: "0.7rem",
              color: "var(--color-fg)",
              background: isGolden ? "rgba(212, 160, 23, 0.13)" : "var(--color-surface-solid)",
              border: `1px solid ${isGolden ? "rgba(212, 160, 23, 0.35)" : "var(--color-border)"}`,
            }}
          >
            {g}
          </span>
        ))}
      </div>
    </article>
  );
}
