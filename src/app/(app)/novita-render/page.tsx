import { H3RenderConsole } from "./H3RenderConsole";

/**
 * The render desk is intentionally a single H3 control plane. Weekly work
 * enters Salad and one-off repair/preview work enters Novita; the former
 * direct console is retired so there is no second provider path to drift.
 */
export default function NovitaRenderPage() {
  return <H3RenderConsole />;
}
