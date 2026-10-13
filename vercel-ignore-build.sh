#!/usr/bin/env bash

if [[ ${VERCEL_FORCE_BUILD:-0} == 1 ]]; then
  exit 1
fi

if [[ ${VERCEL_GIT_COMMIT_REF:-} == agent/studio-quality-release ]]; then
  exit 0
fi

previous=${VERCEL_GIT_PREVIOUS_SHA:-}
if [[ -n $previous ]] &&
  git cat-file -e "$previous^{commit}" >/dev/null 2>&1 &&
  git diff --quiet "$previous" HEAD -- . \
    ':!docs' ':!.github' ':!.serena' ':!graphify-out' \
    ':!**/*.test.*' ':!**/__tests__/**' >/dev/null 2>&1; then
  exit 0
fi

exit 1
