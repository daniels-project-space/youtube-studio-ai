#!/usr/bin/env bash
# Vercel runs this before installing packages. The classifier needs only Node
# built-ins and checked-in, integrity-verified project dependency witnesses.
# Missing history or stale/unknown inputs always request a normal build.
node scripts/deployment-impact.mjs --vercel-ignore
