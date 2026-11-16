import assert from "node:assert/strict";
import { GET } from "./route";

async function main() {
  const savedGit = process.env.VERCEL_GIT_COMMIT_SHA;
  const savedRelease = process.env.RELEASE_SHA;
  const savedDeployment = process.env.VERCEL_DEPLOYMENT_ID;
  try {
    process.env.VERCEL_GIT_COMMIT_SHA = "8b0d8da8759f3e65895f847df710b19a88656f92";
    process.env.RELEASE_SHA = "  02ab00ff4d9983f37ffc178bdd73788d836ad685  ";
    process.env.VERCEL_DEPLOYMENT_ID = "deployment-fallback";
    assert.equal((await GET()).headers.get("cache-control"), "no-store, max-age=0");
    const releaseResponse = await GET();
    const releaseBody = await releaseResponse.json() as { revision: string; deploymentId: string | null };
    assert.equal(releaseBody.revision, "8b0d8da8759f3e65895f847df710b19a88656f92");
    assert.equal(releaseBody.deploymentId, "deployment-fallback");

    process.env.VERCEL_GIT_COMMIT_SHA = "02ab00ff4d9983f37ffc178bdd73788d836ad685";
    process.env.RELEASE_SHA = "  8b0d8da8759f3e65895f847df710b19a88656f92  ";
    assert.equal((await (await GET()).json() as { revision: string }).revision, "02ab00ff4d9983f37ffc178bdd73788d836ad685");

    process.env.VERCEL_GIT_COMMIT_SHA = "";
    assert.equal((await (await GET()).json() as { revision: string }).revision, "unknown");

    process.env.VERCEL_DEPLOYMENT_ID = "";
    assert.equal((await (await GET()).json() as { revision: string; deploymentId: string | null }).revision, "unknown");
    assert.equal((await (await GET()).json() as { deploymentId: string | null }).deploymentId, null);

    assert.equal((await (await GET()).json() as { revision: string }).revision, "unknown");
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
