import { defineConfig } from "@trigger.dev/sdk";
import { ffmpeg, additionalPackages } from "@trigger.dev/build/extensions/core";

/**
 * Trigger.dev config for YouTube Studio AI.
 *
 * - project ref is the app's OWN Trigger project (not shared platform-jobs).
 *   It can be overridden via TRIGGER_PROJECT_REF for portability; the default
 *   is the provisioned ref for daniels-project-space-be0b.
 * - ffmpeg build extension bakes ffmpeg into the task image so the future
 *   `assemble` / `qa_light` blocks can stream_loop + ffprobe without extra setup.
 * - @higgsfield/cli is baked into the image (its postinstall pulls the
 *   linux/amd64 binary). This is what frees keyframes/loop_clips from the
 *   hand-authed VPS: the CLI runs in the cloud task and authenticates from an
 *   injected credentials.json (see src/lib/bootstrap.ts) using your SUBSCRIPTION
 *   credits — not the separate, empty platform API-key pool.
 */
export default defineConfig({
  project: process.env.TRIGGER_PROJECT_REF ?? "proj_vorkjqmnnpkzoiqqgbuu",
  dirs: ["./src/trigger"],
  build: {
    extensions: [ffmpeg(), additionalPackages({ packages: ["@higgsfield/cli@0.1.40"] })],
  },
  maxDuration: 3600, // 1h ceiling; raised per-task for long renders in P2.
});
