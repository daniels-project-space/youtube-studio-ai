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
| Pipeline execution | Trigger.dev (+ a local GPU host for `upscale`) | `NEXT_PUBLIC_CONVEX_URL` must match the web layer |
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

## How to deploy Convex functions/schema (correct)

Deploy to the **dev** deployment that the app reads. Non-interactive:

```bash
# pull account token from the vault
TOKEN=$(curl -s -X POST 'https://fantastic-roadrunner-485.convex.cloud/api/query' \
  -H 'Content-Type: application/json' \
  -d '{"path":"secrets:getOne","args":{"service":"convex","keyName":"CONVEX_ACCESS_TOKEN"},"format":"json"}' \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).value.value))')

CONVEX_DEPLOYMENT=dev:astute-camel-689 CONVEX_OVERRIDE_ACCESS_TOKEN=$TOKEN \
  npx convex dev --once --typecheck=disable
```

Do **NOT** run bare `npx convex deploy` — it targets the ghost.

## Clobber guard (local development)

`npx convex dev` (watch mode) pushes local function/schema edits to whatever
`CONVEX_DEPLOYMENT` selects. Since the canonical deployment holds live data,
**never point a casual local `convex dev` at `astute-camel-689`** unless you
intend to change production. For throwaway experiments, create a personal dev
deployment instead (`npx convex dev --configure=new`).

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
