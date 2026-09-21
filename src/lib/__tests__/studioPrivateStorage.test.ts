import assert from "node:assert/strict";
import { getStudioPrivateBucket } from "../studioPrivateStorage";

const original = { private: process.env.R2_PRIVATE_BUCKET, public: process.env.R2_BUCKET };
try {
  delete process.env.R2_PRIVATE_BUCKET;
  process.env.R2_BUCKET = "youtube-studio-ai";
  assert.equal(getStudioPrivateBucket(), "youtube-studio-ai-private");
  process.env.R2_PRIVATE_BUCKET = "isolated-preview-private";
  assert.equal(getStudioPrivateBucket(), "isolated-preview-private");
  for (const value of ["", "youtube-studio-ai", "../public", " bucket ", "https://public.invalid", "UPPER"]) {
    process.env.R2_PRIVATE_BUCKET = value;
    assert.throws(getStudioPrivateBucket, /Invalid private Studio/);
  }
  process.env.R2_BUCKET = "isolated-preview-private";
  process.env.R2_PRIVATE_BUCKET = "isolated-preview-private";
  assert.throws(getStudioPrivateBucket, /Invalid private Studio/);
  delete process.env.R2_PRIVATE_BUCKET;
  process.env.R2_BUCKET = "youtube-studio-ai-private";
  assert.throws(getStudioPrivateBucket, /Invalid private Studio/);
  console.log("Private storage routing: default, override and public-bucket refusal passed");
} finally {
  for (const [key, value] of [["R2_PRIVATE_BUCKET", original.private], ["R2_BUCKET", original.public]]) {
    if (value === undefined) delete process.env[key!]; else process.env[key!] = value;
  }
}
