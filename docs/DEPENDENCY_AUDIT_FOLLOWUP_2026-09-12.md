# Dependency audit follow-up

12 September 2026. Read-only audit during chess development. **Exact CI command `pnpm audit --prod --audit-level=high` passes, exit 0: four moderate, zero high.** The full audit has eight findings, including four high development/build findings. Dependency presence is not a demonstrated application exploit. Both lockfile diffs add only dependency-free `chess.js@1.4.0`; none of these findings was introduced by that addition.

| Existing package | Scope | Required follow-up, not an applied upgrade |
| --- | --- | --- |
| extract-zip 2.0.1 | Two high; Puppeteer/browser downloader, development | No published patch: the audit-suggested 2.0.2 returns registry 404. New Puppeteer/browser-download major versions remove it but require ESM, Node and actual browser-download/capture validation. Never pin a nonexistent patch. |
| deepmerge-ts 7.1.5 | High; Trigger build → Prisma config | 8.0.0 addresses it, but changes Map/mutation behavior. Test real Prisma configuration/build before any scoped override. |
| js-yaml 4.3.1 | High; ESLint/build paths | Qualify the 4.x branch at 4.3.2. Preserve the already-patched gray-matter 3.15.2 branch. |
| @opentelemetry/core 2.7.1 | Moderate; Trigger runtime telemetry | Qualify a scoped 2.8.0-or-later replacement with tracing/exporter tests, without downgrading existing newer copies. A Trigger bump alone does not establish removal. |
| hono 4.13.3 in pnpm; 4.13.0 npm override | Three moderate; Mastra/MCP | Qualify 4.13.5 through actual MCP parsing, requests and streaming on both installer paths. |

pnpm overrides are in `pnpm-workspace.yaml`; npm deployment overrides are in `package.json`. Changing only one would leave the other installation path inconsistent. No overrides or package upgrades were made in this review.

Primary advisory/release evidence: [extract-zip A](https://github.com/advisories/GHSA-jmr9-qjv8-65gv), [extract-zip B](https://github.com/advisories/GHSA-7pqw-9j4j-h8q3), [deepmerge-ts](https://github.com/advisories/GHSA-ggr8-5vv4-36mx) and [v8 changes](https://github.com/RebeccaStevens/deepmerge-ts/releases/tag/v8.0.0), [js-yaml](https://github.com/advisories/GHSA-2883-xcg3-v3hh), [OpenTelemetry](https://github.com/advisories/GHSA-8988-4f7v-96qf), [Hono SSG](https://github.com/advisories/GHSA-gqvv-2mrq-wpjv), [Hono body parsing](https://github.com/advisories/GHSA-g6gw-c38x-mqfc), [Hono query parsing](https://github.com/advisories/GHSA-crvj-82cr-hjcx).

Local receipts: `/tmp/chess-replay-audit-20260912.log` (full), `/tmp/chess-dependency-production-audit-20260912.log` (exact production policy). These findings are separate from the repository's structural `pnpm run audit`, which reports no regression.
