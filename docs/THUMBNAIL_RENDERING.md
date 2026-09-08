# Thumbnail rendering contract

> **Superseded historical contract — 2026-09-08.** The two-stage text-free-art plus local FFmpeg typography below is obsolete and must not be restored. The owner chose native image-provider typography for non-Lo-Fi thumbnails. Lo-Fi uses the exact video still, no headline, and a bottom-right 4K symbol; it must not receive a generic replacement scene or local text treatment. Current sealed runtime/configuration and owner locks govern implementation. See the [active goal ledger, items 136–139](GOAL_MODULE_AND_UI_HARDENING_BACKLOG_2026-09.md#h-earlier-owner-requirements-that-remain-active). The historical accounting discussion below is retained for audit context, not permission to reinstate its renderer.

## Historical implementation (not current instructions)

Every production thumbnail uses the same two-stage renderer:

1. A configured image provider generates text-free 16:9 scene art at the
   economical `flash` tier. The request is built only from typed scene fields
   and always carries `allowText: false`.
2. The local FFmpeg compositor applies the exact headline, badge, font,
   base/accent colors, and safe-zone layout from the channel playbook. All 12
   Style-DNA text-object motifs are executable treatments: torn strips, paint
   smear, censor bar, grunge sticker, spaced elegant type, block plates, neon,
   spray paint, double-stamped ink, movie-poster bevel, ransom tiles, and carved
   type.

Provider selection therefore cannot change spelling or typography behavior.
The normal playbook route, Style-DNA foundation route, week-ahead preview, and
speech helper all use `renderThumbnail` in `src/lib/thumbnailRenderer.ts`.

Video frames are not reusable thumbnail bases by default. A producer must
attach `thumbnail-base-v1` provenance that explicitly guarantees `textFree:
true` and names the reserved safe zone. The renderer also requires that zone to
match the requested layout; otherwise it generates a dedicated text-free base.

The post-render mobile/reference judge is a single publishing alarm. It may
block a production asset, but it never launches another paid renderer or
silently substitutes a generic card. `draft_preview_placeholder` is the only
generic title card, is visibly labelled as a draft, and cannot reach upload.

`bananaThumbnail` and direct `allowText: true` image requests are legacy/manual
experiment APIs. They are not valid production thumbnail call paths.

## Accounting and recovery

The composite ledger records the actual image counter delta, exact priced
concept/vision token usage, and a configured fallback only for provider calls
that explicitly report themselves as unpriced (currently Fal vision). Priced
Groq/Gemini vision calls and model-cache hits never receive the flat fallback.

Each paid request is claimed and checkpointed under
`runs/<runId>/thumbnail-checkpoints/<requestHash>`. The local manifest is saved
before R2 upload; completed pixels and the QA verdict are reusable across
workers. Error code `THUMBNAIL_CHECKPOINT_INCOMPLETE` means a claim exists but
the image/manifest pair cannot prove a safe completed result. Recovery is
deliberately operator-gated:

1. Reconcile the run-stage cost and provider bill/request before authorizing
   more spend.
2. If both `.manifest.json` and `.jpg` exist, rerun the same request; it restores
   them automatically and does not call the provider.
3. If the paid output is irrecoverable, start a new explicitly authorized run
   (new run-scoped claim). Do not delete the old `.claim.json`; it is the audit
   evidence for the ambiguous attempt.

There is intentionally no automatic claim-clear or regenerate-on-error route.
