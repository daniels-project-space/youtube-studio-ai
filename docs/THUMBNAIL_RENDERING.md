# Thumbnail rendering contract

Every production thumbnail uses the same two-stage renderer:

1. A configured image provider generates text-free 16:9 scene art at the
   economical `flash` tier. The request is built only from typed scene fields
   and always carries `allowText: false`.
2. The local FFmpeg compositor applies the exact headline, badge, font,
   treatment, colors, and safe-zone layout from the channel playbook.

Provider selection therefore cannot change spelling or typography behavior.
The normal playbook route, Style-DNA foundation route, week-ahead preview, and
speech helper all use `renderThumbnail` in `src/lib/thumbnailRenderer.ts`.

Video frames are not reusable thumbnail bases by default. A producer must
attach `thumbnail-base-v1` provenance that explicitly guarantees `textFree:
true` and names the reserved safe zone. The renderer also requires that zone to
match the requested layout; otherwise it generates a dedicated text-free base.

The post-render mobile/reference judge is a publishing alarm. It may block a
production asset, but it never launches another paid renderer or silently
substitutes a generic card. `draft_preview_placeholder` is the only generic
title card, is visibly labelled as a draft, and cannot reach upload.

`bananaThumbnail` and direct `allowText: true` image requests are legacy/manual
experiment APIs. They are not valid production thumbnail call paths.
