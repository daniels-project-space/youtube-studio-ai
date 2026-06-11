// One-off verification of parseJsonLoose repairs (fences, ctrl chars, truncation).
import { parseJsonLoose } from "../src/lib/gemini.ts";

const truncatedFence = "```json\n{\"pass\": false, \"issues\": [\"too generic\"]}";
const ctrl = '{"narration": "Line one.\nLine two with\ttab.", "heading": "Ok"}';
const closedFence = "```json\n{\"a\":1}\n```";
const truncatedMidString = '{"pass": false, "reason": "text overlaps the subj';
const truncatedMidArray = '{"queries": ["city skyline night", "coins on des';

console.log("truncated-fence:", JSON.stringify(parseJsonLoose(truncatedFence)));
console.log("ctrl-chars:", JSON.stringify(parseJsonLoose(ctrl)));
console.log("closed-fence:", JSON.stringify(parseJsonLoose(closedFence)));
console.log("truncated-mid-string:", JSON.stringify(parseJsonLoose(truncatedMidString)));
console.log("truncated-mid-array:", JSON.stringify(parseJsonLoose(truncatedMidArray)));
