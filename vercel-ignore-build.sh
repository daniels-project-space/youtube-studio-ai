#!/usr/bin/env bash

[ "${VERCEL_FORCE_BUILD:-0}" != 1 ] &&
[ -n "${VERCEL_GIT_PREVIOUS_SHA:-}" ] &&
git diff --quiet "$VERCEL_GIT_PREVIOUS_SHA" HEAD -- . \
  ':!docs' ':!.github' ':!.serena' ':!graphify-out' \
  ':!**/*.test.*' ':!**/__tests__/**' 2>/dev/null || exit 1
