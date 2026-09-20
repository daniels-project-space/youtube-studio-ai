import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";

const root = process.cwd();
const tracePath = join(root, ".next/server/app/api/yue2-evaluations/review/route.js.nft.json");
const trace = JSON.parse(await readFile(tracePath, "utf8"));
assert.ok(Array.isArray(trace.files) && trace.files.length > 0, "Build the YuE review route first");
const forbiddenDirectories = ["graphify-out", "src", "scripts", "docs", "test-fixtures", ".git"];
const unexpected = trace.files.filter((file) => {
  assert.equal(typeof file, "string");
  const path = relative(root, resolve(dirname(tracePath), file));
  return path === ".env" || path.startsWith(".env.") ||
    forbiddenDirectories.some((directory) => path === directory || path.startsWith(`${directory}/`));
});
assert.deepEqual(unexpected, [], "Runtime tracing must not bundle project sources, graphs, fixtures or environment files");
console.log(`YuE review bundle PASS: ${trace.files.length} traced files; no project sources, graphs, fixtures or environment files`);
