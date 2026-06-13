import type { CSSProperties, ReactNode } from "react";
import { GOLDEN_MODULES, GOLDEN_SPINE, type GoldenModule } from "@/engine/golden";
import { PageHeader, SectionTitle } from "@/components/PageHeader";

/**
 * Real banana-engine output (public/golden/*.jpg, downscaled) — every one a
 * first-try judge-gated SHIP across wildly different channel identities.
 * Fanned out on the golden hero card as the quality proof.
 */
const PROOFS: { src: string; alt: string }[] = [
  { src: "drawn.jpg", alt: "The Drawn Past — The Dancing Plague" },
  { src: "samurai.jpg", alt: "Steel & Silk — Kyoto Burns" },
  { src: "stoic_anger.jpg", alt: "The Quiet Stoic — Anger Is Weakness" },
  { src: "stoic_still.jpg", alt: "The Quiet Stoic — Stillness Is Power" },
  { src: "stoic_memento.jpg", alt: "The Quiet Stoic — Remember You Must Die" },
  { src: "hannibal.jpg", alt: "Empires at War — Hannibal" },
  { src: "scandal.jpg", alt: "Spotlight Rot — tabloid collage" },
  { src: "rich.jpg", alt: "Gilded Lies — evil." },
];

/**
 * Real cinecraft output — the SAME generated character across four cinematic
 * shots (vision-scored 10/10 consistency via the hero-image anchor), fanned on
 * the Cinematic golden card.
 */
const CINEMATIC_PROOFS: { src: string; alt: string }[] = [
  { src: "cinematic/cash.jpg", alt: "Victor Lustig — counting the cash (1925 hotel suite)" },
  { src: "cinematic/handshake.jpg", alt: "Victor Lustig — the handshake" },
  { src: "cinematic/corridor.jpg", alt: "Victor Lustig — walking out" },
  { src: "cinematic/taxi.jpg", alt: "Victor Lustig — the taxi smile" },
];

/**
 * Real scriptcraft output — judge-gated, fact-checked cold opens and quotes
 * from the certification runs, fanned on the Script + Hook golden card.
 */
const SCRIPT_PROOFS: { device: string; channel: string; line: string; note: string }[] = [
  {
    device: "myth_snap",
    channel: "Empires at War",
    line: "The Roman Empire did not fall in a fiery, apocalyptic battle. It bled out over two hundred years of self-inflicted wounds.",
    note: "facts search-verified",
  },
  {
    device: "countdown",
    channel: "Empires at War",
    line: "It is fifteen days until the winter snows seal the Alpine passes forever. Hannibal Barca has thirty-seven elephants, forty-thousand men, and no supply lines.",
    note: "specificity 10 · curiosity 10",
  },
  {
    device: "cold_open_scene",
    channel: "The Drawn Past",
    line: "Frau Troffea steps into a narrow Strasbourg street and begins to twitch. She will not stop for six days.",
    note: "7/7 claims verified",
  },
  {
    device: "receipt",
    channel: "Spotlight Rot",
    line: "One paparazzi photo of a shaved head in 2007 generated five hundred thousand dollars in a single hour.",
    note: "chaos-commentator voice",
  },
  {
    device: "cold_open_scene",
    channel: "Gilded Lies",
    line: "In July 2019, workers at the Louvre quietly unbolted the Sackler name from the walls.",
    note: "judged 10 · 10 · 10 · 10",
  },
  {
    device: "the quote",
    channel: "Seven Quiet Days",
    line: "“Familiarity breeds invisibility. Today, give someone the gift of being seen.”",
    note: "episode takeaway artifact",
  },
];

/**
 * Real metacraft output — autocomplete + real-feed grounded, claims-linted,
 * judge-gated titles from the certification duel (8-9/10 on click AND
 * directness), fanned on the SEO Metadata golden card.
 */
const META_PROOFS: { device: string; channel: string; line: string; note: string }[] = [
  { device: "direct_verdict", channel: "The Quiet Stoic", line: "Anger is the ultimate form of self-destruction.", note: "click 9 · direct 9" },
  { device: "contrarian", channel: "Empires at War", line: "Barbarian Hordes Did Not Destroy the Roman Empire", note: "claims grounded in the fact-checked script" },
  { device: "contrarian", channel: "Steel & Silk", line: "Japan's Deadliest War Started Over Nothing", note: "judged vs 10 real competitor titles" },
  { device: "direct_verdict", channel: "The Drawn Past", line: "Strasbourg's medical cure killed the dancers", note: "real-feed evidence · avg 48 chars" },
  { device: "direct_verdict", channel: "Spotlight Rot", line: "Every public downfall is a manufactured PR extraction", note: "click 9 · chaos register" },
  { device: "direct_verdict", channel: "The Takeover Log", line: "The AI takeover is a corporate restructuring.", note: "runner-up stored for CTR swap" },
];

/**
 * Real topicraft output — evidence-cited, judge-gated BETS from the
 * certification A/B (legacy engine vs craftTopics across five synthetic
 * channels, run with YouTube quota dead — autocomplete alone still grounded
 * every bet). Fanned on the Topic Intel golden card.
 */
const TOPIC_PROOFS: { device: string; channel: string; line: string; note: string }[] = [
  { device: "hero · search", channel: "War Annals: East", line: "The real history behind a Battle of Red Cliffs movie", note: "demand 9 · rides \"battle of red cliffs movie\"" },
  { device: "help · search", channel: "Cutaway Critique", line: "Why Davy Jones CGI still beats modern VFX", note: "demand 9 · rides \"davy jones cgi\"" },
  { device: "help · search", channel: "Plain Money", line: "The real difference between index funds vs ETFs", note: "rides the verbatim query people type" },
  { device: "hero · search", channel: "Antiquity Files", line: "Eric Cline's perfect storm that ended the Bronze Age", note: "demand 9 · rides \"bronze age collapse eric cline\"" },
  { device: "help · search", channel: "The Quiet Stoa", line: "Marcus Aurelius advice for mornings you dread", note: "demand 8 · fit 9 · ships title + thumb + hook" },
  { device: "hub · identity", channel: "The Quiet Stoa", line: "Detaching from the opinions of others", note: "fresh 9 · second-slate accumulate, zero repeats" },
];

/**
 * Real voicecraft output — the certification clips (same scripts the operator
 * approved): cast by law from the profiled bank, physics-tuned, judged by
 * ears AND code. Played inline on the Narration golden card.
 */
const VOICE_PROOFS: { file: string; device: string; meta: string }[] = [
  { file: "stoic.mp3", device: "quiet-mentor · 0.95x", meta: "Brian — deep resonant neutral-US · accent is casting LAW" },
  { file: "meditation.mp3", device: "gentle-guide · 0.85x", meta: "Autumn Veil — calm mature female · performed breaths" },
  { file: "social.mp3", device: "chaos-commentator · 1.15x", meta: "Jessica — young female · rich performed tags" },
  { file: "finance.mp3", device: "teacher-advisor · 1.1x", meta: "Bill — wise mature male · judged 9/10 cast" },
  { file: "history.mp3", device: "narrator-teacher · 1.0x", meta: "George — warm storyteller · cold-open gated" },
];

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

      {hero && m.key === "thumbnail" && (
        <>
          <div className="golden-fan">
            {PROOFS.map((p, i) => {
              const off = i - (PROOFS.length - 1) / 2;
              return (
                // eslint-disable-next-line @next/next/no-img-element -- static proof strip, no optimization needed
                <img
                  key={p.src}
                  src={`/golden/${p.src}`}
                  alt={p.alt}
                  title={p.alt}
                  loading="lazy"
                  className="golden-fan-item"
                  style={
                    {
                      "--rot": `${off * 4}deg`,
                      "--ty": `${Math.round(off * off * 3.2)}px`,
                      zIndex: i + 1,
                    } as CSSProperties
                  }
                />
              );
            })}
          </div>
          <FanCaption>real engine output — eight channels, every render a first-try judge-gated SHIP</FanCaption>
        </>
      )}

      {hero && m.key === "script" && (
        <>
          <div className="golden-fan">
            {SCRIPT_PROOFS.map((p, i) => {
              const off = i - (SCRIPT_PROOFS.length - 1) / 2;
              return (
                <div
                  key={`${p.channel}-${i}`}
                  className="golden-fan-item golden-fan-card"
                  title={`${p.channel} — ${p.note}`}
                  style={
                    {
                      "--rot": `${off * 4}deg`,
                      "--ty": `${Math.round(off * off * 3.2)}px`,
                      zIndex: i + 1,
                    } as CSSProperties
                  }
                >
                  <span className="golden-fan-card-device">{p.device}</span>
                  <span className="golden-fan-card-line">{p.line}</span>
                  <span className="golden-fan-card-meta">
                    {p.channel} · {p.note}
                  </span>
                </div>
              );
            })}
          </div>
          <FanCaption>real engine output — judge-gated cold opens, claims search-verified before they ship</FanCaption>
        </>
      )}

      {hero && m.key === "metadata" && (
        <>
          <div className="golden-fan">
            {META_PROOFS.map((p, i) => {
              const off = i - (META_PROOFS.length - 1) / 2;
              return (
                <div
                  key={`${p.channel}-${i}`}
                  className="golden-fan-item golden-fan-card"
                  title={`${p.channel} — ${p.note}`}
                  style={
                    {
                      "--rot": `${off * 4}deg`,
                      "--ty": `${Math.round(off * off * 3.2)}px`,
                      zIndex: i + 1,
                    } as CSSProperties
                  }
                >
                  <span className="golden-fan-card-device">{p.device}</span>
                  <span className="golden-fan-card-line">{p.line}</span>
                  <span className="golden-fan-card-meta">
                    {p.channel} · {p.note}
                  </span>
                </div>
              );
            })}
          </div>
          <FanCaption>real engine output — titles grounded in live search + the real feed, gated on click and directness</FanCaption>
        </>
      )}

      {hero && m.key === "topic-intel" && (
        <>
          <div className="golden-fan">
            {TOPIC_PROOFS.map((p, i) => {
              const off = i - (TOPIC_PROOFS.length - 1) / 2;
              return (
                <div
                  key={`${p.channel}-${i}`}
                  className="golden-fan-item golden-fan-card"
                  title={`${p.channel} — ${p.note}`}
                  style={
                    {
                      "--rot": `${off * 4}deg`,
                      "--ty": `${Math.round(off * off * 3.2)}px`,
                      zIndex: i + 1,
                    } as CSSProperties
                  }
                >
                  <span className="golden-fan-card-device">{p.device}</span>
                  <span className="golden-fan-card-line">{p.line}</span>
                  <span className="golden-fan-card-meta">
                    {p.channel} · {p.note}
                  </span>
                </div>
              );
            })}
          </div>
          <FanCaption>real engine output — every topic is a bet citing the live signal it rides, judged on demand · freshness · fit · packageability</FanCaption>
        </>
      )}

      {hero && m.key === "narration" && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "0.6rem", marginTop: "0.8rem" }}>
            {VOICE_PROOFS.map((p) => (
              <div key={p.file} className="golden-fan-card" style={{ position: "static", transform: "none" }}>
                <span className="golden-fan-card-device">{p.device}</span>
                {/* eslint-disable-next-line jsx-a11y/media-has-caption -- narration proof clips */}
                <audio controls preload="none" src={`/golden/voice/${p.file}`} style={{ width: "100%", margin: "0.4rem 0" }} />
                <span className="golden-fan-card-meta">{p.meta}</span>
              </div>
            ))}
          </div>
          <FanCaption>real engine output — cast by law from the profiled voice bank, physics-tuned, judged by ears AND code</FanCaption>
        </>
      )}
      {hero && m.key === "cinematic" && (
        <>
          <div className="golden-fan">
            {CINEMATIC_PROOFS.map((p, i) => {
              const off = i - (CINEMATIC_PROOFS.length - 1) / 2;
              return (
                // eslint-disable-next-line @next/next/no-img-element -- static proof strip
                <img
                  key={p.src}
                  src={`/golden/${p.src}`}
                  alt={p.alt}
                  title={p.alt}
                  loading="lazy"
                  className="golden-fan-item"
                  style={
                    {
                      "--rot": `${off * 4}deg`,
                      "--ty": `${Math.round(off * off * 3.2)}px`,
                      zIndex: i + 1,
                    } as CSSProperties
                  }
                />
              );
            })}
          </div>
          <FanCaption>real engine output — the SAME generated character across four cinematic shots, hero-anchored, vision-scored 10/10</FanCaption>
        </>
      )}
    </article>
  );
}

function FanCaption({ children }: { children: ReactNode }) {
  return (
    <p
      style={{
        margin: "0.5rem 0 0",
        textAlign: "center",
        fontFamily: "var(--font-mono)",
        fontSize: "0.72rem",
        letterSpacing: "0.05em",
        color: "var(--color-faint)",
      }}
    >
      {children}
    </p>
  );
}
