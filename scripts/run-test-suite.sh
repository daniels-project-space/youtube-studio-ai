#!/usr/bin/env bash
# Run every tsx test in the repo and report only the failures.
#
# Written after a full-suite pass reported 162 failures, of which 159 were
# vendored zod tests living under src/motion/remotion/node_modules and two were
# React .tsx component tests that plain tsx cannot render. Exactly one real
# failure was hiding in that noise. Scoping the search is the difference between
# a suite anyone runs and one everyone ignores.
#
# A pass line in this codebase is not standardised — some tests print "... PASS",
# some "... tests passed", some "ok". Rather than guess, a test counts as passing
# only when tsx exits 0; the last line is kept purely to make a failure readable.
cd /home/ubuntu/youtube-studio-ai || exit 1
total=0
failed=0
: > /tmp/suite-failures.log
while IFS= read -r t; do
  total=$((total + 1))
  out=$(timeout 240 ./node_modules/.bin/tsx "$t" 2>&1)
  if [ $? -ne 0 ]; then
    failed=$((failed + 1))
    printf 'FAIL %s :: %s\n' "$t" "$(printf '%s' "$out" | tail -1 | cut -c1-90)" >> /tmp/suite-failures.log
  fi
done < <(find src -name '*.test.ts' -not -path '*/node_modules/*' | sort)
printf 'TOTAL=%s FAILED=%s\n' "$total" "$failed"
