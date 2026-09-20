export function selectReadinessTests(tests, argv) {
  if (argv.length > 1 || (argv.length === 1 && argv[0] !== "--exclude-thumbnail")) {
    throw new Error("Usage: run-production-readiness-tests.mjs [--exclude-thumbnail]");
  }
  const partial = argv[0] === "--exclude-thumbnail";
  const excluded = partial ? tests.filter(path => /thumbnail/i.test(path)) : [];
  const excludedSet = new Set(excluded);
  return { tests: tests.filter(path => !excludedSet.has(path)), excluded, partial };
}
