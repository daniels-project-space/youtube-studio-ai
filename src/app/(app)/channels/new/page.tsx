"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/PageHeader";
import { NICHES, getNiche } from "@/lib/nicheCatalog";
import { nichePreset } from "@/engine/golden";
import { FAMILIES, FAMILY_KEYS, FAMILY_CREW, CREW_ROLE_BLOCK, getFamily, type FamilyKey } from "@/engine/families";
import { ARCHETYPES } from "@/engine/archetypes";
import { MODULE_CATALOG, type ParamField } from "@/engine/moduleCatalog";
import { ModuleConfigSection, type ModuleConfigMap } from "@/components/ModuleConfigSection";

type Phase = "form" | "building" | "error";
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const BUILD_STEPS = ["Designing the pipeline…", "Synthesizing identity…", "Generating channel art…", "Finalizing…"];

interface Toggles { quotes: boolean; captions: boolean; chapters: boolean; refine: boolean; notify: boolean; crosspost: boolean; shorts: boolean }
const DEFAULT_TOGGLES: Toggles = { quotes: true, captions: true, chapters: true, refine: true, notify: true, crosspost: false, shorts: false };

// Client preview of the designed block list (mirrors src/engine/designer filter).
function previewBlocks(familyKey: FamilyKey, t: Toggles, nicheKey?: string): string[] {
  const fam = FAMILIES[familyKey];
  const base = ARCHETYPES[fam.archetypeKey]?.pipeline ?? [];
  let blocks = base
    .filter((e) => {
      if (e.block === "quote_overlays" && !t.quotes) return false;
      if (e.block === "captions" && !t.captions) return false;
      if (e.block === "qa_refine" && !t.refine) return false;
      if (e.block === "notify" && !t.notify) return false;
      return true;
    })
    .map((e) => e.block);
  // Film crew (default on) — mirror the designer: niche preset roster wins, else family.
  const crew = (nichePreset(nicheKey)?.crew ?? FAMILY_CREW[familyKey] ?? []).map((r) => CREW_ROLE_BLOCK[r]).filter(Boolean);
  if (crew.length) {
    const at = blocks.indexOf("topic_select");
    const i = at >= 0 ? at + 1 : 0;
    blocks = [...blocks.slice(0, i), ...crew, ...blocks.slice(i)];
  }
  if (t.crosspost) {
    const i = blocks.findIndex((b) => b === "notify" || b === "cleanup");
    blocks = i >= 0 ? [...blocks.slice(0, i), "crosspost", ...blocks.slice(i)] : [...blocks, "crosspost"];
  }
  // Shorts spinoff — only for narrated families with an upload step (mirrors designer).
  if (t.shorts && familyKey !== "music_loop" && blocks.includes("upload_draft") && blocks.includes("narration_tts")) {
    const i = blocks.findIndex((b) => b === "notify" || b === "cleanup");
    blocks = i >= 0 ? [...blocks.slice(0, i), "shorts_spinoff", ...blocks.slice(i)] : [...blocks, "shorts_spinoff"];
  }
  return blocks;
}

export default function NewChannelWizard() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("form");
  const [step, setStep] = useState(0); // 0 niche, 1 format, 2 details, 3 review
  const [error, setError] = useState<string | null>(null);
  const [buildStep, setBuildStep] = useState(0);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // selections
  const [nicheKey, setNicheKey] = useState<string>("");
  const [subcategory, setSubcategory] = useState<string>("");
  const [family, setFamily] = useState<FamilyKey | "">("");
  const [name, setName] = useState("");
  const [clipUrl, setClipUrl] = useState("");
  const [lengthMinutes, setLengthMinutes] = useState(10);
  const [locale, setLocale] = useState("en");
  // Default = topic/DNA-matched footage; "nature" is an explicit opt-in (it
  // hard-locks the b-roll gate to serene nature/ruins — a stoic-channel look).
  const [footageTheme, setFootageTheme] = useState("");
  const [voiceFx, setVoiceFx] = useState("none");
  const [seriesTitle, setSeriesTitle] = useState("");
  const [seriesCount, setSeriesCount] = useState(0);
  const [cadence, setCadence] = useState("weekly");
  const [days, setDays] = useState<number[]>([1]);
  const [budget, setBudget] = useState(5);
  const [publishMode, setPublishMode] = useState("draft");
  const [autoYoutube, setAutoYoutube] = useState(true);
  const [toggles, setToggles] = useState<Toggles>(DEFAULT_TOGGLES);
  // Advanced per-module param editor: paramOverrides[blockId][key] = value.
  const [paramOverrides, setParamOverrides] = useState<Record<string, Record<string, unknown>>>({});
  const [showAdvanced, setShowAdvanced] = useState(false);
  // Pipeline style — per-module presets/knobs the new channel starts with
  // (validated server-side by channels.setModuleConfig in design-channel).
  const [moduleConfig, setModuleConfig] = useState<ModuleConfigMap>({});
  // example-clip analysis
  const [analyzing, setAnalyzing] = useState(false);
  const [clipNote, setClipNote] = useState<string | null>(null);
  const analyzeRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [concept, setConcept] = useState("");
  const [suggesting, setSuggesting] = useState(false);

  const niche = getNiche(nicheKey);
  const fam = family ? getFamily(family) : undefined;

  useEffect(() => {
    if (phase !== "building") return;
    const t = setInterval(() => setBuildStep((s) => (s + 1) % BUILD_STEPS.length), 2500);
    return () => clearInterval(t);
  }, [phase]);
  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); if (analyzeRef.current) clearInterval(analyzeRef.current); }, []);

  // pick niche → default its family + subcategory + research-tuned target length
  const pickNiche = (k: string) => {
    setNicheKey(k);
    const n = getNiche(k);
    if (n) { setFamily(n.defaultFamily); setSubcategory(n.subcategories[0]?.name ?? ""); }
    const preset = nichePreset(k);
    if (preset) setLengthMinutes(Math.min(60, Math.max(1, Math.round(preset.targetSeconds / 60))));
  };

  const preview = useMemo(() => (family ? previewBlocks(family, toggles, nicheKey) : []), [family, toggles, nicheKey]);

  // Describe the channel in words → suggest a format + crew (operator confirms).
  function suggest() {
    const c = concept.trim();
    if (!c || suggesting) return;
    setSuggesting(true); setClipNote(null);
    (async () => {
      try {
        const res = await fetch("/api/suggest-format", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ concept: c, niche: nicheKey || undefined }) });
        const d = await res.json();
        if (!res.ok || !d.family) { setClipNote(d.error ?? "Could not suggest a format."); setSuggesting(false); return; }
        setFamily(d.family as FamilyKey);
        const fam = FAMILIES[d.family as FamilyKey]?.label ?? d.family;
        const alts = Array.isArray(d.alternates) && d.alternates.length
          ? ` Alternates: ${d.alternates.map((a: { family: string }) => FAMILIES[a.family as FamilyKey]?.label ?? a.family).join(", ")}.`
          : "";
        setClipNote(`Suggested format: ${fam}${d.available ? "" : " (draft — engine not built yet)"} · crew: ${(d.crew ?? []).join(", ")}. ${d.reasoning ?? ""}${alts}`);
      } catch {
        setClipNote("Suggestion failed — pick a format manually below.");
      } finally {
        setSuggesting(false);
      }
    })();
  }

  // Analyze a pasted example clip → suggest a family + style (operator confirms).
  function analyze() {
    const u = clipUrl.trim();
    if (!u || analyzing) return;
    setAnalyzing(true); setClipNote(null);
    (async () => {
      try {
        const res = await fetch("/api/analyze-clip", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: u }) });
        const d = await res.json();
        if (!res.ok || !d.id) { setClipNote(d.error ?? "Could not start analysis."); setAnalyzing(false); return; }
        if (analyzeRef.current) clearInterval(analyzeRef.current);
        analyzeRef.current = setInterval(async () => {
          try {
            const r = await fetch(`/api/analyze-clip?id=${encodeURIComponent(d.id)}`);
            const j = await r.json();
            if (j.status === "COMPLETED" && j.output?.analysis) {
              if (analyzeRef.current) clearInterval(analyzeRef.current);
              const a = j.output.analysis;
              if (a.couldAnalyze === false) {
                setClipNote("Couldn't analyze this clip (live stream, private, or unavailable) — pick a format manually below.");
                setAnalyzing(false);
                return;
              }
              if (a.recommendedFamily) setFamily(a.recommendedFamily);
              if (a.recommendedNicheKey) { setNicheKey(a.recommendedNicheKey); }
              if (a.recommendedFootageTheme) setFootageTheme(a.recommendedFootageTheme);
              if (typeof a.approxLengthSec === "number" && a.approxLengthSec > 0) setLengthMinutes(Math.max(1, Math.round(a.approxLengthSec / 60)));
              setToggles((p) => ({ ...p, quotes: !!a.hasNarration && p.quotes, captions: !!a.hasNarration && p.captions, chapters: !!a.hasNarration && p.chapters }));
              setClipNote(`Detected: ${a.visualStyle || "?"} · ${a.hasNarration ? "narrated" : "no narration"} · music ${a.musicRole}. Suggested format: ${FAMILIES[a.recommendedFamily as FamilyKey]?.label ?? a.recommendedFamily}. ${a.notes ?? ""}`);
              setAnalyzing(false);
            } else if (["FAILED", "CRASHED", "CANCELED", "TIMED_OUT"].includes(j.status)) {
              if (analyzeRef.current) clearInterval(analyzeRef.current);
              setClipNote("Analysis failed (is the video public?). You can still pick a format manually.");
              setAnalyzing(false);
            }
          } catch { /* keep polling */ }
        }, 2500);
      } catch { setClipNote("Network error starting analysis."); setAnalyzing(false); }
    })();
  }

  async function create() {
    setPhase("building"); setError(null); setBuildStep(0);
    try {
      const res = await fetch("/api/build-channel", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ design: {
          nicheKey, subcategory, family, name: name.trim() || undefined,
          lengthMinutes: fam?.narrated ? lengthMinutes : undefined,
          locale, footageTheme: family === "narrated_stock" ? footageTheme : undefined,
          voiceFx: fam?.narrated && voiceFx !== "none" ? voiceFx : undefined,
          seriesTitle: seriesTitle.trim() || undefined,
          seriesCount: seriesTitle.trim() && seriesCount > 0 ? seriesCount : undefined,
          cadence, days, budget, publishMode, toggles, autoYoutube,
          paramOverrides: Object.keys(paramOverrides).length ? paramOverrides : undefined,
          moduleConfig: Object.keys(moduleConfig).length ? moduleConfig : undefined,
          exampleClipUrl: clipUrl.trim() || undefined,
        } }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Failed to start the builder."); setPhase("error"); return; }
      poll(data.id);
    } catch { setError("Network error starting the builder."); setPhase("error"); }
  }
  function poll(id: string) {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const r = await fetch(`/api/build-channel?id=${encodeURIComponent(id)}`);
        const d = await r.json();
        if (d.status === "COMPLETED" && d.output?.slug) {
          if (pollRef.current) clearInterval(pollRef.current);
          router.push(`/channels/${d.output.slug}`);
        } else if (["FAILED", "CRASHED", "CANCELED", "TIMED_OUT"].includes(d.status)) {
          if (pollRef.current) clearInterval(pollRef.current);
          setError((typeof d.error === "object" && d.error?.message) || `Build ${String(d.status).toLowerCase()}.`);
          setPhase("error");
        }
      } catch { /* keep polling */ }
    }, 2500);
  }

  if (phase === "building") {
    return (
      <>
        <PageHeader title="Building channel" />
        <div className="glass glass-shine" style={{ padding: "2.5rem", display: "grid", placeItems: "center", gap: "1rem" }}>
          <div className="studio-pulse" style={{ fontSize: "2rem" }}>✦</div>
          <div style={{ fontFamily: "var(--font-display)", fontSize: "1.2rem" }}>{name || niche?.label}</div>
          <div style={{ color: "var(--color-muted)", fontSize: "0.9rem" }}>{BUILD_STEPS[buildStep]}</div>
        </div>
      </>
    );
  }

  const canNext = step === 0 ? !!nicheKey : step === 1 ? !!family : true;
  const stepNames = ["Niche", "Format", "Details", "Review"];

  return (
    <>
      <PageHeader title="New channel" subtitle="Pick a niche, choose a format, tune the modules — the studio designs the pipeline." />

      {/* stepper */}
      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1.4rem", flexWrap: "wrap" }}>
        {stepNames.map((s, i) => (
          <div key={s} style={{ display: "flex", alignItems: "center", gap: "0.5rem", opacity: i === step ? 1 : 0.5 }}>
            <span style={{ width: 22, height: 22, borderRadius: 999, display: "grid", placeItems: "center", fontSize: "0.72rem", fontWeight: 700,
              background: i <= step ? "var(--color-accent)" : "var(--color-surface)", color: i <= step ? "#0a0a0b" : "var(--color-muted)" }}>{i + 1}</span>
            <span style={{ fontSize: "0.82rem", fontWeight: i === step ? 600 : 500 }}>{s}</span>
            {i < stepNames.length - 1 && <span style={{ color: "var(--color-faint)" }}>›</span>}
          </div>
        ))}
      </div>

      {error && <div className="glass" style={{ padding: "0.8rem 1rem", marginBottom: "1rem", border: "1px solid rgba(248,113,113,0.4)", color: "#fca5a5", fontSize: "0.85rem" }}>{error}</div>}

      {/* STEP 0 — niche */}
      {step === 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px,1fr))", gap: "0.8rem" }}>
          {NICHES.map((n) => {
            const on = n.key === nicheKey;
            return (
              <button key={n.key} onClick={() => pickNiche(n.key)} className="glass lift" style={{ textAlign: "left", padding: "1rem", cursor: "pointer",
                border: on ? "1px solid var(--color-accent)" : "1px solid var(--color-border)", background: on ? "rgba(124,124,255,0.08)" : undefined }}>
                <div style={{ fontSize: "1.5rem" }}>{n.icon}</div>
                <div style={{ fontWeight: 600, marginTop: "0.4rem" }}>{n.label}</div>
                <div style={{ display: "flex", gap: "0.4rem", margin: "0.4rem 0", fontSize: "0.72rem" }}>
                  <span style={{ color: "var(--color-ok)" }}>${n.rpm} RPM</span>
                  <span style={{ color: n.difficulty === "Easy" ? "var(--color-ok)" : n.difficulty === "Hard" ? "var(--color-failed)" : "var(--color-accent)" }}>{n.difficulty}</span>
                </div>
                <div style={{ fontSize: "0.76rem", color: "var(--color-muted)" }}>{n.blurb}</div>
              </button>
            );
          })}
          {niche && (
            <div className="glass" style={{ gridColumn: "1 / -1", padding: "1rem", display: "grid", gap: "0.5rem" }}>
              <span style={{ fontSize: "0.78rem", color: "var(--color-muted)" }}>Subcategory (est. monthly searches)</span>
              <select value={subcategory} onChange={(e) => setSubcategory(e.target.value)} style={selStyle}>
                {niche.subcategories.map((s) => <option key={s.id} value={s.name}>{s.name} — ~{s.searchVolume}K · ${(s.rpm ?? niche.rpm).toFixed(1)} RPM</option>)}
              </select>
            </div>
          )}
        </div>
      )}

      {/* STEP 1 — format */}
      {step === 1 && (
        <div style={{ display: "grid", gap: "0.8rem" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px,1fr))", gap: "0.8rem" }}>
            {FAMILY_KEYS.map((k) => {
              const f = FAMILIES[k]; const on = k === family;
              return (
                <button key={k} onClick={() => setFamily(k)} className="glass lift" style={{ textAlign: "left", padding: "1rem", cursor: "pointer",
                  border: on ? "1px solid var(--color-accent)" : "1px solid var(--color-border)", background: on ? "rgba(124,124,255,0.08)" : undefined }}>
                  <div style={{ fontWeight: 600 }}>{f.label}{!f.available && <span style={{ fontSize: "0.66rem", marginLeft: 6, color: "var(--color-accent)" }}>· in progress</span>}</div>
                  <div style={{ fontSize: "0.78rem", color: "var(--color-muted)", marginTop: "0.35rem" }}>{f.description}</div>
                </button>
              );
            })}
          </div>
          <label style={lblStyle}><span style={capStyle}>Channel name (optional — auto-generated if blank)</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Stoic Truths" style={inpStyle} /></label>
          <label style={lblStyle}><span style={capStyle}>Example clip URL (optional — Gemini analyzes it to match the style)</span>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <input value={clipUrl} onChange={(e) => setClipUrl(e.target.value)} placeholder="paste a YouTube link you like" style={{ ...inpStyle, flex: 1 }} />
              <button onClick={analyze} disabled={!clipUrl.trim() || analyzing} style={{ ...btnGhost, opacity: !clipUrl.trim() || analyzing ? 0.5 : 1, whiteSpace: "nowrap" }}>{analyzing ? "Analyzing…" : "Analyze"}</button>
            </div>
          </label>
          <label style={lblStyle}><span style={capStyle}>Or describe the channel in words (Gemini suggests a format + the crew it needs)</span>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <input value={concept} onChange={(e) => setConcept(e.target.value)} placeholder="e.g. calm daily stoicism lessons over cinematic nature b-roll" style={{ ...inpStyle, flex: 1 }} />
              <button onClick={suggest} disabled={!concept.trim() || suggesting} style={{ ...btnGhost, opacity: !concept.trim() || suggesting ? 0.5 : 1, whiteSpace: "nowrap" }}>{suggesting ? "Thinking…" : "Suggest"}</button>
            </div>
          </label>
          {clipNote && <div className="glass" style={{ padding: "0.7rem 0.9rem", fontSize: "0.8rem", color: "var(--color-muted)", border: "1px solid var(--color-accent)" }}>{clipNote}</div>}
        </div>
      )}

      {/* STEP 2 — details */}
      {step === 2 && (
        <div style={{ display: "grid", gap: "1rem", maxWidth: 720 }}>
          <div className="glass" style={{ padding: "1rem", display: "grid", gap: "0.9rem" }}>
            {fam?.narrated && (
              <Row label="Target length"><input type="number" min={1} max={60} value={lengthMinutes} onChange={(e) => setLengthMinutes(+e.target.value)} style={{ ...inpStyle, width: 90 }} /> <span style={muted}>min</span></Row>
            )}
            <Row label="Language"><select value={locale} onChange={(e) => setLocale(e.target.value)} style={selStyle}><option value="en">English</option><option value="es">Spanish</option><option value="de">German</option></select></Row>
            {family === "narrated_stock" && (
              <Row label="Footage theme"><select value={footageTheme} onChange={(e) => setFootageTheme(e.target.value)} style={selStyle}><option value="">Topic-matched (channel DNA)</option><option value="nature">Nature / landscapes / ruins</option></select></Row>
            )}
            {fam?.narrated && (
              <Row label="Voice effect"><select value={voiceFx} onChange={(e) => setVoiceFx(e.target.value)} style={selStyle}><option value="none">None (clean)</option><option value="radio">Old radio (vintage AM)</option></select></Row>
            )}
            <Row label="Series (optional)">
              <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", flexWrap: "wrap", justifyContent: "flex-end" }}>
                <input value={seriesTitle} onChange={(e) => setSeriesTitle(e.target.value)} placeholder='e.g. "7 Days of Stoic Calm"' style={{ ...inpStyle, width: 220 }} />
                {seriesTitle.trim() && <>
                  <input type="number" min={0} max={100} value={seriesCount} onChange={(e) => setSeriesCount(+e.target.value)} style={{ ...inpStyle, width: 70 }} />
                  <span style={muted}>parts (0 = open)</span>
                </>}
              </div>
            </Row>
            <Row label="Cadence"><select value={cadence} onChange={(e) => setCadence(e.target.value)} style={selStyle}><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="biweekly">Every 2 weeks</option><option value="monthly">Monthly</option></select></Row>
            {(cadence === "weekly" || cadence === "biweekly") && (
              <Row label="Upload days">
                <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                  {DOW.map((d, i) => { const on = days.includes(i); return (
                    <button key={i} onClick={() => setDays((p) => on ? p.filter((x) => x !== i) : [...p, i].sort())} style={{ width: 34, height: 30, borderRadius: 7, cursor: "pointer", fontSize: "0.72rem", fontWeight: 600,
                      border: `1px solid ${on ? "var(--color-accent)" : "var(--color-border)"}`, background: on ? "var(--color-accent)" : "var(--color-surface)", color: on ? "#0a0a0b" : "var(--color-muted)" }}>{d[0]}</button>); })}
                </div>
              </Row>
            )}
            <Row label="Auto-publish"><select value={publishMode} onChange={(e) => setPublishMode(e.target.value)} style={selStyle}><option value="draft">Private draft</option><option value="scheduled">Scheduled</option><option value="public">Public</option></select></Row>
            <Row label="Auto-create YouTube channel">
              <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.84rem", cursor: "pointer" }}>
                <input type="checkbox" checked={autoYoutube} onChange={(e) => setAutoYoutube(e.target.checked)} />
                <span style={muted}>create + link a YouTube channel via the cloud agent</span>
              </label>
            </Row>
            <Row label="Budget / run"><input type="number" min={0} step={0.5} value={budget} onChange={(e) => setBudget(+e.target.value)} style={{ ...inpStyle, width: 90 }} /> <span style={muted}>USD</span></Row>
          </div>
          <div className="glass" style={{ padding: "1rem", display: "grid", gap: "0.6rem" }}>
            <div style={{ fontSize: "0.8rem", fontWeight: 600 }}>Advanced — optional modules</div>
            {([["quotes", "Quote cards"], ["captions", "Burned captions"], ["chapters", "Chapter cards"], ["refine", "AI refine pass"], ["notify", "Telegram notify"], ["crosspost", "Cross-post (TikTok/Reels)"], ["shorts", "Auto Short (9:16, private)"]] as [keyof Toggles, string][]).map(([k, lbl]) => (
              <label key={k} style={{ display: "flex", alignItems: "center", gap: "0.6rem", fontSize: "0.84rem", cursor: "pointer" }}>
                <input type="checkbox" checked={toggles[k]} onChange={(e) => setToggles((p) => ({ ...p, [k]: e.target.checked }))} /> {lbl}
              </label>
            ))}
          </div>
        </div>
      )}

      {/* STEP 3 — review */}
      {step === 3 && fam && (
        <div style={{ display: "grid", gap: "1rem", maxWidth: 760 }}>
          {!fam.available && <div className="glass" style={{ padding: "0.8rem 1rem", border: "1px solid rgba(245,158,11,0.45)", color: "#fbbf24", fontSize: "0.84rem" }}>⚠ {fam.label}: visual engine "{fam.visualEngine}" not built yet — channel will be created as a DRAFT until it ships.</div>}
          <div className="glass" style={{ padding: "1.1rem 1.2rem", display: "grid", gap: "0.5rem", fontSize: "0.86rem" }}>
            <SummaryRow k="Niche" v={`${niche?.label}${subcategory ? " · " + subcategory : ""}`} />
            <SummaryRow k="Format" v={fam.label} />
            <SummaryRow k="Visual engine" v={fam.visualEngine} />
            {fam.narrated && <SummaryRow k="Length / language" v={`~${lengthMinutes} min · ${locale.toUpperCase()}`} />}
            {fam.narrated && voiceFx !== "none" && <SummaryRow k="Voice effect" v={voiceFx === "radio" ? "Old radio" : voiceFx} />}
            {seriesTitle.trim() && <SummaryRow k="Series" v={`${seriesTitle.trim()}${seriesCount > 0 ? ` · ${seriesCount} parts` : " · open-ended"}`} />}
            <SummaryRow k="Cadence" v={`${cadence}${(cadence === "weekly" || cadence === "biweekly") && days.length ? " · " + days.map((d) => DOW[d]).join(",") : ""} · ${publishMode}`} />
          </div>
          <div className="glass" style={{ padding: "1.1rem 1.2rem" }}>
            <div style={{ fontSize: "0.8rem", fontWeight: 600, marginBottom: "0.6rem" }}>Designed pipeline ({preview.length} modules)</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.3rem" }}>
              {preview.map((b, i) => (
                <span key={b + i} style={{ fontSize: "0.7rem", padding: "0.2rem 0.5rem", borderRadius: 6, background: "var(--color-surface)", border: "1px solid var(--color-border)", color: "var(--color-muted)" }}>{b}</span>
              ))}
            </div>
          </div>

          {/* Advanced per-module param editor — tune any module's knobs. */}
          <div className="glass" style={{ padding: "1.1rem 1.2rem", display: "grid", gap: "0.8rem" }}>
            <button onClick={() => setShowAdvanced((s) => !s)} style={{ display: "flex", alignItems: "center", gap: "0.5rem", background: "none", border: "none", color: "var(--color-fg)", cursor: "pointer", font: "inherit", fontSize: "0.8rem", fontWeight: 600, padding: 0 }}>
              <span style={{ transform: showAdvanced ? "rotate(90deg)" : "none", transition: "transform 0.15s" }}>›</span>
              Advanced — tune module parameters
              {Object.keys(paramOverrides).length > 0 && <span style={{ fontSize: "0.66rem", color: "var(--color-accent)" }}>· {Object.keys(paramOverrides).length} edited</span>}
            </button>
            {showAdvanced && (
              <div style={{ display: "grid", gap: "0.9rem" }}>
                {MODULE_CATALOG.filter((m) => preview.includes(m.block)).map((m) => (
                  <div key={m.block} style={{ display: "grid", gap: "0.5rem", paddingBottom: "0.7rem", borderBottom: "1px solid var(--color-border)" }}>
                    <div style={{ display: "flex", alignItems: "baseline", gap: "0.5rem" }}>
                      <span style={{ fontSize: "0.82rem", fontWeight: 600 }}>{m.label}</span>
                      {m.optional && <span style={{ fontSize: "0.62rem", color: "var(--color-accent)" }}>optional</span>}
                      <span style={{ fontSize: "0.72rem", color: "var(--color-muted)" }}>{m.description}</span>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: "0.5rem 1rem" }}>
                      {m.params.map((f) => (
                        <ParamControl key={f.key} field={f}
                          value={paramOverrides[m.block]?.[f.key]}
                          onChange={(v) => setParamOverrides((p) => {
                            const block = { ...(p[m.block] ?? {}) };
                            if (v === "" || v === undefined || v === null) delete block[f.key]; else block[f.key] = v;
                            const next = { ...p };
                            if (Object.keys(block).length) next[m.block] = block; else delete next[m.block];
                            return next;
                          })} />
                      ))}
                    </div>
                  </div>
                ))}
                <div style={{ fontSize: "0.72rem", color: "var(--color-faint)" }}>Blank fields keep the smart default. Numbers are clamped to safe bounds on save.</div>
              </div>
            )}
          </div>

          {/* Pipeline style — per-module presets/knobs (e.g. captions on/off). */}
          <div className="glass" style={{ padding: "1.1rem 1.2rem", display: "grid", gap: "0.85rem" }}>
            <div>
              <div style={{ fontSize: "0.8rem", fontWeight: 600 }}>Pipeline style</div>
              <div style={{ fontSize: "0.72rem", color: "var(--color-muted)", marginTop: 2 }}>
                Pick a preset per module and flip toggles — wired into every render. Editable later in Settings.
              </div>
            </div>
            <ModuleConfigSection value={moduleConfig} onChange={setModuleConfig} />
          </div>
        </div>
      )}

      {/* nav */}
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: "1.6rem", maxWidth: 760 }}>
        <button onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0} style={{ ...btnGhost, opacity: step === 0 ? 0.4 : 1 }}>Back</button>
        {step < 3
          ? <button onClick={() => canNext && setStep((s) => s + 1)} disabled={!canNext} style={{ ...btnPrimary, opacity: canNext ? 1 : 0.5 }}>Next</button>
          : <button onClick={create} style={btnPrimary}>Create channel</button>}
      </div>
    </>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}>
    <span style={{ fontSize: "0.84rem", fontWeight: 500 }}>{label}</span><div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>{children}</div></div>;
}
function ParamControl({ field, value, onChange }: { field: ParamField; value: unknown; onChange: (v: unknown) => void }) {
  const label = <span style={{ fontSize: "0.74rem", color: "var(--color-muted)" }}>{field.label}</span>;
  if (field.type === "toggle") {
    return (
      <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.78rem", cursor: "pointer" }} title={field.help}>
        <input type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked ? true : undefined)} />
        {field.label}
      </label>
    );
  }
  if (field.type === "select") {
    return (
      <label style={{ display: "grid", gap: "0.25rem" }} title={field.help}>
        {label}
        <select value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value || undefined)} style={{ ...selStyle, fontSize: "0.8rem", padding: "0.4rem 0.55rem" }}>
          <option value="">Default</option>
          {field.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </label>
    );
  }
  if (field.type === "number") {
    return (
      <label style={{ display: "grid", gap: "0.25rem" }} title={field.help}>
        {label}
        <input type="number" min={field.min} max={field.max} step={field.step}
          value={value === undefined || value === null ? "" : (value as number)}
          placeholder="default"
          onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))}
          style={{ ...inpStyle, fontSize: "0.8rem", padding: "0.4rem 0.55rem" }} />
      </label>
    );
  }
  return (
    <label style={{ display: "grid", gap: "0.25rem" }} title={field.help}>
      {label}
      <input value={(value as string) ?? ""} placeholder="default"
        onChange={(e) => onChange(e.target.value || undefined)}
        style={{ ...inpStyle, fontSize: "0.8rem", padding: "0.4rem 0.55rem" }} />
    </label>
  );
}
function SummaryRow({ k, v }: { k: string; v: string }) {
  return <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem" }}><span style={{ color: "var(--color-muted)" }}>{k}</span><span style={{ fontWeight: 500, textAlign: "right" }}>{v}</span></div>;
}

const inpStyle: CSSProperties = { padding: "0.6rem 0.8rem", borderRadius: 10, border: "1px solid var(--color-border)", background: "var(--color-surface)", color: "var(--color-fg)", font: "inherit", fontSize: "0.9rem" };
const selStyle: CSSProperties = { ...inpStyle, cursor: "pointer" };
const lblStyle: CSSProperties = { display: "grid", gap: "0.4rem" };
const capStyle: CSSProperties = { fontSize: "0.78rem", color: "var(--color-muted)" };
const muted: CSSProperties = { fontSize: "0.8rem", color: "var(--color-muted)" };
const btnPrimary: CSSProperties = { background: "var(--color-accent)", color: "#0a0a0b", border: "none", borderRadius: 10, padding: "0.6rem 1.4rem", fontSize: "0.9rem", fontWeight: 600, cursor: "pointer" };
const btnGhost: CSSProperties = { background: "var(--color-surface)", color: "var(--color-fg)", border: "1px solid var(--color-border)", borderRadius: 10, padding: "0.6rem 1.4rem", fontSize: "0.9rem", cursor: "pointer" };
