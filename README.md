# YouTube Studio AI

AI-assisted YouTube video production studio.

## Stack

- **Next.js 16** (App Router) + **React 19** + **TypeScript**
- **Tailwind CSS 4**
- **Convex** — isolated cloud deployment (own project, not shared)
- **Cloudflare R2** object storage via the AWS S3 SDK (`src/lib/storage.ts`)
- Deployed on **Vercel** (isolated project)

## Getting Started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Environment

Local env lives in `.env.local` (gitignored). Required keys:

- `NEXT_PUBLIC_CONVEX_URL` — this app's Convex deployment URL
- `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` — Cloudflare R2

## Migration

Legacy audit notes: see [`docs/legacy-audit.md`](docs/legacy-audit.md). First slice is Template C (Lofi).
