import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const scriptSource = readFileSync(join(process.cwd(), "src/lib/scriptGen.ts"), "utf8");
const routerSource = readFileSync(join(process.cwd(), "src/lib/openRouter.ts"), "utf8");

assert.match(
  scriptSource,
  /const oneShotController = new AbortController\(\)/,
  "long-form one-shot generation must own a cancellation controller",
);
assert.match(
  scriptSource,
  /signal: oneShotController\.signal/,
  "the one-shot provider request must receive the cancellation signal",
);
assert.match(
  scriptSource,
  /oneShotController\.abort\(new Error\(/,
  "the one-shot deadline must abort the provider request before fallback work begins",
);
assert.doesNotMatch(
  scriptSource,
  /Promise\.race\(\[/,
  "script generation must not race an uncancellable provider call against a fallback",
);
assert.match(
  routerSource,
  /signal\?: AbortSignal/,
  "the OpenRouter boundary must expose caller cancellation",
);
assert.match(
  routerSource,
  /abortFromCaller[\s\S]{0,500}addEventListener\("abort"/,
  "OpenRouter must compose caller cancellation into its bounded request signal",
);

console.log("SCRIPT TIMEOUT CANCELLATION PASS — one-shot fallback cannot overlap an abandoned provider request");
