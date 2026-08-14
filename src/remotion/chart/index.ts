import { registerRoot } from "remotion";
import { ChartRemotionRoot } from "./Root";

/**
 * Isolated bundle entrypoint for the chart lane. `bundle({ entryPoint: ... })`
 * in src/lib/rankChartRender.ts points here, NOT at src/remotion/index.ts, so
 * the chart composition compiles on its own (see ./Root.tsx for why).
 */
registerRoot(ChartRemotionRoot);
