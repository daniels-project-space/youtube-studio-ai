import styles from "./lofi.module.css";

/**
 * This is an evidence archive, not an alternate renderer control surface.
 * Music-loop execution is owned by the sealed channel route and its final QA;
 * historical Golden media must never silently become a current style target.
 */
const CURRENT_REFERENCE = {
  file: "beachcafe",
  title: "Beach Café",
  label: "Reference media",
  meta:
    "A retained composition reference for a warm, original coastal study scene. It is not a prompt, model preset, or publication-ready thumbnail.",
};

const IDENTITY_READS = [
  { index: "01", title: "Breathable depth", detail: "A sheltered foreground opens into a wide horizon; production may study the spatial rhythm, never copy the scene." },
  { index: "02", title: "Human-scale anchor", detail: "One calm focal relationship keeps the ambience legible while the environment carries most of the frame." },
  { index: "03", title: "Slow visual cadence", detail: "Plants, water, clouds, fabric, and distant traffic suggest independent micro-motion rather than one global camera loop." },
  { index: "04", title: "Warm / cool balance", detail: "Warm shelter and cool distance create separation without turning a retained reference into a reusable palette preset." },
];

const EXECUTION_RAILS = [
  {
    title: "Original program",
    detail: "Each episode needs its own sealed music-program plan before a loop is made; a decorative visual cannot substitute for episode differentiation.",
  },
  {
    title: "Final-master evidence",
    detail: "Loop continuity, final audio, visual review, and the explicit ambient pacing exemption are evaluated against the exact released bytes.",
  },
  {
    title: "Runtime truth",
    detail: "This archive does not grant rendering authority. Channel readiness independently checks the exact approved runtime and benchmark before any spend.",
  },
];

const ARCHIVE_BOUNDARIES = [
  "Historical samples remain retained for audit, but are excluded from current generation, Golden quality targets, and automatic channel setup.",
  "Third-party studio, franchise, artist, or provider-style labels are never used as a channel style, prompt target, metadata tag, or thumbnail direction.",
  "A reference image informs an original visual grammar only when the applicable route and rights/provenance rules explicitly admit it.",
];

export default function LofiPage() {
  return (
    <main className={styles.page}>
      <header className={styles.hero}>
        <div className={styles.heroCopy}>
          <p className={styles.eyebrow}>Visual reference</p>
          <h1>Lofi Visual Archive</h1>
          <div className={styles.heroBoundary}>
            <span aria-hidden="true">≈</span>
            <div><small>Rule</small><strong>Study composition. Keep the identity original.</strong></div>
          </div>
        </div>
        <figure className={styles.referenceFrame}>
          {/* eslint-disable-next-line @next/next/no-img-element -- static immutable audit media */}
          <img src={`/golden/lofi/${CURRENT_REFERENCE.file}.jpg`} alt={CURRENT_REFERENCE.meta} />
          <span className={styles.frameCornerA} aria-hidden="true" />
          <span className={styles.frameCornerB} aria-hidden="true" />
          <figcaption>
            <span>{CURRENT_REFERENCE.label}</span>
            <strong>{CURRENT_REFERENCE.title}</strong>
            <small>Manifest-bound still · composition study only</small>
          </figcaption>
        </figure>
        <div className={styles.metricRail}>
          <ArchiveMetric label="Status" value="Reference" note="current manifest" />
          <ArchiveMetric label="Medium" value="Still" note="no video shown" />
          <ArchiveMetric label="Use" value="Composition" note="not a prompt target" />
          <ArchiveMetric label="Runtime" value="None" note="no execution authority" />
        </div>
      </header>

      <section className={styles.referenceDesk} aria-label="Current approved Lofi reference media">
        <div className={styles.sectionHeading}>
          <div><span className={styles.eyebrow}>Current reference</span><h2>Read the scene without copying it.</h2></div>
          <p>{CURRENT_REFERENCE.meta}</p>
        </div>
        <div className={styles.identityGrid}>
          {IDENTITY_READS.map((item) => (
            <article key={item.index}>
              <span>{item.index}</span>
              <div><strong>{item.title}</strong><p>{item.detail}</p></div>
            </article>
          ))}
        </div>
      </section>

      <section className={styles.routeDesk} aria-label="Music-loop execution guarantees">
        <div className={styles.routeMap} aria-label="Reference-to-release evidence path">
          <div className={styles.routeHeader}><span>Reference-to-release path</span><small>No automatic transfer</small></div>
          <div className={styles.routeField}>
            <RouteNode index="01" title="Archive" detail="Retained bytes" node="archive" />
            <RouteNode index="02" title="Original brief" detail="New program plan" node="brief" />
            <RouteNode index="03" title="Sealed route" detail="Runtime admitted" node="route" />
            <RouteNode index="04" title="Final master" detail="Exact bytes reviewed" node="master" />
            <i className={styles.routeLineA} aria-hidden="true" />
            <i className={styles.routeLineB} aria-hidden="true" />
            <i className={styles.routeLineC} aria-hidden="true" />
            <div className={styles.routeCore}><span>ORIGINAL</span><strong>≠</strong><small>reference</small></div>
          </div>
        </div>
        <div className={styles.railList}>
          <div className={styles.sectionHeading}>
            <div><span className={styles.eyebrow}>Execution contract</span><h2>What the real route guarantees</h2></div>
          </div>
          {EXECUTION_RAILS.map((rail, index) => (
            <article key={rail.title}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <div><strong>{rail.title}</strong><p>{rail.detail}</p></div>
            </article>
          ))}
        </div>
      </section>

      <section className={styles.boundaryDesk}>
        <div className={styles.sectionHeading}>
          <div><span className={styles.eyebrow}>Archive boundary</span><h2>Retained does not mean reusable.</h2></div>
          <p>Reference material cannot become channel identity.</p>
        </div>
        <ol>
          {ARCHIVE_BOUNDARIES.map((boundary, index) => (
            <li key={boundary}><span>{String(index + 1).padStart(2, "0")}</span><p>{boundary}</p></li>
          ))}
        </ol>
      </section>
    </main>
  );
}

function ArchiveMetric({ label, value, note }: { label: string; value: string; note: string }) {
  return <div className={styles.metric}><span>{label}</span><strong>{value}</strong><small>{note}</small></div>;
}

function RouteNode({ index, title, detail, node }: { index: string; title: string; detail: string; node: string }) {
  return <div className={styles.routeNode} data-node={node}><span>{index}</span><div><strong>{title}</strong><small>{detail}</small></div><i aria-hidden="true" /></div>;
}
