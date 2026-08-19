import { registerRoot } from "remotion";
import { QuizRemotionRoot } from "./Root";

/**
 * Isolated bundle entrypoint for the quiz lane. `bundle({ entryPoint: ... })`
 * in src/lib/quizYearRender.ts points here, NOT at src/remotion/index.ts, so
 * the quiz composition compiles on its own (see ./Root.tsx for why).
 */
registerRoot(QuizRemotionRoot);
