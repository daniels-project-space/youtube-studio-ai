// Standalone-module smoke test: drive the WHOLE synced whiteboard pipeline
// through src/lib/whiteboardSync.ts (one call) instead of the ad-hoc scripts.
import { join } from "node:path";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { generateNanoBananaProWhiteboardArtWithReceipt } from "../src/lib/banana.ts";
import { castWhiteboardSync } from "../src/lib/whiteboardSync.ts";

// This proof is intentionally Fal-only for Nano Banana Pro artwork. The
// caller injects only the two named secrets into this one child process; never
// hydrate the generic provider catalogue or a direct Google image credential.
for (const key of ["FAL_KEY", "ELEVENLABS_API_KEY"]) {
  if (!process.env[key]) throw new Error(`Whiteboard smoke requires ${key} from the scoped vault child process`);
}

// The production block receives a cast-approved voice ID. This renderer smoke
// has no channel cast, so it uses the same explicit default that the ElevenLabs
// adapter uses rather than falling through to Fish or an unrecorded voice.
const SMOKE_ELEVEN_VOICE_ID = process.env.WHITEBOARD_SMOKE_ELEVEN_VOICE_ID || "JBFqnCBsd6RMkjVDRZzb";
const SMOKE_RUN_ID = process.env.WHITEBOARD_SMOKE_RUN_ID?.trim() || "module-test-v2";
if (!/^[a-z0-9][a-z0-9-]{0,63}$/i.test(SMOKE_RUN_ID)) {
  throw new Error("WHITEBOARD_SMOKE_RUN_ID must be a safe local run identifier");
}
const SMOKE_CASE = process.env.WHITEBOARD_SMOKE_CASE?.trim() || "banana-republic";
if (!["banana-republic", "finance-fees"].includes(SMOKE_CASE)) {
  throw new Error("WHITEBOARD_SMOKE_CASE must be banana-republic or finance-fees");
}
const RUN_DIR = join(process.cwd(), "output", "whiteboard", SMOKE_RUN_ID);

// A deliberately authored, renderer-only test board. It lets the smoke prove
// the Nano Banana Pro → ElevenLabs → Whisper → deterministic-scribe path when
// a remote planner is unavailable. It is never a substitute for the sealed
// story receipt used by a publishable channel run.
const BANANA_REPUBLIC_SMOKE_PLAN = {
  title: "CHIQUITA · THE BANANA REPUBLIC",
  fullText: "",
  panels: [
    {
      idx: 0,
      narration: "Picture a fruit company with more power than a government. In the early twentieth century, United Fruit did not merely ship bananas. It owned plantations, railroads, ports, and the routes that moved people and money across Central America. When one company controls the land, the logistics, and the political access, a nation can begin to serve a balance sheet instead of its own citizens. That is the machinery behind the phrase banana republic.",
      layers: [
        { kind: "art", draw: "a composed black-marker map scene of Central America linked by banana plantations, railroad tracks, a cargo ship and a port, with one small red accent", cue: "United Fruit did not merely ship bananas", box: [0.12, 0.18, 0.76, 0.62] },
        { kind: "label", text: "ONE COMPANY · LAND + RAIL + PORTS", cue: "owned plantations, railroads, ports", box: [0.12, 0.84, 0.76, 0.08], color: "#c0392b" },
      ],
    },
    {
      idx: 1,
      narration: "The label arrived before the legend. In 1904, writer O. Henry used banana republic to describe a country whose economy and politics could be bent around a foreign fruit business. The phrase sounds comic today, but its mechanism was not. Export wealth was concentrated. Infrastructure followed the company. Local leaders faced pressure from the people who owned the rail line, the docks, and the jobs. A catchy phrase captured a very unequal arrangement.",
      layers: [
        { kind: "art", draw: "a composed editorial marker scene of a writer at a desk looking at a small republic map while giant banana crates and a rail line loom behind it", cue: "In 1904, writer O. Henry", box: [0.12, 0.18, 0.76, 0.62] },
        { kind: "label", text: "1904 · “BANANA REPUBLIC”", cue: "used banana republic", box: [0.18, 0.84, 0.64, 0.08], color: "#c0392b" },
      ],
    },
    {
      idx: 2,
      narration: "The costs were human. In 1928, banana workers near Ciénaga, Colombia went on strike for safer and fairer conditions. The confrontation ended with the army opening fire. The exact death toll remains disputed, but the event became known as the Banana Massacre because workers learned what could happen when a business dispute fused with state power. It is the moment this story stops being about a brand and becomes a warning about institutions.",
      layers: [
        { kind: "art", draw: "a respectful non-graphic black-marker scene of striking banana workers facing a distant line of soldiers near railroad cars, with a single red warning accent", cue: "In 1928, banana workers near Ciénaga", box: [0.12, 0.18, 0.76, 0.62] },
        { kind: "label", text: "1928 · CIÉNAGA, COLOMBIA", cue: "became known as the Banana Massacre", box: [0.18, 0.84, 0.64, 0.08], color: "#c0392b" },
      ],
    },
    {
      idx: 3,
      narration: "Power also travels through stories. United Fruit hired public-relations pioneer Edward Bernays to shape how American audiences saw its interests. Then in 1954, the CIA backed the overthrow of Guatemala's elected president, Jacobo Árbenz, after land reform threatened United Fruit holdings. The lesson is not that one poster changes history. It is that ownership, messaging, and political influence can reinforce each other until a private interest feels like national security.",
      layers: [
        { kind: "art", draw: "a composed marker scene with a newspaper press, a radio microphone, a map of Guatemala and an arrow from corporate land deeds toward a government building", cue: "United Fruit hired public-relations pioneer", box: [0.12, 0.18, 0.76, 0.62] },
        { kind: "label", text: "1954 · GUATEMALA", cue: "the CIA backed the overthrow", box: [0.28, 0.84, 0.44, 0.08], color: "#c0392b" },
      ],
    },
    {
      idx: 4,
      narration: "The company changed names, but consequences kept arriving. In 2007, Chiquita Brands International pleaded guilty in the United States to making payments to a Colombian paramilitary group and agreed to a twenty-five-million-dollar fine. That did not erase every earlier chapter, and it did not prove that history repeats itself automatically. It did show why corporate history is not just a logo timeline. Decisions made for quarterly protection can leave long public shadows.",
      layers: [
        { kind: "art", draw: "a composed black-marker scene of a corporate filing folder, courtroom columns, a calendar marked 2007 and a long shadow extending across a map of Colombia", cue: "In 2007, Chiquita Brands International", box: [0.12, 0.18, 0.76, 0.62] },
        { kind: "label", text: "2007 · $25M FINE", cue: "twenty-five-million-dollar fine", box: [0.28, 0.84, 0.44, 0.08], color: "#c0392b" },
      ],
    },
    {
      idx: 5,
      narration: "So the enduring story is bigger than bananas. It is about what happens when a company becomes the map, the railway, the employer, the narrator, and the political pressure point all at once. Good history does not flatten that into a cartoon villain. It asks where the power sat, who carried the risk, and which safeguards were missing. The phrase banana republic survived because the warning still matters whenever private control becomes public destiny.",
      layers: [
        { kind: "art", draw: "a composed final marker scene of a balance scale weighing a corporation tower against a small democratic civic building, connected by rail and port lines, with a restrained red accent", cue: "the enduring story is bigger than bananas", box: [0.12, 0.18, 0.76, 0.62] },
        { kind: "label", text: "WHEN PRIVATE CONTROL BECOMES PUBLIC DESTINY", cue: "private control becomes public destiny", box: [0.12, 0.84, 0.76, 0.08], color: "#c0392b" },
      ],
    },
  ],
};
BANANA_REPUBLIC_SMOKE_PLAN.fullText = BANANA_REPUBLIC_SMOKE_PLAN.panels.map((panel) => panel.narration).join(" ");

const BANANA_REPUBLIC_FACTS =
  "The United Fruit Company (UFC, founded 1899, later Chiquita) dominated the banana trade across Central America. Writer " +
  "O. Henry coined 'banana republic' in 1904 for nations whose economies and governments UFC controlled. UFC owned vast " +
  "land, the railroads and ports, and bought politicians. In 1928 in Ciénaga, Colombia, the army — protecting UFC interests " +
  "— opened fire on striking banana workers (the Banana Massacre), killing into the hundreds. UFC hired PR pioneer Edward " +
  "Bernays to shape U.S. opinion. In 1954 the CIA backed a coup (PBSuccess) that overthrew Guatemala's elected Jacobo Árbenz " +
  "after his land reform threatened UFC. In 2007 successor Chiquita pleaded guilty and paid a $25 million fine for funneling " +
  "about $1.7 million to a Colombian paramilitary death squad (the AUC), a designated terrorist group.";

// A source-labelled educational illustration—not personal investment advice.
// All figures are the SEC's stated $100,000 / 4% / 20-year hypothetical.
const FINANCE_FEES_SMOKE_PLAN = {
  title: "THE 1% FEE · THE COMPOUNDING LEAK",
  fullText: "",
  panels: [
    {
      idx: 0,
      narration: "A one-percent fee sounds tiny because it is written next to a hundred. But investing happens across years, not one statement. This is not advice or a prediction. It is a simple SEC educational example: start with one hundred thousand dollars, assume a four-percent annual return, and leave it alone for twenty years. The question is not whether four percent will happen. It is what a fee does to every future year that money could have kept compounding.",
      layers: [
        { kind: "art", role: "hero", draw: "a composed black-marker educational finance diagram: a one hundred thousand dollar account statement enters a left-to-right twenty-year timeline; at every year marker, one small red fee coin exits through a toll gate into a fee jar, while the remaining balance continues to the next year. Make the repeated annual deduction and reduced future balance immediately clear. No tree, seed, plant, or generic growth metaphor.", cue: "one-percent fee sounds tiny", box: [0.08, 0.20, 0.48, 0.50] },
        { kind: "art", role: "evidence", draw: "a small black-marker calendar strip with annual pages, each page feeding exactly one small red coin through the same fee toll into a jar; show a repeated yearly deduction, not a decorative calendar", cue: "across years", box: [0.64, 0.22, 0.20, 0.18] },
        { kind: "art", role: "reaction", draw: "one isolated worried saver holding one account statement and looking at one red coin leaving it; clear sad face and open hands, no chart, no coin pile, no objects crossing the body outline", cue: "This is not advice", box: [0.64, 0.48, 0.16, 0.22] },
        { kind: "label", text: "HYPOTHETICAL · $100K · 4% · 20 YEARS", cue: "simple SEC educational example", box: [0.15, 0.84, 0.70, 0.08], color: "#c0392b" },
        { kind: "art", role: "evidence", draw: "a clear twenty-year ruler: red fee toll marks make the final balance shorter than the start", cue: "whether four percent will happen", box: [0.78, 0.50, 0.17, 0.22] },
      ],
    },
    {
      idx: 1,
      narration: "Compounding means the next year's return is calculated on this year's balance. A fee reduces that balance before it gets another chance to grow. So the visible charge is only the first cost. The hidden cost is every dollar that charge can no longer earn later. That is why comparing annual fees is not a cosmetic exercise. It is comparing how much of the compounding engine remains working for you after the bill is paid.",
      layers: [
        { kind: "art", role: "evidence", draw: "a small black-marker year-one account balance feeding a year-two return line, then a higher year-three balance, so the return is visibly calculated on the prior balance; no gear or abstract machine", cue: "Compounding means", box: [0.10, 0.24, 0.20, 0.18] },
        { kind: "art", role: "hero", draw: "a composed black-marker balance timeline with three successive annual account boxes: before each next-year growth arrow, a small red fee is removed from the current balance, making each later account box visibly smaller than the no-fee path beside it. No snowball or decorative metaphor.", cue: "fee reduces that balance", box: [0.34, 0.20, 0.46, 0.48] },
        { kind: "label", text: "FEE TODAY = LESS TO COMPOUND TOMORROW", cue: "visible charge is only the first cost", box: [0.12, 0.84, 0.76, 0.08], color: "#c0392b" },
        { kind: "art", role: "reaction", draw: "one isolated concerned person looking from one current account slip toward one smaller future account slip; slumped shoulders, clear expression, no chart or objects crossing the person", cue: "hidden cost", box: [0.10, 0.50, 0.20, 0.24] },
        { kind: "art", role: "evidence", draw: "one future account statement receives a smaller growth arrow after a red fee exits the earlier statement", cue: "can no longer earn later", box: [0.78, 0.52, 0.17, 0.22] },
      ],
    },
    {
      idx: 2,
      narration: "In the SEC's illustration, a quarter-percent annual fee leaves about two hundred eight thousand dollars after twenty years. A half-percent fee leaves about one hundred ninety-eight thousand. A one-percent fee leaves about one hundred seventy-nine thousand. Same starting balance. Same assumed four-percent growth. Different fee. These are hypothetical calculations, not forecasts, but they show the mechanism cleanly: seemingly small annual percentages can create meaningful gaps over long periods.",
      layers: [
        { kind: "art", role: "hero", draw: "a precise editorial marker bar chart with exactly three descending bars and red gap arrows, no speech bubbles and absolutely no text, labels, or numbers; reserve clear whitespace above and below each bar for renderer-drawn labels", cue: "SEC's illustration", box: [0.22, 0.20, 0.44, 0.46] },
        { kind: "label", text: "0.25% · $208K", cue: "quarter-percent annual fee", box: [0.16, 0.72, 0.20, 0.06], color: "#c0392b" },
        { kind: "label", text: "SEC HYPOTHETICAL · SAME $100K / 4% / 20Y", cue: "leaves about two hundred", box: [0.12, 0.84, 0.76, 0.08], color: "#c0392b" },
        { kind: "label", text: "0.50% · $198K", cue: "half-percent fee", box: [0.40, 0.72, 0.20, 0.06], color: "#c0392b" },
        { kind: "label", text: "1.00% · $179K", cue: "one-percent fee", box: [0.64, 0.72, 0.20, 0.06], color: "#c0392b" },
        { kind: "art", role: "evidence", draw: "a small pair of identical starting account statements feeding three diverging arrows toward the bars, directly showing the same starting balance", cue: "Same starting balance", box: [0.06, 0.28, 0.14, 0.18] },
        { kind: "art", role: "evidence", draw: "a small black-marker ruler measuring the widening red gap between two future coin piles", cue: "Different fee", box: [0.72, 0.30, 0.16, 0.16] },
        { kind: "art", role: "reaction", draw: "a surprised investor comparing the three diverging outcomes with raised eyebrows and an open calculator", cue: "These are hypothetical calculations", box: [0.72, 0.52, 0.16, 0.22] },
      ],
    },
    {
      idx: 3,
      narration: "The right lesson is not that the lowest number always wins. Different services, investments, risks, taxes, and account features can matter. The lesson is that you should see the price before you judge the value. Ask what the fee is, what it pays for, whether it is charged on assets, transactions, or a subscription, and how it changes as your balance changes. A fee can be reasonable and still deserve a calculation.",
      layers: [
        { kind: "art", role: "evidence", draw: "a small black-marker price tag balanced against a service toolkit, with a red question mark above the tag", cue: "lowest number always wins", box: [0.10, 0.24, 0.20, 0.18] },
        { kind: "art", role: "hero", draw: "a composed black-marker comparison table with blank columns for fee, service, risk, and disclosure, plus a person using a magnifying glass rather than choosing a product", cue: "Different services", box: [0.34, 0.20, 0.46, 0.48] },
        { kind: "label", text: "COMPARE VALUE · NOT JUST A NUMBER", cue: "see the price before you judge the value", box: [0.20, 0.84, 0.60, 0.08], color: "#c0392b" },
        { kind: "art", role: "evidence", draw: "a small black-marker balance scale holding a fee receipt on one side and a service checklist on the other", cue: "what it pays for", box: [0.10, 0.54, 0.18, 0.16] },
        { kind: "art", role: "evidence", draw: "one fee receipt branches into three clear paths: asset, transaction, and subscription", cue: "assets, transactions, or a subscription", box: [0.78, 0.52, 0.17, 0.22] },
      ],
    },
    {
      idx: 4,
      narration: "There is another distinction people miss: nominal return is the number before inflation and taxes. Real return is what remains after them. Inflation can reduce purchasing power even when an account balance rises. That does not make a particular product right or wrong. It means one headline percentage cannot answer every question. Time horizon, liquidity needs, risk tolerance, taxes, and fees all belong in the same honest picture.",
      layers: [
        { kind: "art", role: "hero", draw: "a composed black-marker scene of a rising account balance line beside a shrinking purchasing-power basket, with a red wedge between the two paths and no written labels", cue: "another distinction people miss", box: [0.34, 0.20, 0.46, 0.48] },
        { kind: "art", role: "evidence", draw: "a small black-marker tax receipt and inflation thermometer pointing down toward a coin pile", cue: "inflation and taxes", box: [0.10, 0.24, 0.20, 0.18] },
        { kind: "label", text: "REAL RETURN = AFTER INFLATION + TAXES", cue: "purchasing power", box: [0.16, 0.84, 0.68, 0.08], color: "#c0392b" },
        { kind: "art", role: "reaction", draw: "a concerned shopper holding a smaller grocery basket while looking at the widening red wedge, clear sad face and lowered posture", cue: "does not make a particular product", box: [0.10, 0.50, 0.18, 0.24] },
        { kind: "art", role: "evidence", draw: "one blank headline card beside one checklist and a red question mark: one number cannot answer every question", cue: "one headline percentage", box: [0.78, 0.52, 0.17, 0.22] },
      ],
    },
    {
      idx: 5,
      narration: "So the useful habit is simple. Read the disclosures. Check your statements. Ask for the fee breakdown in plain language. Use a calculator with your own assumptions, then decide whether the service and risk make sense for your situation. This video is education, not a recommendation. But the arithmetic is worth remembering: every recurring cost gets a vote in the future balance. Small percentages deserve a full sentence, not a footnote.",
      layers: [
        { kind: "art", role: "hero", draw: "a composed final black-marker scene of a person reading a blank disclosure document beside a calculator and a long timeline, with a calm checkmark and no product logos", cue: "useful habit is simple", box: [0.34, 0.20, 0.46, 0.48] },
        { kind: "art", role: "evidence", draw: "a small black-marker stack of disclosure pages with a magnifying glass and a red underline", cue: "Read the disclosures", box: [0.10, 0.24, 0.20, 0.18] },
        { kind: "label", text: "SOURCE · INVESTOR.GOV · EDUCATION, NOT ADVICE", cue: "fee breakdown in plain language", box: [0.10, 0.84, 0.80, 0.08], color: "#c0392b" },
        { kind: "art", role: "evidence", draw: "one blank speech bubble beside one check-list for your own assumptions", cue: "your own assumptions", box: [0.78, 0.52, 0.17, 0.22] },
        { kind: "art", role: "evidence", draw: "a small black-marker calculator feeding one coin into a future balance jar through a red arrow", cue: "every recurring cost", box: [0.10, 0.54, 0.18, 0.16] },
      ],
    },
  ],
};
FINANCE_FEES_SMOKE_PLAN.fullText = FINANCE_FEES_SMOKE_PLAN.panels.map((panel) => panel.narration).join(" ");

const FINANCE_FEES_FACTS =
  "Investor.gov defines real return as return after taxes and inflation. Its July 2025 SEC investor bulletin gives a hypothetical: " +
  "$100,000 growing 4% annually over 20 years ends around $208,000 with a 0.25% annual fee, around $198,000 with a 0.50% fee, " +
  "and around $179,000 with a 1.00% fee. Fees reduce the balance that remains available to earn future returns. " +
  "The illustration is educational only, not a forecast or personal investment recommendation.";

const selectedSmoke = SMOKE_CASE === "finance-fees"
  ? {
      plan: FINANCE_FEES_SMOKE_PLAN,
      facts: FINANCE_FEES_FACTS,
      brief: {
        topic: "Why a one-percent annual investment fee can compound into a large long-term gap",
        header: "THE 1% FEE · THE COMPOUNDING LEAK",
        // This is a long-form proof, not the default short smoke. Six panels
        // receive 80 bounded words each so every source-backed comparison and
        // disclosure is actually spoken before the visual is allowed to ship.
        targetWords: 480,
        beats: [
          "the SEC's $100,000, four-percent, twenty-year hypothetical",
          "why recurring fees reduce future compounding",
          "the quarter-percent, half-percent and one-percent illustration",
          "compare service and disclosure, not just a number",
          "real return accounts for inflation and taxes",
          "education only: read disclosures and use your own assumptions",
        ],
        sourceUrls: [
          "https://www.investor.gov/introduction-investing/general-resources/news-alerts/alerts-bulletins/investor-bulletins/updated",
          "https://www.investor.gov/introduction-investing/investing-basics/glossary/real-return",
        ],
      },
    }
  : {
      plan: BANANA_REPUBLIC_SMOKE_PLAN,
      facts: BANANA_REPUBLIC_FACTS,
      brief: {
        topic: "Why Chiquita — the banana company once called United Fruit — is the evil 'banana republic' company",
        header: "CHIQUITA  ·  THE BANANA REPUBLIC",
        beats: [
          "the banana company United Fruit (today CHIQUITA), founded 1899, owns the land, railroads, ports and politicians of Central America",
          "writer O. Henry coins 'banana republic' (1904) for these captive nations",
          "the 1928 Banana Massacre — the army guns down striking banana workers in Colombia",
          "propaganda man Edward Bernays + the 1954 CIA coup that overthrows Guatemala's elected Árbenz",
          "2007 — Chiquita pleads guilty, a $25M fine for ~$1.7M paid to the AUC death squad",
          "verdict — a company that rewrote whole nations for profit",
        ],
        sourceUrls: [],
      },
    };

const useSuppliedPlan = SMOKE_CASE !== "banana-republic" || process.env.WHITEBOARD_SMOKE_PLAN === "deterministic";

let res;
try {
  res = await castWhiteboardSync({
  brief: {
    topic: selectedSmoke.brief.topic,
    facts: selectedSmoke.facts,
    header: selectedSmoke.brief.header,
    ...(selectedSmoke.brief.targetWords ? { targetWords: selectedSmoke.brief.targetWords } : {}),
    ttsProvider: "elevenlabs",
    elevenVoiceId: SMOKE_ELEVEN_VOICE_ID,
    beats: selectedSmoke.brief.beats,
  },
  runDir: RUN_DIR,
  outPath: join(RUN_DIR, "out.mp4"),
  // This is a local renderer smoke only, never a publishable channel run. It
  // uses the exact same attested Nano Banana Pro art contract as the real
  // whiteboard_scribe block so a legacy helper cannot quietly exercise a
  // retired image path or make unreceipted art.
  generateImage: async (request) => await generateNanoBananaProWhiteboardArtWithReceipt({
    prompt: request.prompt,
    maxProviderAttempts: 1,
    // A new proof run or changed literal art direction must never reuse a
    // provider response keyed for an earlier request with the same layer ID.
    // The exact prompt is also receipt-bound downstream.
    idempotencyContext: `local-whiteboard-smoke-v3:${SMOKE_RUN_ID}:${request.id}:${createHash("sha256").update(request.prompt).digest("hex").slice(0, 16)}:seed-${request.seed}`,
  }),
  ...(useSuppliedPlan ? { plan: selectedSmoke.plan } : {}),
    log: (m) => console.error("[wb]", m),
  });
} catch (error) {
  await mkdir(RUN_DIR, { recursive: true });
  await writeFile(
    join(RUN_DIR, "smoke-result.json"),
    JSON.stringify({
      contract: "whiteboard-renderer-smoke/v1",
      status: "failed_before_publish",
      runId: SMOKE_RUN_ID,
      error: error instanceof Error ? error.message : String(error),
    }, null, 2),
    "utf8",
  );
  throw error;
}
await writeFile(
  join(RUN_DIR, "smoke-result.json"),
  JSON.stringify({
    contract: "whiteboard-renderer-smoke/v1",
    status: "rendered_not_publishable",
    runId: SMOKE_RUN_ID,
    case: SMOKE_CASE,
    outPath: res.outPath,
    title: res.title,
    panelCount: res.panels.length,
    durationMs: res.durationMs,
    artAssetCount: res.artAssets.length,
    sourceUrls: selectedSmoke.brief.sourceUrls,
  }, null, 2),
  "utf8",
);
console.log(JSON.stringify({ out: res.outPath, title: res.title, panels: res.panels.length, durationMs: res.durationMs }, null, 2));
