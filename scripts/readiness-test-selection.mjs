import { readFileSync } from "node:fs";

export function selectReadinessTests(tests, argv, readSource = path => readFileSync(path, "utf8")) {
  if (argv.length > 1 || (argv.length === 1 && argv[0] !== "--exclude-thumbnail")) {
    throw new Error("Usage: run-production-readiness-tests.mjs [--exclude-thumbnail]");
  }
  const partial = argv[0] === "--exclude-thumbnail";
  // Mixed suites can execute excluded fixtures without naming them in the file.
  // Be conservative for this opt-in partial run; the default gate stays intact.
  const excluded = partial ? tests.filter(path => /thumbnail/i.test(path) || /thumbnail/i.test(readSource(path))) : [];
  const excludedSet = new Set(excluded);
  return { tests: tests.filter(path => !excludedSet.has(path)), excluded, partial };
}
