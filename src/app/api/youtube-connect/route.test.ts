import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { GET } from "./route";

async function main() {
  const endpoint = "https://youtube-studio-ai.vercel.app/api/youtube-connect";
  const missing = await GET(new NextRequest(endpoint));
  assert.equal(missing.status, 400);

  const channelId = "jh75m19d3zv3yxm17z8cv0tw7n7d62vq";
  const unauthenticated = await GET(new NextRequest(`${endpoint}?channelId=${channelId}`));
  assert.equal(unauthenticated.status, 307);
  const location = new URL(unauthenticated.headers.get("location") ?? "");
  assert.equal(location.origin, "https://youtube-studio-ai.vercel.app");
  assert.equal(location.pathname, "/api/operations/authorize");
  assert.equal(location.searchParams.get("channelId"), channelId);
  assert.equal(await unauthenticated.text(), "");

  console.log("YouTube connect owner-continuation tests passed");
}

void main();
