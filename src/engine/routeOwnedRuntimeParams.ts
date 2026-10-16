/** Parameters whose values are fixed by the selected channel/program route. */
export const ROUTE_OWNED_RUNTIME_PARAM_KEYS: Readonly<Record<string, readonly string[]>> = {
  topic_select: ["targetSeconds", "seriesTitle", "seriesCount"],
  director_brief: ["targetSeconds"],
  dp_brief: ["targetSeconds"],
  editor_brief: ["targetSeconds"],
  composer_brief: ["targetSeconds"],
  critic_spec: ["targetSeconds"],
  script_gen: ["maxSeconds"],
  length_check: ["minSeconds", "maxSeconds"],
  assemble: ["durationSec"],
  whiteboard_scribe: ["targetSeconds"],
  lore_short: ["targetSeconds"],
  motion_comic: ["targetSeconds", "panels"],
  quiz_year: ["targetSeconds"],
  short_strategy: ["targetSeconds"],
  documotion_short: ["targetSeconds"],
};
