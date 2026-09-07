<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Owner module locks

Before changing repository files, inspect `.locks/*.lock`. Each marker lists
repo-relative protected paths before its JSON record. If a target matches one,
do not modify it in this or another worktree, do not remove filesystem immutable
flags, and do not bypass the lock through Git plumbing. Only an explicit owner
unlock in the Studio UI is authority to proceed; `scripts/sync-owner-locks.ts`
will mirror that decision and release the files. Never modify `.locks`, the
external guard, or the mirror service to work around a lock.
