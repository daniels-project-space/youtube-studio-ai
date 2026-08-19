# Deployment topology (authoritative)

> This file exists because the deployment topology was previously tribal
> knowledge living only in a gitignored `.env.local`. That ambiguity is how a
> split-brain happens. This is the single source of truth. Keep it current.

## TL;DR

| Layer | Canonical target | Notes |
| --- | --- | --- |
| Convex (data + functions) | **`astute-camel-689`** (the *dev* deployment) | Holds ALL production data. Read by Vercel + Trigger. |
| Convex prod deployment | `giddy-spoonbill-697` | **GHOST — empty, unused. Do not deploy here.** |
| Web (Next.js) | Vercel project `youtube-studio-ai` (`prj_K8iJhhApJiVyB4Fk7Tv4AvDq7Hkm`, team `team_VY2PwHgXLV9Bo0vs2iXdnGxw`) | `NEXT_PUBLIC_CONVEX_URL` → `https://astute-camel-689.convex.cloud` |
| Pipeline execution | Trigger.dev cloud (remote builds and task workers) | Cloud-only; no VPS/local renderer. `NEXT_PUBLIC_CONVEX_URL` must match the web layer. |
| Media | Cloudflare R2 bucket `youtube-studio-ai` | creds in vault `service:cloudflare` |
| Secrets | project-hub vault (`fantastic-roadrunner-485.convex.cloud`, `secrets` table) | never commit secrets |

## The trap (why `convex deploy` is wrong here)

Convex projects have one *prod* deployment and N *dev* deployments. For this
project the data landed on the **dev** deployment (`astute-camel-689`) and the
app was wired to read it. The *prod* deployment (`giddy-spoonbill-697`) was
never populated.

Consequence: **`npx convex deploy` pushes to `giddy-spoonbill-697` — the empty
ghost — and silently does nothing useful.** Function/schema changes never reach
the deployment the app actually reads. This is the same class of bug as the
rental-manager-v2 split-brain incident.

## Cloud-only runtime deployment via GitHub

The `CI` workflow is the canonical release path:

```text
merge/push main → CI quality gate → credential preflight →
Convex dev:astute-camel-689 → Trigger production remote build
```

The two runtime deployments are automatic after CI passes and do not use a
local machine, VPS, or local Docker build. Convex is deliberately deployed
first because Trigger tasks call its functions.

Before the job can deploy, add these GitHub **Production** environment secrets:

| Secret | Required value | Scope |
| --- | --- | --- |
| `CONVEX_DEPLOY_KEY` | A least-privilege Convex deploy key explicitly scoped to `astute-camel-689` | Convex code/schema deployment only |
| `TRIGGER_ACCESS_TOKEN` | Trigger.dev CI access token for project `proj_vorkjqmnnpkzoiqqgbuu` | Trigger task deployment only |

The job invokes `npx convex dev --once` with the scoped deploy key. It must
never invoke bare `npx convex deploy`, which would target the ghost deployment.
After adding the secrets, use **Run workflow** on `main` once to deploy the
current runtime; future trusted `main` pushes deploy automatically.

If either credential is absent, the workflow reports **Cloud runtime deployment
held** and skips both deploys. That is intentional: Vercel may still deploy the
web app, but a green web deployment is never presented as a deployed runtime.

### Trigger runtime configuration

The GitHub job uses `--skip-sync-env-vars` so an empty GitHub runner cannot
erase or replace the protected Trigger Production environment. Maintain the
runtime values in Trigger (or later connect a dedicated cloud secret manager).
For the 4090-only cinematic control plane, the required new values are:

- Secrets: `NOVITA_API_KEY`, `NOVITA_RENDER_WORKER_IMAGE`,
  `NOVITA_RENDER_IMAGE_AUTH_ID`, `INTERNAL_QUERY_SECRET`, and
  `STUDIO_CONVEX_JWT_PRIVATE_KEY`.
- Configuration: `NOVITA_RENDER_4090_PRODUCT_ID`,
  `NOVITA_VERIFIED_4090_GPU_QUOTA`, `NOVITA_MODEL_MANIFEST_KEY`,
  `NOVITA_MODEL_MANIFEST_SHA256`, `NOVITA_RENDER_MAX_JOB_USD`, and
  `NOVITA_RENDER_MAX_FLEET_USD`.

`INTERNAL_QUERY_SECRET` must match the Convex runtime value. The Novita key
never belongs in Vercel. The automatic controller remains fail-closed until a
provider-attested single RTX 4090, registry image, persistent model manifest,
and verified teardown configuration are all present.

### LTX activation guard

The currently pinned LTX-2.3 video profile requires at least 32 GB VRAM, while
the mandated RTX 4090 has 24 GB. Video generation is therefore intentionally
disabled until a separately cloud-benchmarked, pinned 4090-compatible LTX
worker/profile is available. Deployment alone must not launch a paid GPU or
silently lower the quality bar.

## Clobber guard

The canonical deployment holds live data. Do not run a casual local/VPS
`convex dev` against it; GitHub Actions is the only approved runtime deployment
source. For experiments, create an isolated personal Convex dev deployment.

## Canonical references

- `NEXT_PUBLIC_CONVEX_URL_YOUTUBE_STUDIO` = `https://astute-camel-689.convex.cloud`
- `CONVEX_DEPLOYMENT_YOUTUBE_STUDIO` = `dev:astute-camel-689`

> These should also live in the project-hub vault under `service:convex`
> (mirroring the `*_RMV2` keys) for automation. As of 2026-06-02 the vault
> `secrets:bulkInsert` mutation returns a server error on write (reads still
> work) — mutations appear to have been locked down since the vault was last
> used for writes. Add these via the dashboard or once writes are restored.

## If you ever want a "real" prod deployment (optional, not required)

Single-operator does not need this. If multi-tenant SaaS later demands a clean
prod/dev split, migrate rather than improvise:

1. `CONVEX_DEPLOYMENT=dev:astute-camel-689 npx convex export --path dump.zip`
2. Deploy functions to prod: `npx convex deploy` (targets `giddy-spoonbill-697`).
3. `npx convex import --prod dump.zip` (preserves `_id`s and references).
4. Repoint `NEXT_PUBLIC_CONVEX_URL` on **both** Vercel and Trigger to the prod URL.
5. Do it in a maintenance window — writes during the copy will diverge.

Until then, `giddy-spoonbill-697` stays an intentional no-op. Consider deleting
it from the Convex dashboard to remove the trap entirely.
