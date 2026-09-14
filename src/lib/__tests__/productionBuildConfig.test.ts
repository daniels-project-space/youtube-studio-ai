import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const packageJson = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as {
  scripts?: { build?: string };
};
const build = packageJson.scripts?.build ?? "";

assert.match(
  build,
  /NEXT_PUBLIC_CONVEX_URL=\$\{NEXT_PUBLIC_CONVEX_URL:-https:\/\/astute-camel-689\.convex\.cloud\}/,
  "production builds must default to the canonical Convex deployment",
);
assert.doesNotMatch(build, /127\.0\.0\.1|localhost/, "the build guard must not bake a local Convex endpoint");
console.log("production build Convex endpoint guard passed");
