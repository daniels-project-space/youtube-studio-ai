// The local CLI profile is used only to deploy. Runtime environment values are
// restricted by trigger.config.ts to this workshop's database identity.
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const dotenv = require("dotenv");
const root = path.resolve(__dirname, "..");
const configPath = "/etc/youtube-studio-workshop/trigger-worker.env";
const stat = fs.statSync(configPath);
if (process.getuid?.() !== 0 || stat.uid !== 0 || (stat.mode & 0o077)) throw new Error("Workshop worker configuration is not private");
const local = dotenv.parse(fs.readFileSync(configPath));
if (local.YOUTUBE_STUDIO_WORKSHOP_TRIGGER_LOCAL !== "1" || local.TRIGGER_PROJECT_REF !== "proj_dqyvctmalaifbqvylvfm" || local.TRIGGER_API_URL !== "http://127.0.0.1:39400") {
  throw new Error("Refusing to deploy outside the local Studio project");
}
const env = { PATH: process.env.PATH, DOCKER_CONFIG: "/var/lib/youtube-automation/dockerconfig", BUILDX_BUILDER: "youtube-automation-trigger", ...local };
const args = ["deploy", "--env", "prod", "--local-build", "--builder", "youtube-automation-trigger", "--network", "host", "--env-file", configPath, "--profile", "youtube-automation-local", "--api-url", "http://127.0.0.1:39400", "--skip-update-check", "--skip-telemetry"];
const child = spawn(path.join(root, "node_modules/.bin/trigger"), args, { cwd: root, env, stdio: "inherit" });
child.on("error", () => { console.error("Could not start the local workshop worker deploy"); process.exitCode = 1; });
child.on("exit", code => { process.exitCode = code ?? 1; });
