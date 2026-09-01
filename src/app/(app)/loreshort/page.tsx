import styles from "./loreshort.module.css";

const CURRENT_REFERENCE = {
  file: "smith4k",
  title: "Original blacksmith study",
  label: "Reference media",
  meta: "An approved original-lore reference still retained to evaluate composition, legibility, and depth—not a reusable story, character, franchise, or renderer preset.",
} as const;

const IDENTITY_NOTES = [
  { index: "A", title: "One legible action", detail: "The frame resolves immediately: maker, tool, object, heat, and place form one readable story beat." },
  { index: "B", title: "Illustrated materiality", detail: "Loose ink edges, broad value shapes, and an ember focal point create a drawn record rather than photoreal spectacle." },
  { index: "C", title: "World beyond the subject", detail: "Architecture continues behind the action so the scene feels situated, not like an isolated character card." },
  { index: "D", title: "Depth with restraint", detail: "Foreground iron, working figure, and pale distant structures separate clearly without excessive effects." },
] as const;

const CONTINUITY_GATES = [
  { index: "01", title: "Narration mapped", detail: "Every planned beat owns a scene requirement before generation begins." },
  { index: "02", title: "Every beat drawn", detail: "The full story receives story-specific imagery; the opening references cannot be recycled across later narration." },
  { index: "03", title: "Identity carried", detail: "Characters, objects, locations, palette, and illustration grammar persist across the sequence." },
  { index: "04", title: "Final master audited", detail: "Review proves the exact edit covers the full story, not merely that candidate images exist." },
] as const;

const EXECUTION_RAILS = [
  {
    title: "Route status",
    detail: "Lore Short is not available to the automatic creator yet. It stays blocked until its exact open-weight LTX 2.5 Novita runtime is benchmarked and its route qualification is sealed.",
  },
  {
    title: "Originality boundary",
    detail: "A future route must start from a self-contained original story plan and critic receipt. It cannot adapt named franchises, their characters, worlds, plots, or visual identifiers.",
  },
  {
    title: "Release evidence",
    detail: "A rendered episode must prove its own final master, quality review, timing, and release evidence. Archive media cannot satisfy any of those gates.",
  },
] as const;

const ARCHIVE_BOUNDARIES = [
  "Historical samples remain retained for audit and comparison only; they are never presented as an executable renderer, channel recipe, or release-quality proof.",
  "Named-franchise examples are intentionally excluded from this page and cannot seed a new script, visual prompt, character, or style treatment.",
  "This page does not trigger rendering, provider work, training, or publishing. The automatic creator remains the only route into an admitted production pipeline.",
] as const;

export default function LoreShortPage() {
  return (
    <main className={styles.page}>
      <header className={styles.hero}>
        <figure className={styles.referencePlate}>
          {/* eslint-disable-next-line @next/next/no-img-element -- static immutable audit media */}
          <img src={`/golden/loreshort/${CURRENT_REFERENCE.file}.jpg`} alt={CURRENT_REFERENCE.meta} />
          <span className={styles.registrationA} aria-hidden="true" />
          <span className={styles.registrationB} aria-hidden="true" />
          <figcaption><span>{CURRENT_REFERENCE.label}</span><strong>{CURRENT_REFERENCE.title}</strong><small>Manifest-bound composition reference</small></figcaption>
        </figure>
        <div className={styles.heroCopy}>
          <p className={styles.eyebrow}>Visual reference</p>
          <h1>Lore Short archive</h1>
          <div className={styles.heroRule}><span aria-hidden="true">✣</span><div><small>Rule</small><strong>Draw every narrated beat.</strong></div></div>
        </div>
        <div className={styles.metricRail}>
          <ArchiveMetric label="Artifact" value="Still" note="no video displayed" />
          <ArchiveMetric label="Status" value="Reference" note="not promoted" />
          <ArchiveMetric label="Story proof" value="None" note="single frame only" />
          <ArchiveMetric label="Runtime" value="Blocked" note="benchmark missing" />
          <ArchiveMetric label="Release" value="None" note="no final master" />
        </div>
      </header>

      <section className={styles.identityDesk} aria-label="Current approved Lore Short reference media">
        <div className={styles.sectionHeading}>
          <div><span className={styles.eyebrow}>Current reference</span><h2>What this frame can—and cannot—teach.</h2></div>
          <p>{CURRENT_REFERENCE.meta}</p>
        </div>
        <div className={styles.identityNotes}>
          {IDENTITY_NOTES.map((note) => <article key={note.index}><span>{note.index}</span><div><strong>{note.title}</strong><p>{note.detail}</p></div></article>)}
        </div>
      </section>

      <section className={styles.sequenceDesk} aria-label="Lore Short full-story illustration requirements">
        <div className={styles.sequenceCopy}>
          <span className={styles.eyebrow}>Full-story coverage</span>
          <h2>The route must draw beyond the opening.</h2>
          <p>Every shot must preserve the channel identity.</p>
          <div className={styles.sequenceBoundary}><span>PLAN</span><i /><span>SHOTS</span><i /><span>MASTER</span><i /><span>REVIEW</span></div>
        </div>
        <div className={styles.storyboardStrip}>
          {CONTINUITY_GATES.map((gate) => (
            <article key={gate.index}>
              <div className={styles.frameWindow} data-index={gate.index}><span>{gate.index}</span><i aria-hidden="true" /></div>
              <strong>{gate.title}</strong><p>{gate.detail}</p>
            </article>
          ))}
        </div>
      </section>

      <section className={styles.admissionDesk} aria-label="Lore Short route requirements">
        <div className={styles.admissionMap}>
          <header><span>Future route admission</span><small>All gates held</small></header>
          <div className={styles.admissionField}>
            <i className={styles.admissionSpine} aria-hidden="true" />
            <AdmissionNode index="01" title="Original plan" detail="Story + critic receipt" />
            <AdmissionNode index="02" title="Exact runtime" detail="LTX 2.5 benchmark" />
            <AdmissionNode index="03" title="Sequence proof" detail="Every beat illustrated" />
            <AdmissionNode index="04" title="Release evidence" detail="Final master sealed" />
            <div className={styles.admissionSeal}><span>ROUTE</span><strong>HELD</strong><small>no creator intake</small></div>
          </div>
        </div>
        <div className={styles.railList}>
          <div className={styles.sectionHeading}><div><span className={styles.eyebrow}>Admission requirements</span><h2>What the future route must prove</h2></div></div>
          {EXECUTION_RAILS.map((rail, index) => <article key={rail.title}><span>{String(index + 1).padStart(2, "0")}</span><div><strong>{rail.title}</strong><p>{rail.detail}</p></div></article>)}
        </div>
      </section>

      <section className={styles.boundaryDesk}>
        <div className={styles.sectionHeading}>
          <div><span className={styles.eyebrow}>Archive boundary</span><h2>Reference is not inheritance.</h2></div>
          <p>References inform craft, never channel identity.</p>
        </div>
        <ol>{ARCHIVE_BOUNDARIES.map((boundary, index) => <li key={boundary}><span>{String(index + 1).padStart(2, "0")}</span><p>{boundary}</p></li>)}</ol>
      </section>
    </main>
  );
}

function ArchiveMetric({ label, value, note }: { label: string; value: string; note: string }) {
  return <div className={styles.metric}><span>{label}</span><strong>{value}</strong><small>{note}</small></div>;
}

function AdmissionNode({ index, title, detail }: { index: string; title: string; detail: string }) {
  return <div className={styles.admissionNode}><span>{index}</span><div><strong>{title}</strong><small>{detail}</small></div><i aria-hidden="true" /></div>;
}
