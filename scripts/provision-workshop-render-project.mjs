import { writeFileSync, existsSync } from "node:fs";

const base = "https://hyper-render-api.87.106.233.113.nip.io";
const directory = "/etc/youtube-studio-workshop";
const secretFile = `${directory}/hrs-project-token.env`;
const metadataFile = `${directory}/hrs-project.json`;
if (process.getuid?.() !== 0 || !process.env.HRS_ADMIN || existsSync(secretFile) || existsSync(metadataFile)) {
  throw new Error("Workshop project configuration already exists or the admin credential is unavailable");
}
const response = await fetch(`${base}/api/v1/projects/onboard`, {
  method: "POST", redirect: "error", signal: AbortSignal.timeout(30_000),
  headers: { authorization: `Bearer ${process.env.HRS_ADMIN}`, "content-type": "application/json" },
  body: JSON.stringify({ service: "other", projectKey: "youtube-studio-workshop", externalId: "youtube-studio-workshop-vps",
    name: "YouTube Studio AI workshop", outputBucket: "youtube-studio-ai-private", clientKey: "youtube-studio-workshop" }),
});
if (!response.ok) throw new Error(`Workshop render project onboarding failed (HTTP ${response.status})`);
const body = await response.json();
const token = body?.integration?.token, project = body?.project;
if (typeof token !== "string" || !/^[A-Za-z0-9_-]+$/.test(token) ||
    typeof project?.id !== "string" || !/^[a-f0-9-]{36}$/i.test(project.id) ||
    project.output?.bucket !== "youtube-studio-ai-private" || project.output?.prefix !== "projects/youtube-studio-workshop/") {
  throw new Error("Workshop render project returned an unexpected identity or output destination");
}
const self = await fetch(`${base}/api/v1/projects/self`, {
  headers: { authorization: `Bearer ${token}` }, redirect: "error", signal: AbortSignal.timeout(15_000),
});
if (!self.ok) throw new Error(`Workshop project credential verification failed (HTTP ${self.status})`);
const checked = (await self.json())?.project;
if (checked?.id !== project.id || checked?.output?.bucket !== project.output.bucket || checked?.output?.prefix !== project.output.prefix) {
  throw new Error("Workshop project credential does not match its output destination");
}
writeFileSync(secretFile, `HRS_YOUTUBE_PROJECT_TOKEN=${token}\n`, { mode: 0o600, flag: "wx" });
writeFileSync(metadataFile, JSON.stringify({ id: project.id, slug: project.slug, output: project.output, baseUrl: base }), { mode: 0o600, flag: "wx" });
console.log(`Workshop render identity ${project.id} verified for its isolated output prefix; no job submitted`);
