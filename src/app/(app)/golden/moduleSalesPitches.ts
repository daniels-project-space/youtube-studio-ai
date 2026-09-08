export type ModuleSalesPitch = Readonly<{
  title: string;
  promise: string;
  bullets: readonly [string, string];
}>;

/**
 * Operator-facing copy is deliberately separate from the implementation
 * catalog. The Golden registry remains the full audit record; these compact
 * promises make the overview useful as a product surface instead of exposing
 * engineering prose on every collapsed card.
 */
export const MODULE_SALES_PITCHES: Readonly<Record<string, ModuleSalesPitch>> = Object.freeze({
  "channel-inception-research": {
    title: "Research Evidence",
    promise: "Find a channel angle worth building.",
    bullets: ["Real demand, not guesswork", "Evidence saved before creation"],
  },
  "channel-inception-positioning": {
    title: "Positioning & Style DNA",
    promise: "Turn a niche into a recognizable brand.",
    bullets: ["Distinct voice and visual DNA", "One repeatable show promise"],
  },
  "channel-inception-seo": {
    title: "SEO Foundation",
    promise: "Start with topics people already want.",
    bullets: ["Research-backed packaging", "Format-aware editorial playbook"],
  },
  "channel-inception-voice": {
    title: "Voice Casting",
    promise: "Cast a voice audiences remember.",
    bullets: ["Auditioned for the format", "Used by the real pipeline"],
  },
  "channel-inception-avatar": {
    title: "Channel Avatar",
    promise: "Be recognizable at a glance.",
    bullets: ["Clear at tiny sizes", "Protected once approved"],
  },
  "channel-inception-banner": {
    title: "Banner & Colors",
    promise: "Give every surface one visual world.",
    bullets: ["YouTube-safe composition", "Identity-matched color system"],
  },
  "channel-inception-thumbnails": {
    title: "Thumbnail System",
    promise: "Launch with a click-worthy visual system.",
    bullets: ["Channel-specific art direction", "Mobile-tested starter slate"],
  },
  "channel-inception-pipeline": {
    title: "Pipeline Compiler",
    promise: "Turn the format into a production line.",
    bullets: ["Family-native tools preserved", "Weak routes fail closed"],
  },
  "channel-inception-probe": {
    title: "Family Proof Run",
    promise: "Prove the channel before scaling spend.",
    bullets: ["One bounded test", "Private and receipt-backed"],
  },
  "channel-inception-readiness": {
    title: "Channel Readiness",
    promise: "Know exactly when a channel is ready.",
    bullets: ["Real receipts, not badges", "Source and live state separated"],
  },
  "episode-graph": {
    title: "Episode Graph",
    promise: "Make every scene earn the next.",
    bullets: ["Causal beat progression", "Continuity locked before render"],
  },
  "self-contained-story": {
    title: "Story Handoff",
    promise: "Lock the story before expensive rendering.",
    bullets: ["Critic-approved native plan", "Exact renderer binding"],
  },
  "casefile-documentary": {
    title: "Casefile Evidence",
    promise: "Build gripping investigations without losing the facts.",
    bullets: ["Primary-source claim trail", "Private editorial review"],
  },
  "casefile-evidence-shot-map": {
    title: "Evidence Shot Map",
    promise: "Turn every claim into a defensible shot.",
    bullets: ["Evidence attached on screen", "Recreations tightly controlled"],
  },
  "source-bound-story-spine": {
    title: "Source-Bound Spine",
    promise: "Keep evidence attached through every edit.",
    bullets: ["Timed claim coverage", "No generic b-roll drift"],
  },
  "editorial-evidence-packet": {
    title: "Editorial Evidence",
    promise: "One trusted factual core for every visual.",
    bullets: ["Immutable source snapshots", "Fresh reviewer approval"],
  },
  "cinematic-case-sequence": {
    title: "Cinematic Sequence",
    promise: "Turn evidence into premium cinematic momentum.",
    bullets: ["Purposeful multi-shot coverage", "Faceless identity continuity"],
  },
  "learning-contract": {
    title: "Learning Contract",
    promise: "Make every episode teach something measurable.",
    bullets: ["One clear objective", "Built-in recall practice"],
  },
  "children-show-bible": {
    title: "Children’s Show Bible",
    promise: "Build a show children can follow and learn from.",
    bullets: ["Age-fit participation", "Original world and characters"],
  },
  "scene-compiler": {
    title: "Scene Compiler",
    promise: "Turn approved plans into dependable illustration.",
    bullets: ["Deterministic visual output", "Audio and duration verified"],
  },
  "child-content-safety": {
    title: "Child Safety",
    promise: "Keep children’s content reviewed and age-fit.",
    bullets: ["Human approval required", "Stale receipts rejected"],
  },
  loreshort: {
    title: "Lore Short",
    promise: "Make lore feel cinematic in under a minute.",
    bullets: ["First-person story momentum", "World continuity preserved"],
  },
  "novita-render-farm": {
    title: "Novita Render Farm",
    promise: "Scale premium rendering without losing control.",
    bullets: ["Attested worker receipts", "Bounded recovery and spend"],
  },
  "imagecraft-novita": {
    title: "Imagecraft",
    promise: "Create production art with traceable outputs.",
    bullets: ["Direct Novita route", "Pixel and receipt checks"],
  },
  "videocraft-novita": {
    title: "Videocraft",
    promise: "Turn approved keyframes into cinematic motion.",
    bullets: ["Shot identity preserved", "Temporal defects rejected"],
  },
  lofi: {
    title: "Lofi Loop",
    promise: "Turn one beautiful scene into hours of atmosphere.",
    bullets: ["Seamless 30-second source", "Original long-form music"],
  },
  quiz: {
    title: "Quizcraft Concept",
    promise: "Preview the quiz experience before licensing it.",
    bullets: ["Design reference only", "No production claim"],
  },
  "quiz-year": {
    title: "Guess the Year",
    promise: "Make sourced facts feel like a game.",
    bullets: ["Wikidata-backed questions", "Answer integrity locked"],
  },
  "quiz-short-private-release": {
    title: "QuizShort Pilot",
    promise: "Cut vertical quiz pilots safely.",
    bullets: ["Private release only", "Exact portrait proof"],
  },
  thumbnail: {
    title: "Thumbnail Engine",
    promise: "Win the click before the video starts.",
    bullets: ["Channel-specific visual identity", "Native type, mobile tested"],
  },
  "package-opening-proof": {
    title: "Opening Match",
    promise: "Make the thumbnail promise match second one.",
    bullets: ["Cover-to-opening continuity", "Exact master evidence"],
  },
  "topic-intel": {
    title: "Topic Intel",
    promise: "Find ideas with proven audience pull.",
    bullets: ["Real outlier signals", "Freshness and fit scored"],
  },
  "serialized-program-episode-context": {
    title: "Series Continuity",
    promise: "Keep every episode inside the same story.",
    bullets: ["Atomic episode identity", "No stale continuity reuse"],
  },
  "narrative-series-visual-controls": {
    title: "Series Visual Controls",
    promise: "Keep recurring worlds visually consistent.",
    bullets: ["Characters stay recognizable", "Shots inherit approved rules"],
  },
  "show-bible": {
    title: "Show Bible & Crew",
    promise: "Give every specialist the same show.",
    bullets: ["One creative north star", "Role-specific direction"],
  },
  script: {
    title: "Script & Hook",
    promise: "Turn a topic into an irresistible story.",
    bullets: ["Payoff starts immediately", "Every section moves forward"],
  },
  guard: {
    title: "Guard Gates",
    promise: "Stop weak, copied, or unsafe work early.",
    bullets: ["Quality before spend", "Clear repair reasons"],
  },
  narration: {
    title: "Voicecraft",
    promise: "Give the channel a consistent human voice.",
    bullets: ["Identity-matched delivery", "Timing and mix verified"],
  },
  music: {
    title: "Scorecraft",
    promise: "Score the emotion without fighting the voice.",
    bullets: ["Beat-aware music direction", "Narration stays clear"],
  },
  visuals: {
    title: "Visual Direction",
    promise: "Match every beat with purposeful imagery.",
    bullets: ["Narration-led coverage", "No decorative filler"],
  },
  "studio-assets": {
    title: "Studio Assets",
    promise: "Reuse what works without making repeats.",
    bullets: ["Channel-scoped library", "Originality rules enforced"],
  },
  cinematic: {
    title: "Cinematic Reference",
    promise: "Study premium, identity-first scene design.",
    bullets: ["Reference treatment only", "Live successor is Visual Matter"],
  },
  documotion: {
    title: "Documotion",
    promise: "Turn facts into tactile moving archives.",
    bullets: ["Seven purposeful scene beats", "Every claim stays sourced"],
  },
  motioncraft: {
    title: "Motion Reference",
    promise: "Study motion that makes key moments land.",
    bullets: ["Reference media only", "Data inserts remain live"],
  },
  "speech-tv": {
    title: "Speechcraft Reference",
    promise: "Study a broadcast look built for motivation.",
    bullets: ["Word-synced motion design", "Production adapter not live"],
  },
  inserts: {
    title: "Data-Viz Inserts",
    promise: "Make spoken numbers instantly understandable.",
    bullets: ["Narration-synced charts", "Only verbatim figures"],
  },
  layer: {
    title: "Captions & Presentation",
    promise: "Keep every overlay beautifully aligned.",
    bullets: ["Word-accurate captions", "Channel-native styling"],
  },
  assemble: {
    title: "Assembly",
    promise: "Turn every asset into a clean final cut.",
    bullets: ["Validate before rendering", "Resume without double spend"],
  },
  metadata: {
    title: "SEO Metadata",
    promise: "Package the payoff for search and clicks.",
    bullets: ["Seven distinct title angles", "Claims stay script-grounded"],
  },
  verify: {
    title: "Artifact & Shot Gates",
    promise: "Catch broken shots before they become masters.",
    bullets: ["Lane-specific quality checks", "Bounded targeted repair"],
  },
  "final-master-story-coverage": {
    title: "Final-Master Proof",
    promise: "Prove the story survived the final render.",
    bullets: ["Every narration beat checked", "Certificate bound to master"],
  },
  whiteboard: {
    title: "Drawn Cinema",
    promise: "Make every idea draw itself on cue.",
    bullets: ["True timed ink reveals", "Nothing appears early"],
  },
  comic: {
    title: "Motion Comic",
    promise: "Turn narration into a living comic page.",
    bullets: ["Character continuity locked", "Bubbles never cover faces"],
  },
  ship: {
    title: "Safe Publishing",
    promise: "Move approved work to YouTube safely.",
    bullets: ["Private by default", "Owner controls release"],
  },
  "channel-planner": {
    title: "Week Planner",
    promise: "Prepare a full week before publish day.",
    bullets: ["Topics and thumbnails staged", "Schedule consumes exact plans"],
  },
  shorts: {
    title: "Vertical Shorts",
    promise: "Build fast stories that hold attention.",
    bullets: ["Native 9:16 production", "Hook, captions, payoff"],
  },
});

export function moduleSalesPitch(module: {
  key: string;
  title: string;
  how: string;
  gates: readonly string[];
}): ModuleSalesPitch {
  const authored = MODULE_SALES_PITCHES[module.key];
  if (authored) return authored;
  const cleanTitle = module.title.split(" — ")[0].trim();
  const cleanPromise = module.how.split(/\.\s/)[0].replace(/\s+/g, " ").trim();
  return {
    title: cleanTitle.slice(0, 42),
    promise: cleanPromise.length <= 64 ? cleanPromise : `${cleanPromise.slice(0, 61).trimEnd()}…`,
    bullets: [
      module.gates[0]?.slice(0, 40) || "Versioned production contract",
      module.gates[1]?.slice(0, 40) || "Evidence stays inspectable",
    ],
  };
}
