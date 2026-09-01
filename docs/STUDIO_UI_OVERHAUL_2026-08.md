# AutoStudio UI overhaul — page and subpanel matrix

This is the execution checklist for the 2026-08 ground-up studio redesign. A
shared visual language is necessary, but it is not sufficient: every desk must
be shaped around the operator decision it exists to support. A page is complete
only when its real data, actions, loading/empty/error states, responsive layout,
keyboard path, and captured visual result have all been reviewed.

## Product-wide rules

- Keep the always-visible navigation to the five daily desks. Specialist desks
  belong in the collapsed Utility deck.
- Use channel artwork and channel-specific color only where identity matters;
  keep operational state colors consistent across the fleet.
- Animation must communicate real state, chronology, or spatial relationship.
  It must pause or simplify under `prefers-reduced-motion`.
- Every primary action states its object and outcome. Paid render, OAuth,
  account, delete, and publish actions retain their safety boundary.
- New elements use the shared tokens, panel, button, status, typography, focus,
  and spacing primitives rather than inventing another card dialect.
- Validate at 390, 768, 1280, and 1728 CSS-pixel widths and inspect captures,
  not merely DOM assertions.
- Run three complete visual passes over every route and reachable subpanel
  before calling the overhaul complete: structure and hierarchy, page-specific
  interaction and identity, then final density/motion/accessibility polish.
- Use the spectral frosted-glass language across the whole application, not
  only channel screens. Reserve the strongest blur and edge light for controls
  and elevated layers; keep reading surfaces calmer and maintain WCAG contrast.
- Prefer compact visual state, symbols, charts, progress, and controls to
  explanatory prose. Decorative copy may not displace a real status or action.

## Daily desks

### Studio `/`

Purpose: decide what needs attention now. Build an editorial moving channel
reel, live production signal, schedule horizon, channel health, release alerts,
and recent masters. The reel moves slowly without hijacking scroll; its controls
remain explicit and accessible. Avoid duplicating the full Runs or Analytics
pages.

#### Advanced Studio starting-page restructure

Treat the initial Studio screen as its own multi-pass product stage. Replace
fake or atmospheric text and text-over-image treatments with a real overview of
issues, runs, channels, schedule risk, YouTube readiness, recorded spend, and
analytics. Present these as compact animated widgets backed by live queries;
only widgets with useful detail expand, and every control routes to or performs
a real operator action. Add master controls for Production, Schedule, Channels,
and Analytics, validate empty/error/loading states, and inspect the expanded and
collapsed layouts at every target viewport.

### Channels `/channels`

Purpose: understand and organize the fleet. Replace repeated mini-panels with
identity-led landscape cards, real folders, useful readiness/status signals,
art previews, next-release context, and compact secondary actions. Archived or
deleted material must not leak into the active view.

### Channel detail `/channels/[slug]`

Purpose: operate one brand as a coherent show. Rebuild the hero, identity,
creative doctrine, current artwork, performance, production path, schedule,
YouTube connection, and advanced settings as distinct subpanels. The live
inception/test-render timeline must expose current stage, completed receipts,
failure owner, repair status, elapsed time, and next step.

### New channel `/channels/new`

Purpose: make a sequence of high-consequence decisions without a wall of form
controls. Separate opportunity, format, identity, artwork, production design,
YouTube connection, and readiness into stages with a persistent visual summary.
Creation completes only after one bounded test render passes identity/visual QA;
defects route back to the responsible shared module and the progress view shows
that repair truthfully.

### Production `/runs`

Purpose: triage active work and history. Lead with active jobs and a visually
legible live pipeline; group terminal runs beneath it. Progress animation is
bound to persisted stages and timestamps rather than invented percentages.

### Run detail `/runs/[runId]`

Purpose: diagnose one production. Give the master preview, stage chronology,
cost/evidence, defects, retry/recovery, provider receipts, and release gate their
own visual hierarchy. Dense artifacts remain progressively disclosed.

### Schedule `/schedule`

Purpose: reason about publishing cadence. Use a true time horizon, channel lanes,
collision/overdue signals, drag or edit affordances where supported, and a clear
private-draft posture. Calendar decoration must not obscure actionable dates.

### Library `/library`

Purpose: find and assess usable finished masters. Distinguish active, archived,
and refresh-needed inventory; keep deleted/orphaned items out of active results;
add folder/collection navigation where the real data model supports it. Surface
the real thumbnail refresh module with before/after, state, and bounded actions.

### Analytics `/analytics`

Purpose: compare channel and release performance. Use custom low-ink charts,
period/source labels, comparison baselines, and explicit no-data states. Never
display fake trends or decorative analytics.

## Specialist desks

### Packaging research `/seo`

Purpose: turn evidence into titles, thumbnails, and search positioning. Separate
queries, sources, competitors, decisions, and applied packaging. Show what was
actually used by a run.

### Studio assets `/studio-assets`

Purpose: manage reusable identity/media material. Group by channel, role,
provenance, and readiness; prioritize preview quality and reuse context over a
generic file-browser grid.

### Golden modules `/golden`

Purpose: inspect certified production capabilities. Treat module proof as a
quality ledger: reference media, current certificate, channel fit, last review,
and regression state.

### Editorial evidence `/editorial-evidence`

Purpose: audit claim/source/review lineage. Build a readable evidence chain with
source strength, unresolved claims, reviewer state, and run binding.

### Casefile `/casefile`

Purpose: operate the casefile format. Emphasize episode dossiers, source state,
timeline, visual identity, and production readiness rather than generic cards.

### Render fleet `/novita-render`

Purpose: understand capacity, job state, spend, and teardown. Use a live topology
view, queue chronology, GPU/provider identity, receipt-bound progress, and clear
idle-shutdown posture.

### Music references `/lofi`

Purpose: curate musical identity and reference evidence. Prioritize playable
audio, channel fit, rights/provenance, structural notes, and provider/source.

### Lore references `/loreshort`

Purpose: curate lore visual/story references. Prioritize source frame, identity
traits, story use, provenance, and approved/rejected treatment.

### Settings `/settings`

Purpose: configure policy safely. Separate account/OAuth, publishing policy,
cost limits, providers, channel defaults, and destructive controls. Remove the
redundant password-style UI gate after owner-session behavior is verified, while
retaining server-side owner and mutation boundaries.

## Final review passes

1. Information pass — remove duplication, hidden critical state, and dead-end
   controls.
2. Interaction pass — real actions, disabled/busy/error states, keyboard path,
   focus return, and narrow-screen behavior.
3. Motion pass — state-bound progress, carousel/transition rhythm, reduced
   motion, and no animation-caused layout shift.
4. Identity pass — channel-specific art/theme fit, especially Stoic and every
   newly created channel; verify YouTube-ready avatar/banner crops.
5. Visual pass — captured inspection of every page and subpanel, followed by a
   final whole-app correction sweep.
