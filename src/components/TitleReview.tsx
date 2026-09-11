import type { TitleReviewOption, TitleReviewPresentation } from "@/lib/titleReviewPresentation";
import styles from "./TitleReview.module.css";

const grounding = {
  supported: "Source match",
  contradicted: "Contradiction",
  insufficient: "Needs evidence",
};

function Scores({ option }: { option: TitleReviewOption }) {
  return <dl className={styles.scores} aria-label="Model ratings out of ten">
    {[["Pull", option.pull], ["Clarity", option.clarity], ["Identity", option.identity]].map(([label, value]) =>
      <div className={styles.score} key={label}>
        <div className={styles.scoreMeta}><dt>{label}</dt><dd>{value}<small>/10</small></dd></div>
        <span className={styles.scoreTrack} aria-hidden="true"><span style={{ width: `${Number(value) * 10}%` }} /></span>
      </div>)}
  </dl>;
}

export function TitleReview({ review }: { review: TitleReviewPresentation }) {
  if (review.state === "unavailable") return <aside className={styles.warning}>
    Title review unavailable <span>· inspect technical data</span>
  </aside>;
  const otherOptions = review.options.filter((option) => !option.selected);
  return <section className={styles.root} aria-label="Saved title review">
    <header className={styles.header}>
      <div className={styles.heading}><strong>Title review</strong><span className={styles.status}>Judged</span></div>
      <span>{review.source} · {review.attempts} {review.attempts === 1 ? "pass" : "passes"}</span>
    </header>
    {review.state === "title_changed" && <p className={styles.warning}>
      Package title differs from this reviewed winner.
    </p>}
    <div className={styles.selection}>
      <div><span className={styles.label}>Selected title</span>
        <p className={styles.title}>{review.selected.title}</p>
        <span className={styles.verdict} data-grounding={review.selected.grounding}>
          {grounding[review.selected.grounding]}
        </span>
        <p className={styles.reason}>{review.selected.reason}</p>
      </div>
      <Scores option={review.selected} />
    </div>
    <p className={styles.note}>Source-bound model assessment · not fact-check or audience data</p>
    {otherOptions.length > 0 && <details className={styles.comparison}>
      <summary>Compare {otherOptions.length} other {otherOptions.length === 1 ? "title" : "titles"}</summary>
      <ol className={styles.options}>
        {otherOptions.map((option, index) => <li key={index}>
          <div className={styles.optionHeading}><strong>{option.title}</strong>
            {option.alternate && <span className={styles.alternate}>Alternate</span>}</div>
          <span className={styles.verdict} data-grounding={option.grounding}>{grounding[option.grounding]}</span>
          <p className={styles.reason}>{option.reason}</p>
          <Scores option={option} />
        </li>)}
      </ol>
    </details>}
  </section>;
}
