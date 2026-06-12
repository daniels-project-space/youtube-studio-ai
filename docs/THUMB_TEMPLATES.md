# Thumbnail Template Pack — spec (research-grounded)

Sources: thumbnailtest.com layout guide, thumbmagic 2026 principles, usevisuals/unkoa
best practices. Goal: designer-grade LOCKED layouts (the thing Bannerbear/Templated
sell) as parameterized Remotion compositions — zero per-render cost.

## Research rules baked into every template
- 3–5 locked templates per channel, used for ~80% of uploads (pattern = subscriber recognition).
- 60-30-10 color rule: 60% background (AI art), 30% subject/overlay, 10% accent (text/highlight).
- Contrast ratio ≥ 4.5:1 between text and its backing; single dominant subject; ≤3 visual elements.
- Text ≤ 5 words, readable at 120px; safe zones (no bottom-right/bottom-left corners).
- All colors/fonts/treatments come from the channel's visualLanguage (never hardcoded).

## The six templates (Remotion comp `ThumbTemplate`, prop `layout`)
1. `diagonal_split` — AI art fills right ~62% behind a hard diagonal edge; left panel is a
   solid channel-color block carrying stacked hook words + number. No zone negotiation ever.
2. `number_burst` — giant number (45% width) top-left over radial accent burst; subject art
   right; 1-2 word kicker under number. Finance/data flagship.
3. `circle_spotlight` — subject art inside a large accent-ringed circle right-of-center;
   text stack left; small arrow/tick accent pointing at circle.
4. `banner_bottom` — full-bleed AI art; bottom 24% solid banner (channel color) with one
   line of large text + badge right; top-left small kicker pill. Cozy/lofi flagship.
5. `versus_split` — two art slots split by lightning/zig divider; "VS" disc center; labels
   top of each half. Comparisons.
6. `torn_reveal` — AI art with a torn-paper edge revealing a flat color panel (top or left)
   carrying text; tape/scribble accent. Story/history flagship.

## Wiring
- `ThumbTemplate.tsx` registered like ThumbText (1 frame, 1280×720, transparent? NO — these
  are FULL composites: art image passed as prop `artSrc` (file path via staticFile? no —
  pass as base64 data URI prop), rendered + text in ONE comp → renderStill → jpg.
- renderCandidate gains renderMode `"template"`: pick layout from playbook
  `visualLanguage.templates` (distill chooses 2-3 of the 6 per channel), fill slots
  (artSrc = generated base, words, number, badge, colors), renderStill, then the existing
  CRITIQUE→ACT loop (regen art / swap layout on fail).
- distill prompt: add `"templates":["diagonal_split",...]` selection guidance per identity.
- Energy tiers still drive the ART concept; templates own the LAYOUT.

## Status
- [x] Research + spec
- [ ] ThumbTemplate.tsx (6 layouts)
- [ ] renderCandidate "template" mode + distill `templates` field
- [ ] Proof renders: 4 channels × template mode → VPS links
