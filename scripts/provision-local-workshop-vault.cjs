// Provision only the services needed by Studio's local worker. Provider keys
// are injected by ai-vault and never printed or written into the repository.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const dir = "/etc/youtube-studio-workshop";
const worker = `${dir}/trigger-worker.env`, web = `${dir}/web.env`, snapshot = `${dir}/local-vault.json`;
const secretPath = `${dir}/internal-query-secret`, secretEnv = `${dir}/internal-query-secret.env`;
if (process.getuid?.() !== 0 || [snapshot, secretPath, secretEnv].some(fs.existsSync)) throw new Error("Local Studio vault targets already exist or root is required");
for (const file of [worker, web, `${dir}/r2-broker.json`, `${dir}/convex-admin-key`]) {
  const stat = fs.statSync(file);
  if (stat.uid !== 0 || (stat.mode & 0o077)) throw new Error("Local Studio configuration is not private");
}
const required = ["YTS_OPENROUTER", "YTS_PEXELS", "YTS_PIXABAY"];
if (required.some(key => !process.env[key])) throw new Error("Required scoped provider credentials were not injected");
for (const file of [worker, web]) {
  if (fs.readFileSync(file, "utf8").split("\n").some(line => /^(YTS_LOCAL_VAULT_JSON|INTERNAL_QUERY_SECRET)=/.test(line))) throw new Error("Local Studio vault configuration already exists");
}
const env = { ...process.env, CONVEX_SELF_HOSTED_URL: "http://127.0.0.1:39420",
  CONVEX_SELF_HOSTED_ADMIN_KEY: fs.readFileSync(`${dir}/convex-admin-key`, "utf8").trim(), CI: "1", DISABLE_TELEMETRY: "1" };
delete env.CONVEX_DEPLOYMENT; delete env.CONVEX_DEPLOY_KEY;
const cli = path.join(root, "node_modules/.bin/convex");
const get = () => spawnSync(cli, ["env", "get", "INTERNAL_QUERY_SECRET"], { cwd: root, env, encoding: "utf8" });
const before = get();
if (before.status !== 0 || before.stdout.trim() || !before.stderr.includes('not found')) throw new Error("Studio backend internal secret is already set or cannot be checked");
const secret = crypto.randomBytes(32).toString("hex");
fs.writeFileSync(secretPath, secret, { mode: 0o600, flag: "wx" });
fs.writeFileSync(secretEnv, `INTERNAL_QUERY_SECRET=${secret}\n`, { mode: 0o600, flag: "wx" });
const set = spawnSync(cli, ["env", "set", "INTERNAL_QUERY_SECRET", "--from-file", secretPath], { cwd: root, env, encoding: "utf8" });
if (set.status !== 0) throw new Error("Could not configure Studio backend internal secret; private bootstrap retained");
const after = get();
if (after.status !== 0 || after.stdout.trim() !== secret) throw new Error("Studio backend internal secret did not verify");
const account = JSON.parse(fs.readFileSync(`${dir}/r2-broker.json`, "utf8")).accountId;
const data = { youtube: { INTERNAL_QUERY_SECRET: secret }, openrouter: { OPENROUTER_API_KEY: process.env.YTS_OPENROUTER },
  pexels: { PEXELS_API_KEY: process.env.YTS_PEXELS }, pixabay: { PIXABAY_API_KEY: process.env.YTS_PIXABAY },
  cloudflare: { R2_ACCOUNT_ID: account, R2_BUCKET: "youtube-studio-ai-private" } };
const json = JSON.stringify(data);
fs.writeFileSync(snapshot, json, { mode: 0o600, flag: "wx" });
const settings = `YTS_LOCAL_VAULT_JSON='uri:${encodeURIComponent(json)}'\nINTERNAL_QUERY_SECRET='${secret}'\n`;
for (const file of [worker, web]) { const fd = fs.openSync(file, "a"); try { fs.writeFileSync(fd, settings); fs.fsyncSync(fd); } finally { fs.closeSync(fd); } }
console.log("Studio local vault snapshot and separate backend secret provisioned and verified");
