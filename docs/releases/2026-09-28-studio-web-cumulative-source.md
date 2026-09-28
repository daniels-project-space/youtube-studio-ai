# Studio web release candidate — 2026-09-28

This branch starts at `2ce41a8774cf5730ab033884b8a67816fe58ef11`, the cumulative Studio source used for the restored production Convex deployment. It carries the weekly batch handoff broker and R2 retention work together. The web source currently live at the production Vercel alias is `e788a3efece769c98bcbe7eb9ad6f7b3e6a44501`.

The release candidate adds no runtime changes beyond that cumulative source. The `STUDIO_SCHEDULES_ENABLED` gate remains opt-in, and the Trigger schedule definitions remain without declarative cron settings. A web deployment must not be treated as authorization to promote Trigger tasks, enable schedules, or run the retention sweeper. Those operations require their own reviewed release and live inventory check.

The internal batch broker remains unavailable until its dedicated bearer token and fixed Studio owner ID are configured server-side. The Studio Convex signing key stays in Studio; Render Engine receives only its scoped broker bearer.
