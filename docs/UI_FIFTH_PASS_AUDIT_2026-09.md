# Studio UI fifth-pass audit

This is the acceptance contract for the full Studio surface. It treats the product as a YouTube operating system, not a collection of generic dashboards. Every route gets one dominant job, one route-specific visual grammar, and only the controls needed to complete that job.

## The five passes

1. **Structure:** one primary decision per page; fleet navigation remains separate from utility tools; secondary material lives in named disclosures instead of permanent side panels.
2. **Identity:** each route uses a visual system that explains its job (territory maps, production ledgers, release clocks, evidence chains, asset registries), while sharing typography, spacing, color tokens, and interaction states.
3. **Motion and status:** motion communicates live work, selection, progress, or causality. Reduced-motion mode removes nonessential animation without hiding state.
4. **Function and authority:** every visible action is connected to real data or a real flow. Spend, publish, OAuth, ownership, and destructive actions retain explicit safety boundaries. Viewer access is not a second password gate.
5. **Visual and interaction QA:** every route is captured at 1440×1000 and 390×844, disclosures are expanded, one real channel and run are traversed, and the audit fails on browser errors, HTTP errors, horizontal overflow, or undersized mobile controls.

## Page-by-page rationale

| Surface | YouTube Studio job | Deliberate visual grammar | Subpanels and acceptance |
| --- | --- | --- | --- |
| Studio `/` | Decide what needs attention now | Slow identity carousel, production pulse, compact fleet signals, and a bounded next-action queue | Production ledger expands in place; carousel controls remain usable on touch; links lead to fleet, runs, calendar, and ledger rather than duplicating their content |
| Channels `/channels` | Compare channel health and manage identities | Artwork-first fleet cards with channel-specific palette, avatar, banner, status, cadence, and output signals | Each Manage panel owns YouTube connection, autopilot, schedule, SEO, settings, and destructive controls; destructive actions remain owner-gated |
| New channel `/channels/new` | Build a coherent channel and prove it can render | Territory atlas → format route → creative brief → staged build; animated receipt rail and private proof window expose real progress | Niche catalog, route catalog, brief, modules, and build/QC stages are separate decisions; the sticky action rail never covers the final mobile content |
| Channel room `/channels/[slug]` | Understand one channel as a show bible and operating room | Channel art establishes identity before metrics; cadence, recent output, pipeline topology, and configuration follow in causal order | Identity, YouTube, automation, schedule, SEO, creative profile, recent production, pipeline parameters, and configuration remain distinct sections rather than one settings dump |
| Production `/runs` | Triage current and historical work | A receipt-led production ledger prioritizes state, stage, channel, progress, cost, and evidence over decorative cards | Filters and run rows preserve direct traversal to one chain of custody; no render or publish mutation is triggered by audit traversal |
| Run room `/runs/[runId]` | Trace one video from source to delivery | Status-toned hero, progress receipt, pipeline map, retained-media workbench, and delivery proof | Published-video disclosure, every media receipt, source link, master preview, pipeline modules, and logs stay inspectable on mobile with full-size targets |
| Release clock `/schedule` | Resolve timing and cadence conflicts | Seven-day bars and month map make temporal density visible before exact timestamps | Seven-day board, month map, cadence controls, channel filter, exact-date disclosure, and item settings are independently reachable |
| Library `/library` | Find, retain, archive, and repackage masters | Video shelf and packaging workshop emphasize thumbnails and retained outputs instead of table chrome | Active/archive folders, search, channel/status/date filters, archive restore/delete boundaries, packaging workshop, and thumbnail actions remain explicit |
| Analytics `/analytics` | Turn performance evidence into a decision | Observed-metric selector, comparison plot, and channel scatter expose relationships rather than vanity totals | Views, subscribers, published output, spend, connection health, and library handoff remain selectable and labeled; missing observations are shown as missing, never invented |
| SEO `/seo` | See territory, gaps, and package readiness | Topic territory map and readiness lanes connect channel intent to title/description/thumbnail work | Channel selection, opportunity evidence, readiness state, and packaging actions retain provenance and channel context |
| Editorial evidence `/editorial-evidence` | Verify claims and source coverage | Proof matrix and evidence rails foreground receipt state, usage, and gaps | Filters, claim/source relationships, disclosures, and provenance are readable without opening unrelated production controls |
| Studio assets `/studio-assets` | Reuse certified models, styles, and production assets | Registry grammar distinguishes reusable identity assets from provider/model candidates | Style, subject, distillation, controls, quality phase, model receipts, and official source links stay grouped by production role |
| Golden atlas `/golden` | Compare certified references and successor candidates | Orbit/atlas composition makes reference families and certification state legible | Successor queue and six reference groups expand separately; certification evidence is never collapsed into a single score |
| Casefile `/casefile` | Follow editorial evidence through the pipeline | A linked evidence chain visualizes source → claim → scene → output causality | Chain nodes, receipts, gaps, and review state stay inspectable as proof, not decorative analytics |
| Render fleet `/novita-render` | Understand GPU topology and render readiness | Node topology, queue state, health, and capability receipts make infrastructure visible | Provider status and safe diagnostics remain distinct from paid render actions; unavailable Novita capacity is reported rather than simulated |
| Lofi archive `/lofi` | Review lofi identity and visual continuity | Image-led archive favors mood, palette, environment, and packaging fit | References and output records retain channel attribution; a generic dashboard treatment would erase the product being judged |
| Lore archive `/loreshort` | Review sequential identity and story continuity | Frame-led sequence archive foregrounds character, style, ordering, and retained masters | Story panels, media receipts, and reference identity remain bound to the channel and run |
| Settings `/settings` | Understand authority and configure one channel safely | Authority map separates global connection state from channel-scoped configuration | Channel selector, YouTube connection, ownership, automation, and operating-room handoff are explicit; secrets are never displayed |
| Retired gate `/operator-login` | Confirm the redundant password screen is gone | Intentional redirect to Studio | The route must resolve to `/` and must not recreate a viewer password wall; owner verification still protects privileged operations |

## Automated acceptance

Run `npm run audit:ui`. By default it audits the production alias and writes full-page screenshots plus `report.json` to `/tmp/ysa-ui-audit/pass5`. `UI_AUDIT_BASE_URL`, `UI_AUDIT_OUTPUT_DIR`, `UI_AUDIT_CHROMIUM`, and `UI_AUDIT_ROUTES` can target a preview or a bounded route set.

The audit is read-only. It does not click OAuth start, spend, publish, delete, archive, or other mutations. A successful report requires:

- every captured route to resolve below HTTP 400;
- zero page or console errors;
- zero horizontal overflow;
- every mobile Studio button, form control, disclosure, and classed action link to expose at least a 44×44 CSS-pixel target;
- desktop/mobile base captures plus expanded disclosure captures;
- one visible channel detail and one visible run detail when public viewer data exposes them.

New pages must be added to `defaultRoutes` in `scripts/ui-fifth-pass-audit.mjs` in the same change that introduces the route. New panels should use native disclosure semantics where inspection is optional, and live stages must expose textual state in addition to animation.
