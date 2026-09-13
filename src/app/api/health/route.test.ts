import assert from "node:assert/strict";
import { GET } from "./route";

async function main() {
  const savedGit = process.env.VERCEL_GIT_COMMIT_SHA;
  const savedRelease = process.env.RELEASE_SHA;
  const savedDeployment = process.env.VERCEL_DEPLOYMENT_ID;
  try {
    process.env.VERCEL_GIT_COMMIT_SHA = "   ";
    process.env.RELEASE_SHA = "  e6273e0  ";
    process.env.VERCEL_DEPLOYMENT_ID = "deployment-fallback";
    assert.equal((await GET()).headers.get("cache-control"), "no-store, max-age=0");
    assert.equal((await (await GET()).json() as { revision: string }).revision, "e6273e0");

    process.env.RELEASE_SHA = "";
    assert.equal((await (await GET()).json() as { revision: string }).revision, "deployment-fallback");

    process.env.VERCEL_DEPLOYMENT_ID = "";
    assert.equal((await (await GET()).json() as { revision: string }).revision, "development");
    console.log("health revision fallback tests passed");
  } finally {
    if (savedGit === undefined) delete process.env.VERCEL_GIT_COMMIT_SHA;
    else process.env.VERCEL_GIT_COMMIT_SHA = savedGit;
    if (savedRelease === undefined) delete process.env.RELEASE_SHA;
    else process.env.RELEASE_SHA = savedRelease;
    if (savedDeployment === undefined) delete process.env.VERCEL_DEPLOYMENT_ID;
    else process.env.VERCEL_DEPLOYMENT_ID = savedDeployment;
  }
}

void main();
