import path from "node:path";
import { mkdir } from "node:fs/promises";
import {
  renderQuizYearPortraitProof,
  renderQuizYearPortraitProofStills,
} from "../src/lib/quizYearRender";
import { QUIZ_YEAR_PORTRAIT_WORST_CASE_FIXTURE } from "../src/remotion/quiz/portraitProofFixture";

const outputDirectory = process.env.QUIZ_YEAR_PORTRAIT_PROOF_DIR ?? "/tmp/quizyear-portrait-proof";

async function main(): Promise<void> {
  await mkdir(outputDirectory, { recursive: true });

  const rounds = QUIZ_YEAR_PORTRAIT_WORST_CASE_FIXTURE.rounds ?? [];
  const common = {
    rounds,
    palette: QUIZ_YEAR_PORTRAIT_WORST_CASE_FIXTURE.palette,
    title: QUIZ_YEAR_PORTRAIT_WORST_CASE_FIXTURE.title,
  };
  const frames = [
    30, // intro
    92, // round 1 question enters
    240, // round 1 countdown urgency
    300, // round 1 reveal + source label
    482, // round 2 question
    630, // round 2 countdown urgency
    690, // round 2 reveal + source label
    872, // round 3 question
    1020, // round 3 countdown urgency
    1080, // round 3 reveal + source label
    1290, // outro
  ];
  const names = [
    "intro",
    "round-1-question",
    "round-1-countdown",
    "round-1-reveal",
    "round-2-question",
    "round-2-countdown",
    "round-2-reveal",
    "round-3-question",
    "round-3-countdown",
    "round-3-reveal",
    "outro",
  ];

  if (process.env.QUIZ_YEAR_PORTRAIT_PROOF_STILLS_ONLY !== "1") {
    await renderQuizYearPortraitProof({
      ...common,
      outPath: path.join(outputDirectory, "quizyear-portrait-proof.mp4"),
      concurrency: 2,
      log: (message) => console.log(message),
    });
  }
  await renderQuizYearPortraitProofStills({
    ...common,
    frames,
    outPaths: names.map((name) => path.join(outputDirectory, `${name}.png`)),
  });

  console.log(
    JSON.stringify(
      {
        outputDirectory,
        frames: names,
        proofOnly: true,
        stillsOnly: process.env.QUIZ_YEAR_PORTRAIT_PROOF_STILLS_ONLY === "1",
      },
      null,
      2
    )
  );
}

void main();
