# Multi-language channel groups — design

EN is always the base/main channel; DE + ES are sibling channels in the same
**group**. The expensive visual generation runs ONCE on the base; each language is
a cheap "finishing" pass that reuses the assets and only redoes narration,
captions, on-screen text, script, and metadata. Each language is its own
flag-branded YouTube channel (the operator's chosen brand strategy).

## YouTube API reality (researched 2026-06)

- **No channel creation API.** `channels` is list/update only — no `insert`.
  Channels (Brand Accounts) are created in the Google UI. → Phase 3 attempts this
  via browser automation; assisted one-click connect is the safe fallback.
- **No avatar-set API.** Only the banner is settable (`channelBanners.insert` +
  `channels.update` brandingSettings). → flag goes on the BANNER; siblings reuse
  the base AVATAR (copied R2 key), so the profile image is shared as requested.
- **No multi-audio-track API.** Multi-language audio exists in Studio (Feb 2026)
  but not via API. → we deliver separate per-language videos to separate channels.
- **Automatable:** `videos.insert`, per-language `localizations` (title/desc),
  `defaultLanguage`/`defaultAudioLanguage`, `captions.insert` per language, banner,
  branding/country, playlists.

## Data model

Channel gets a `group` link (top-level, all optional → back-compat):
```ts
groupId: v.optional(v.string()),     // shared id across the group (= base channelId)
language: v.optional(v.string()),    // "en" | "de" | "es"
groupRole: v.optional(v.string()),   // "base" | "sibling"
```
The base channel's groupId = its own _id. Siblings carry the same groupId.

## Phase 1 — groups + button (SHIPPED first)

`make-multilingual` Trigger task ({channelId, languages:["de","es"]}):
1. Load base channel; set its group = {groupId: base._id, language: base lang or "en", role: "base"}.
2. For each language, create a sibling channel:
   - clone identity (persona/palette/topicPool/voiceId/creativeBrief…); reuse the
     base AVATAR (imageKey copied — shared profile image).
   - clone base.pipeline, patch locale onto script_gen / narration_tts / metadata
     (language = lang) so it renders in that language. "Identical pipeline."
   - generate a BANNER with the country flag softly filling the background
     (`generateFlagBanner`). avatar stays the base image.
   - status "draft" until its YouTube channel is connected.
   - group = {groupId: base._id, language: lang, role: "sibling"}.
3. UI: "Make multi-language" button on the channel Settings tab → /api/make-multilingual.
   Group siblings shown on the base channel.

Each sibling is already a working localized channel (full independent render in its
language) even before Phase 2 — Phase 2 only makes it efficient.

## Phase 2 — render-group reuse

Base run emits an **asset bundle** to R2 (footageClips, keyframes, music, thumbnail
base, sourceScript, sentence timings). After the base render + upload, fan out a
`finish-language` job per sibling:
- translate the base script → target language (Gemini), preserving structure/beats.
- Fish TTS in target language (per-language voice from the catalog).
- RE-ASSEMBLE the timeline reusing the cached footage/keyframes/music, re-cut to the
  new narration timing (operator chose perfect sync over a locked timeline).
- burn localized captions + re-render localized text/quote cards.
- localized metadata (title/desc/tags) — already localized by the metadata block.
- upload to the sibling's YouTube channel.
Reuses ~90% of cost/time (Higgsfield/Topaz/Pexels/Mureka run once); each language ≈
Fish TTS + Gemini + ffmpeg + upload.

Non-narrated (lofi/sleep): the rendered video is identical across languages → only
localized metadata + optional localized title card. Near-free.

Constraint: on-screen text (intro title, quote cards, captions) is NEVER baked into
the shared visual master — overlaid per language at finishing. Our pipeline already
separates these.

## Phase 3 — browser-automation channel creation

Stagehand + Browserbase (Music House → DistroKid pattern) drives the Google account
UI: create Brand Account channel → name it → then OAuth-connect it to our app and
auto-wire banner/branding. Risk: Google bot detection (captcha/phone verify) may
block headless creation; if so, fall back to assisted (operator creates the Brand
Account, one-click OAuth connect, we auto-wire the rest). Per-channel refresh tokens
already supported (convex/youtubeAuth.ts setForChannel).
