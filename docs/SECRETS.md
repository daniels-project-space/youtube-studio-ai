# Secrets & API keys

**Values are NOT in git.** This documents *what* keys exist, *what* each unlocks,
and *where/how* they are stored. The machine-readable source of truth is
[`src/agents/keyRegistry.ts`](../src/agents/keyRegistry.ts) — the Mastra
orchestrator reads it (via the `secrets_status` tool + a preflight in
`orchestrator.ts`) so it knows what it needs before running a module.

## The vaults (where values live), by authority

1. **GitHub Production environment** — deploy credentials only:
   `CONVEX_DEPLOY_KEY` and `TRIGGER_ACCESS_TOKEN`. The post-CI cloud deployment
   job reads these; it never receives provider/runtime credentials.
2. **Trigger.dev PROD env** — the RUNTIME vault deployed pipeline workers read.
   Manage it in Trigger Cloud or from a protected cloud-admin workflow; never
   use a VPS as a deployment source.
3. **Convex env** (`dev:astute-camel-689`) — runtime values that must agree with
   Trigger (notably `INTERNAL_QUERY_SECRET`).
4. **`.env.local`** — development-only, gitignored. It is not an approved
   deployment source.

To add a runtime key: set it in Trigger prod and any matching Convex runtime
location, then add a row to `KEY_REGISTRY` if it's new. Do not put provider
credentials in GitHub Actions or Vercel merely to deploy code.

## Keys

| key | tier | unlocks | obtain |
|---|---|---|---|
| `GEMINI_API_KEY` | core | Gemini LLM + Banana image gen | aistudio.google.com |
| `CONVEX_DEPLOY_KEY` | infra | GitHub-only deploy key scoped to `astute-camel-689` | Convex dashboard |
| `TRIGGER_ACCESS_TOKEN` | infra | GitHub-only CI token for Trigger task deploys | Trigger.dev dashboard |
| `FAL_KEY` | core | fal.ai cutouts / depth / image-to-video | fal.ai/dashboard/keys |
| `TRIGGER_SECRET_KEY` | infra | Trigger.dev task invocation/runtime (not the CI deploy token) | Trigger dashboard |
| `ELEVENLABS_API_KEY` | feature | ElevenLabs v3 narration (preferred) | elevenlabs.io |
| `FISH_AUDIO_API_KEY` | feature | Fish Audio narration (fallback) | fish.audio |
| `QWEN3_TTS_WORKER_URL` / `QWEN3_TTS_WORKER_TOKEN` | feature | Attested open Qwen3-TTS CustomVoice worker; Trigger runtime only (no generic vault fallback) | protected Novita worker deployment |
| `QWEN3_TTS_QUALITY_QUALIFIED` / `QWEN3_TTS_QUALITY_RECEIPT_SHA256` | safety | Admits Qwen3 production narration only after a reviewed audio benchmark | generated qualification receipt |
| `SUNO_API_KEY` | feature | Suno music beds | sunoapi.org (credits: `GET /api/v1/generate/credit`) |
| `MUREKA_API_KEY` | feature | Mureka music beds (paired fallback) | mureka.ai |
| `MINIMAX_MUSIC3_WORKER_URL` / `MINIMAX_MUSIC3_WORKER_TOKEN` | feature | Pinned MiniMax-Music3 two-GPU Novita worker; explicit provider only | protected Novita worker deployment |
| `MINIMAX_MUSIC3_QUALITY_QUALIFIED` / `MINIMAX_MUSIC3_QUALITY_RECEIPT_SHA256` | safety | Admits the exact Music3 worker only after native-WAV measurement and human audition | generated qualification receipt |
| `MINIMAX_MUSIC3_LICENSE_ATTESTED` / `MINIMAX_MUSIC3_UI_ATTRIBUTION_ENABLED` / `MINIMAX_MUSIC3_DISCLOSURE_ENABLED` / `MINIMAX_MUSIC3_SAFEGUARDS_ATTESTED` | safety | License, prominent `MiniMax-Music3` UI attribution, generated-content disclosure, hosted safeguards, and operator authorization-threshold attestation | operator/legal review plus production UI and policy controls |
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
- **Narration:** provider choice is explicit. ElevenLabs and Fish remain the managed paths; Qwen3-TTS is an open, pinned worker path and never becomes an automatic fallback. It stays production-closed until its exact worker and quality receipt are configured.
- **Music:** Mureka ↔ Suno automatic fallback (`generateMusic`); either key enables managed music. MiniMax-Music3 is an explicit channel-program path and never joins automatic fallback. It remains closed until every worker, quality, license, attribution, disclosure, and safeguards gate passes.
