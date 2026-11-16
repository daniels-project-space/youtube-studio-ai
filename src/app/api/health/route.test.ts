import assert from "node:assert/strict";
import { GET } from "./route";

async function main() {
  const savedGit = process.env.VERCEL_GIT_COMMIT_SHA;
  const savedRelease = process.env.RELEASE_SHA;
  const savedReleaseDeployment = process.env.RELEASE_DEPLOYMENT_ID;
  const savedDeployment = process.env.VERCEL_DEPLOYMENT_ID;
  try {
    process.env.VERCEL_GIT_COMMIT_SHA = "02ab00ff4d9983f37ffc178bdd73788d836ad685";
    process.env.RELEASE_SHA = "  0d066a1f309f6e7b758e79ab0cf06462705a5037  ";
    process.env.RELEASE_DEPLOYMENT_ID = "build-deployment";
    process.env.VERCEL_DEPLOYMENT_ID = "deployment-fallback";
    assert.equal((await GET()).headers.get("cache-control"), "no-store, max-age=0");
    const releaseResponse = await GET();
    const releaseBody = await releaseResponse.json() as {
      revision: string;
      revisionSource: string;
      deploymentId: string | null;
    };
    assert.equal(releaseBody.revision, "0d066a1f309f6e7b758e79ab0cf06462705a5037");
    assert.equal(releaseBody.revisionSource, "build");
    assert.equal(releaseBody.deploymentId, "build-deployment");

    process.env.VERCEL_GIT_COMMIT_SHA = "02ab00ff4d9983f37ffc178bdd73788d836ad685";
    process.env.RELEASE_SHA = "   ";
    delete process.env.RELEASE_DEPLOYMENT_ID;
    const runtimeBody = await (await GET()).json() as { revision: string; revisionSource: string };
    assert.equal(runtimeBody.revision, "02ab00ff4d9983f37ffc178bdd73788d836ad685");
    assert.equal(runtimeBody.revisionSource, "runtime");

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
    if (savedReleaseDeployment === undefined) delete process.env.RELEASE_DEPLOYMENT_ID;
    else process.env.RELEASE_DEPLOYMENT_ID = savedReleaseDeployment;
    if (savedDeployment === undefined) delete process.env.VERCEL_DEPLOYMENT_ID;
    else process.env.VERCEL_DEPLOYMENT_ID = savedDeployment;
  }
}

void main();
