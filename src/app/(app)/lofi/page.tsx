import Link from "next/link";
import { goldenProofMediaPresentation } from "@/engine/goldenProofMedia";
import styles from "./lofi.module.css";

// The archive may display only a currently admitted reference. It never
// supplies a render preset or promotes historical media into production.
const CURRENT_REFERENCE = goldenProofMediaPresentation("lofi-beachcafe-image", "reference", "image");

const COMPOSITION_CUES = [
  { title: "Depth", detail: "A sheltered foreground opens onto a wide horizon." },
  { title: "Focus", detail: "Small figures leave room for the landscape." },
  { title: "Motion ideas", detail: "Water, leaves and clouds can move independently." },
  { title: "Color", detail: "Warm shelter contrasts with a cool, open sea." },
];

const EXECUTION_RAILS = [
  { title: "Original program", detail: "Each episode needs its own sealed music-program plan before a loop is made; a decorative visual cannot substitute for episode differentiation." },
  { title: "Final-master evidence", detail: "Loop continuity, final audio, visual review, and the explicit ambient pacing exemption are evaluated against the exact released bytes." },
  { title: "Runtime admission", detail: "This archive does not grant rendering authority. Channel readiness independently checks the exact approved runtime and benchmark before any spend." },
];

const ARCHIVE_BOUNDARIES = [
  "Historical samples remain retained for audit, but are excluded from current generation, Golden quality targets, and automatic channel setup.",
  "Third-party studio, franchise, artist, or provider-style labels are never used as a channel style, prompt target, metadata tag, or thumbnail direction.",
  "A reference image informs an original visual grammar only when the applicable route and rights/provenance rules explicitly admit it.",
];

export default function LofiPage() {
  return (
    <div className={styles.page}>
      <header className={styles.heading}>
        <div><h1>Lo-fi references</h1><p>Composition study · still image</p></div>
        <Link href="/golden" prefetch={false} className={styles.action}>Golden modules <span aria-hidden="true">↗</span></Link>
      </header>

      <section className={styles.study} aria-label="Lo-fi composition reference">
        <figure className={styles.referenceFrame} data-proof-media-id={CURRENT_REFERENCE.id}
          data-proof-media-status={CURRENT_REFERENCE.status} data-proof-media-sha256={CURRENT_REFERENCE.sha256}>
          {/* eslint-disable-next-line @next/next/no-img-element -- display exact immutable reference bytes */}
          <img src={CURRENT_REFERENCE.url} width={1280} height={714}
            alt="A woman and cat on a shaded café terrace overlooking a turquoise bay and sailboats." />
          <figcaption>
            <div><strong>Beach Café</strong><span>Reference media</span></div>
            <a href={CURRENT_REFERENCE.url} className={styles.action}>Open full image <span aria-hidden="true">↗</span></a>
          </figcaption>
        </figure>
        <aside className={styles.studyNotes} aria-label="Composition cues">
          <h2>What to study</h2>
          <ul>{COMPOSITION_CUES.map(cue => <li key={cue.title}><strong>{cue.title}</strong><p>{cue.detail}</p></li>)}</ul>
          <p className={styles.note}>Study composition. Keep the identity original.</p>
        </aside>
      </section>

      <details className={styles.rules}>
        <summary>Use &amp; release requirements <span aria-hidden="true">+</span></summary>
        <div className={styles.rulesBody}>
          <section aria-labelledby="lofi-release-requirements">
            <h2 id="lofi-release-requirements">Before rendering</h2>
            <ol>{EXECUTION_RAILS.map(rail => <li key={rail.title}><strong>{rail.title}</strong><p>{rail.detail}</p></li>)}</ol>
          </section>
          <section aria-labelledby="lofi-reference-boundaries">
            <h2 id="lofi-reference-boundaries">Reference boundaries</h2>
            <ul>{ARCHIVE_BOUNDARIES.map(boundary => <li key={boundary}><p>{boundary}</p></li>)}</ul>
          </section>
        </div>
      </details>
    </div>
  );
}
