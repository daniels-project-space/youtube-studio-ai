import styles from "./NicheMotionGlyph.module.css";
import { channelMotionMotifFor } from "@/lib/channelMotion";

/** The Studio's reusable, topic-specific symbolic language. */
export { channelMotionMotifFor, type ChannelMotionMotif } from "@/lib/channelMotion";

export function NicheMotionGlyph({
  niche,
  channelName,
  className,
}: {
  niche?: string | null;
  channelName?: string | null;
  className?: string;
}) {
  const motif = channelMotionMotifFor({ niche, channelName });
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      className={[styles.glyph, className].filter(Boolean).join(" ")}
      data-motif={motif}
    >
      {motif === "lofi" && <LoFi />}
      {motif === "lesson" && <Lesson />}
      {motif === "ledger" && <Ledger />}
      {motif === "circuit" && <Circuit />}
      {motif === "heart" && <Heart />}
      {motif === "steam" && <Steam />}
      {motif === "compass" && <Compass />}
      {motif === "clapper" && <Clapper />}
      {motif === "mind" && <Mind />}
      {motif === "casefile" && <Casefile />}
      {motif === "book" && <Book />}
      {motif === "pen" && <Pen />}
      {motif === "summit" && <Summit />}
      {motif === "health" && <Health />}
      {motif === "business" && <Business />}
    </svg>
  );
}

function LoFi() {
  return <><circle cx="16" cy="16" r="11.5" stroke="currentColor" strokeWidth="1" opacity=".38" /><path d="M8.5 16h2m2-4v8m3-11v14m3-9v4m3-7v10" className={styles.equalizer} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></>;
}
function Lesson() {
  return <><circle cx="16" cy="16" r="11.5" stroke="currentColor" strokeWidth="1" opacity=".38" /><path d="M9 10.5h14v11H9zM12 14h8m-8 3h5" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" /><path d="m20 9 1.4-2 1.4 2 2 .8-2 1-1.4 2-1.4-2-2-1z" className={styles.spark} fill="currentColor" /></>;
}
function Ledger() {
  return <><circle cx="16" cy="16" r="11.5" stroke="currentColor" strokeWidth="1" opacity=".38" /><rect x="9.5" y="8.5" width="13" height="15" rx="1.8" stroke="currentColor" strokeWidth="1.25" /><path d="M12 13h8m-8 3h5m-5 3h7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" /><circle className={styles.ledgerCoin} cx="20" cy="20" r="2.6" fill="currentColor" opacity=".78" /></>;
}
function Circuit() {
  return <><circle cx="16" cy="16" r="11.5" stroke="currentColor" strokeWidth="1" opacity=".38" /><path d="M9 12h5v-3m0 3h5v3m-5 0v8m0-4h7" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" /><circle cx="14" cy="9" r="1.45" fill="currentColor" /><circle className={styles.circuitNode} cx="19" cy="15" r="1.45" fill="currentColor" /><circle cx="21" cy="19" r="1.45" fill="currentColor" /></>;
}
function Heart() {
  return <><circle cx="16" cy="16" r="11.5" stroke="currentColor" strokeWidth="1" opacity=".38" /><path className={styles.heartBeat} d="M9 17h3l1.5-3 2.1 6 1.9-4H23" stroke="currentColor" strokeWidth="1.45" strokeLinecap="round" strokeLinejoin="round" /><path d="M16 23s-6-3.55-6-7.2a3.2 3.2 0 0 1 5.5-2.2l.5.55.5-.55a3.2 3.2 0 0 1 5.5 2.2C22 19.45 16 23 16 23Z" stroke="currentColor" strokeWidth="1.15" /></>;
}
function Steam() {
  return <><circle cx="16" cy="16" r="11.5" stroke="currentColor" strokeWidth="1" opacity=".38" /><path d="M9.5 18.5h13l-1.1 4H10.6zM11 22.5h10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /><path className={styles.steam} d="M12.5 16c-1.6-1.7 1.2-2.6 0-4.2M16 16c-1.6-1.7 1.2-2.6 0-4.2M19.5 16c-1.6-1.7 1.2-2.6 0-4.2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" /></>;
}
function Compass() {
  return <><circle cx="16" cy="16" r="11.5" stroke="currentColor" strokeWidth="1" opacity=".38" /><circle cx="16" cy="16" r="6.7" stroke="currentColor" strokeWidth="1.25" /><path className={styles.compassNeedle} d="m18.9 13.1-1.7 4-4 1.7 1.7-4z" fill="currentColor" /><path d="M16 7.5v2m0 13v2M7.5 16h2m13 0h2" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" /></>;
}
function Clapper() {
  return <><circle cx="16" cy="16" r="11.5" stroke="currentColor" strokeWidth="1" opacity=".38" /><path d="M9.5 14.2h13v8.3h-13zM9 11.5h13.6l-1.1 2.7H10.1z" stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round" /><path className={styles.clapperArm} d="m11 11.5 2 2.7m2.1-2.7 2 2.7m2.1-2.7 2 2.7" stroke="currentColor" strokeWidth="1.15" strokeLinecap="round" /></>;
}
function Mind() {
  return <><circle cx="16" cy="16" r="11.5" stroke="currentColor" strokeWidth="1" opacity=".38" /><path d="M11 18.5c-2-3.4.1-7.3 3.2-6.3.9-2.2 4.5-2.2 5.4.2 3.3-.3 4.3 3.9 2.2 5.8.3 2.7-2.9 4.5-5 3.1-2.7 1.4-5.9-.5-5.1-2.8Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" /><path className={styles.mindWave} d="M12.2 17.2c1.1-1.3 2.3 1.4 3.4 0 1.1-1.3 2.3 1.4 3.4 0" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" /></>;
}
function Casefile() {
  return <><circle cx="16" cy="16" r="11.5" stroke="currentColor" strokeWidth="1" opacity=".38" /><path d="M10 11h12v11H10zM13 9.5h6v2h-6zM13 15h6m-6 3h4" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" /><circle className={styles.caseDot} cx="20" cy="20" r="2.3" fill="currentColor" /></>;
}
function Book() {
  return <><circle cx="16" cy="16" r="11.5" stroke="currentColor" strokeWidth="1" opacity=".38" /><path className={styles.bookLeft} d="M16 12.2c-2.2-1.6-4.5-1.4-6.4-.2v8.4c1.9-1.2 4.2-1.3 6.4.2" stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round" /><path className={styles.bookRight} d="M16 12.2c2.2-1.6 4.5-1.4 6.4-.2v8.4c-1.9-1.2-4.2-1.3-6.4.2" stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round" /><path className={styles.bookLine} d="M12 15.3h2.4m3.2 0H20m-8 2.4h2.4m3.2 0H20" stroke="currentColor" strokeWidth=".95" strokeLinecap="round" /></>;
}
function Pen() {
  return <><circle cx="16" cy="16" r="11.5" stroke="currentColor" strokeWidth="1" opacity=".38" /><path d="m11 20.8 1-3 7.4-7.4 2 2-7.4 7.4zM18.8 11.2l2 2" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" /><path className={styles.penLine} d="M10 23c2.7-1.4 5.6-.4 7.7-1.6 1.8-1.1 2.5-3.3 4.3-4" stroke="currentColor" strokeWidth="1.15" strokeLinecap="round" /></>;
}
function Summit() {
  return <><circle cx="16" cy="16" r="11.5" stroke="currentColor" strokeWidth="1" opacity=".38" /><path d="m9.5 21 5.1-8 2.6 4.1 1.7-2.4 3.2 6.3z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" /><path className={styles.summitArrow} d="M13 11.5h6m-2.2-2.2 2.2 2.2-2.2 2.2" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" /></>;
}
function Health() {
  return <><circle cx="16" cy="16" r="11.5" stroke="currentColor" strokeWidth="1" opacity=".38" /><path d="M16 10v12M10 16h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /><circle className={styles.healthRing} cx="16" cy="16" r="7.2" stroke="currentColor" strokeWidth="1" opacity=".6" /></>;
}
function Business() {
  return <><circle cx="16" cy="16" r="11.5" stroke="currentColor" strokeWidth="1" opacity=".38" /><path d="M9.5 21.5h13M11 19v-4m5 4V11m5 8v-5" stroke="currentColor" strokeWidth="1.55" strokeLinecap="round" /><path className={styles.businessArrow} d="m11 13 4-3 2.5 1.8L21 8.5" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" /></>;
}
