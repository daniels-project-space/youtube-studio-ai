# Secrets & API keys

**Values are NOT in git.** This documents *what* keys exist, *what* each unlocks,
and *where/how* they are stored. The machine-readable source of truth is
[`src/agents/keyRegistry.ts`](../src/agents/keyRegistry.ts) — the Mastra
orchestrator reads it (via the `secrets_status` tool + a preflight in
`orchestrator.ts`) so it knows what it needs before running a module.

## The vaults (where values live), by authority

1. **Trigger.dev PROD env** — the RUNTIME vault the deployed pipeline reads.
   - list/read/write via API (PAT at `/root/.config/trigger/config.json` on the VPS):
     ```
     GET  https://api.trigger.dev/api/v1/projects/$TRIGGER_PROJECT_REF/envvars/prod
     POST https://api.trigger.dev/api/v1/projects/$TRIGGER_PROJECT_REF/envvars/prod
          -d '{"name":"KEY","value":"..."}'
     ```
2. **Convex env** (`dev:astute-camel-689`) — BACKUP. The VPS checkout is authed:
   ```
   npx convex env list
   npx convex env set KEY value
   ```
3. **`.env.local`** (local dev + the VPS checkout) — for local/VPS script runs. Gitignored.

To add a key everywhere: set it in all three (Trigger prod = runtime, Convex =
backup, `.env.local` = local), then add a row to `KEY_REGISTRY` if it's new.

## Keys

| key | tier | unlocks | obtain |
|---|---|---|---|
| `GEMINI_API_KEY` | core | Gemini LLM + Banana image gen | aistudio.google.com |
| `FAL_KEY` | core | fal.ai cutouts / depth / image-to-video | fal.ai/dashboard/keys |
| `TRIGGER_SECRET_KEY` | infra | Trigger.dev task runtime | Trigger dashboard |
| `ELEVENLABS_API_KEY` | feature | ElevenLabs v3 narration (preferred) | elevenlabs.io |
| `FISH_AUDIO_API_KEY` | feature | Fish Audio narration (fallback) | fish.audio |
| `SUNO_API_KEY` | feature | Suno music beds | sunoapi.org (credits: `GET /api/v1/generate/credit`) |
| `MUREKA_API_KEY` | feature | Mureka music beds (paired fallback) | mureka.ai |
| `PEXELS_API_KEY` | feature | Pexels 4K stock video | pexels.com/api |
| `PIXABAY_API_KEY` | feature | Pixabay stock video | pixabay.com/api |
| `VIDEVO_API_KEY` | optional | Videvo stock video | videvo.net |
| `HIGGSFIELD_CREDENTIALS_JSON` | feature | Higgsfield cinematic shot engine | higgsfield.ai |
| `REPLICATE_API_TOKEN` | optional | Replicate model host | replicate.com/account |
| `ASSEMBLYAI_API_KEY` | feature | transcription + forced alignment | assemblyai.com |
| `YOUTUBE_DATA_API_KEY` | feature | YouTube research | Google Cloud console |
| `YOUTUBE_REFRESH_TOKEN` | feature | upload drafts + thumbnails | OAuth offline flow |
| `AYRSHARE_API_KEY` | optional | social cross-posting | ayrshare.com |
| `BROWSERBASE_API_KEY` | optional | headless browser research | browserbase.com |
| `LANGFUSE_SECRET_KEY` / `LANGFUSE_PUBLIC_KEY` | optional | LLM tracing | cloud.langfuse.com |
| `TELEGRAM_BOT_TOKEN` | optional | run notifications | @BotFather |

Run-time presence check: `keyStatus()` / `secretsManifest()` in `keyRegistry.ts`.

## Provider fallbacks (so one missing/limited key doesn't break a run)
- **Narration:** ElevenLabs preferred → Fish fallback (`synthNarration`).
- **Music:** Mureka ↔ Suno automatic fallback (`generateMusic`); either key enables music.
