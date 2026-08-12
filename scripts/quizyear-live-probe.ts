/**
 * Live probe: pull real guess-the-year facts from the public Wikidata SPARQL
 * endpoint, build the four-option grids, and (with --render) render a still
 * from the isolated quiz Remotion bundle.
 *
 * Free and unauthenticated — no paid provider is touched.
 *
 *   npx tsx scripts/quizyear-live-probe.ts
 *   npx tsx scripts/quizyear-live-probe.ts --render
 */
import {
  assertOptionIntegrity,
  buildYearOptions,
  deterministicQuestionText,
  fetchQuizYearFacts,
  type QuizYearTopicKey,
} from "@/lib/quizYearFacts";
import { renderQuizYearStills, type QuizYearRound } from "@/lib/quizYearRender";

async function main(): Promise<void> {
  const topics: QuizYearTopicKey[] = [
    "science_discovery",
    "space_exploration",
    "landmark_architecture",
    "video_games",
  ];
  const collected: QuizYearRound[] = [];

  for (const topic of topics) {
    try {
      const r = await fetchQuizYearFacts({
        topic,
        count: 4,
        minNotability: topic === "science_discovery" ? 60 : 30,
        log: (m) => console.log("   " + m),
      });
      console.log(`\n### ${topic}: ${r.facts.length} clean / ${r.candidatesExamined} raw`);
      console.log(`    rejected: ${JSON.stringify(r.rejected)}`);
      for (const f of r.facts) {
        const options = buildYearOptions(f);
        assertOptionIntegrity(options, f);
        const grid = options
          .map((o, i) => `${"ABCD"[i]}) ${o.year}${o.isCorrect ? " *" : ""}`)
          .join("   ");
        console.log(`  Q: ${deterministicQuestionText(f)}`);
        console.log(`     ${grid}`);
        console.log(`     answer ${f.year}  src ${f.sourceUrl}`);
        collected.push({
          questionText: deterministicQuestionText(f),
          options: options.map((o) => ({ year: o.year, isCorrect: o.isCorrect })),
          subject: f.eventLabel,
          subtext: f.eventDescription,
          sourceUrl: f.sourceUrl,
          countdownSeconds: 6,
          revealSeconds: 4,
        });
      }
    } catch (e) {
      console.log(`\n### ${topic}: FAILED ${e instanceof Error ? e.message : e}`);
    }
    await new Promise((r) => setTimeout(r, 6000));
  }

  if (process.argv.includes("--render") && collected.length) {
    console.log(`\n### rendering stills from the ISOLATED quiz bundle (${collected.length} rounds)`);
    // frame 60 = mid-countdown of round 1; frame 220 = post-reveal of round 1.
    const out = await renderQuizYearStills({
      rounds: collected,
      palette: ["#0d1226", "#ffd23f", "#f7f7ff"],
      title: "Guess The Year",
      frames: [60, 220],
      outPaths: ["/tmp/quizyear-countdown.jpg", "/tmp/quizyear-reveal.jpg"],
    });
    console.log("   stills: " + out.join(", "));
  }
}

void main();
