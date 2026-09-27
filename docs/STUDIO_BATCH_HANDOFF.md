# Render Engine weekly batch handoff

Render Engine reads a ready weekly batch through Studio's narrow server-side
broker:

```http
GET /api/internal/render-engine/studio-batch-handoff?batchId=<plan batch id>
Authorization: Bearer <STUDIO_RENDER_BATCH_BROKER_TOKEN>
```

A successful response is `{ "handoff": <plan-batch-handoff/v1> }`. A missing
or not-ready batch returns `404` with `{"error":"handoff_not_ready"}`. The
response is private and non-cacheable. Studio derives the owner from
`STUDIO_RENDER_BATCH_OWNER_ID`, calls its existing owner-bound Convex query
using Studio's own short-lived service JWT, and returns only that query's frozen
handoff snapshot. Render Engine receives neither the Studio Convex JWT nor its
ES256 signing key. The broker bearer cannot authorize other Studio routes.

Configure these values only in trusted server environments:

| Setting | Environment | Purpose |
| --- | --- | --- |
| `STUDIO_RENDER_BATCH_BROKER_TOKEN` | Studio | Dedicated random bearer accepted only by this broker route |
| `STUDIO_BATCH_BROKER_TOKEN` | Render Engine | Same dedicated broker bearer, under the consumer's environment name |
| `STUDIO_RENDER_BATCH_OWNER_ID` | Studio | Fixed owner passed to the existing batch query |
| `NEXT_PUBLIC_CONVEX_URL` | Studio | Existing Studio Convex deployment URL |
| `STUDIO_CONVEX_JWT_PRIVATE_KEY` | Studio | Existing Studio-only signing key used internally by `StudioConvexHttpClient` |

Studio R2 read access is separate. Render Engine also needs the Studio R2
endpoint, bucket, and a read-capable R2 key to fetch and verify the preparation
objects referenced by the handoff. Keep those credentials server-side and
scoped to the Studio bucket.
