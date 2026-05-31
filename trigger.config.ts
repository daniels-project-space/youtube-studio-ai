import { defineConfig } from "@trigger.dev/sdk";
import { ffmpeg } from "@trigger.dev/build/extensions/core";

/**
 * Trigger.dev config for YouTube Studio AI.
 *
 * - project ref is the app's OWN Trigger project (not shared platform-jobs).
 *   It can be overridden via TRIGGER_PROJECT_REF for portability; the default
 *   is the provisioned ref for daniels-project-space-be0b.
 * - ffmpeg build extension bakes ffmpeg into the task image so the future
 *   `assemble` / `qa_light` blocks can stream_loop + ffprobe without extra setup.
 */
export default defineConfig({
  project: process.env.TRIGGER_PROJECT_REF ?? "proj_vorkjqmnnpkzoiqqgbuu",
  dirs: ["./src/trigger"],
  build: {
    extensions: [ffmpeg()],
  },
  maxDuration: 3600, // 1h ceiling; raised per-task for long renders in P2.
});
