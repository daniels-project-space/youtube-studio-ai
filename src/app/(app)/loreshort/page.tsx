import Link from "next/link";
import { goldenProofMediaPresentation } from "@/engine/goldenProofMedia";
import styles from "@/components/ReferenceStudy.module.css";

// Presentation follows the actual manifest, never a relabelled historical file.
const CURRENT_REFERENCE = goldenProofMediaPresentation("loreshort-smith4k-image", "reference", "image");

const COMPOSITION_CUES = [
  { title: "Action", detail: "Maker, hammer and glowing ring tell one clear beat." },
  { title: "Material", detail: "Loose ink, broad shapes and an ember focal point." },
  { title: "World", detail: "Architecture gives the action a place and scale." },
  { title: "Depth", detail: "Foreground iron, working figure, pale distance." },
];

const CONTINUITY_GATES = [
  { title: "Plan each scene", detail: "Map every narrated beat before generation; opening references cannot be recycled across later narration." },
  { title: "Carry the identity", detail: "Keep characters, objects, locations, palette and illustration grammar consistent across the full sequence." },
  { title: "Audit the complete edit", detail: "Review the exact final master for full-story coverage, visual quality, timing and release evidence. Candidate images alone are not proof." },
];

const EXECUTION_RAILS = [
  { title: "Runtime not qualified", detail: "Lore Short is unavailable to the automatic creator until its exact open-weight LTX 2.5 Novita runtime is benchmarked and route qualification is sealed. This reference grants no rendering authority." },
  { title: "Original plan required", detail: "Use a self-contained original story plan and critic receipt. Named franchises, their characters, worlds, plots and visual identifiers cannot seed new work." },
  { title: "Archive only", detail: "Historical samples remain retained for audit and comparison, not as executable renderers, channel recipes or release-quality proof. This page triggers no rendering, provider work, training or publishing." },
];

export default function LoreShortPage() {
  return (
    <div className={styles.page} data-reference-theme="lore">
      <header className={styles.heading}>
        <div><h1>Lore references</h1><p>Composition study · still image</p></div>
        <Link href="/golden" prefetch={false} className={styles.action}>Golden modules <span aria-hidden="true">↗</span></Link>
      </header>
      <section className={styles.study} aria-label="Lore composition reference">
        <figure className={styles.referenceFrame} data-proof-media-id={CURRENT_REFERENCE.id}
          data-proof-media-status={CURRENT_REFERENCE.status} data-proof-media-sha256={CURRENT_REFERENCE.sha256}>
          {/* eslint-disable-next-line @next/next/no-img-element -- display exact immutable reference bytes */}
          <img src={CURRENT_REFERENCE.url} width={1280} height={720}
            alt="An illustrated blacksmith forging a glowing ring, framed by pale arches and foreground tools." />
          <figcaption>
            <div><strong>Blacksmith study</strong><span>Reference media · not a final master</span></div>
            <a href={CURRENT_REFERENCE.url} className={styles.action}>Open full image <span aria-hidden="true">↗</span></a>
          </figcaption>
        </figure>
        <aside className={styles.studyNotes} aria-label="Composition cues">
          <h2>What to study</h2>
          <p className={styles.coverageNote}>Draw every narrated beat—not just the opening.</p>
          <ul>{COMPOSITION_CUES.map(cue => <li key={cue.title}><strong>{cue.title}</strong><p>{cue.detail}</p></li>)}</ul>
        </aside>
      </section>
      <details className={styles.rules}>
        <summary>Story &amp; release requirements <span aria-hidden="true">+</span></summary>
        <div className={styles.rulesBody}>
          <section aria-labelledby="lore-story-requirements">
            <h2 id="lore-story-requirements">Full-story coverage</h2>
            <ol>{CONTINUITY_GATES.map(gate => <li key={gate.title}><strong>{gate.title}</strong><p>{gate.detail}</p></li>)}</ol>
          </section>
          <section aria-labelledby="lore-reference-boundaries">
            <h2 id="lore-reference-boundaries">Before rendering</h2>
            <ul>{EXECUTION_RAILS.map(rail => <li key={rail.title}><strong>{rail.title}</strong><p>{rail.detail}</p></li>)}</ul>
          </section>
        </div>
      </details>
    </div>
  );
}
