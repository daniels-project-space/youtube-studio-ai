import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  nextUploadOffset,
  uploadPrivateDraft,
  type YouTubeUploadCheckpoint,
} from "@/lib/youtube";

async function main() {
  assert.equal(nextUploadOffset(null, 100), 0);
  assert.equal(nextUploadOffset("bytes=0-49", 100), 50);
  assert.throws(() => nextUploadOffset("bytes=50-60", 100), /invalid/);

  const directory = await mkdtemp(join(tmpdir(), "ysa-youtube-upload-"));
  const filePath = join(directory, "video.mp4");
  const fileSize = 600 * 1024;
  await writeFile(filePath, Buffer.alloc(fileSize, 7));
  const sessionUrl =
    "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&upload_id=test";
  const publishAt = "2026-08-07T12:00:00.000Z";
  let checkpoint: YouTubeUploadCheckpoint | undefined;
  const firstRanges: string[] = [];
  let firstCall = 0;
  const firstFetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    firstCall += 1;
    if (firstCall === 1) {
      const metadata = JSON.parse(String(init?.body)) as {
        status?: {
          containsSyntheticMedia?: boolean;
          privacyStatus?: string;
          publishAt?: string;
        };
      };
      assert.equal(metadata.status?.containsSyntheticMedia, true);
      assert.equal(metadata.status?.privacyStatus, "private");
      assert.equal(metadata.status?.publishAt, publishAt);
      return new Response(null, { status: 200, headers: { location: sessionUrl } });
    }
    if (firstCall === 2) {
      assert.equal(new Headers(init?.headers).get("content-range"), `bytes */${fileSize}`);
      return new Response(null, { status: 308 });
    }
    const range = new Headers(init?.headers).get("content-range") ?? "";
    firstRanges.push(range);
    if (firstRanges.length === 1) {
      return new Response(null, { status: 308, headers: { range: "bytes=0-262143" } });
    }
    return new Response("permanent test interruption", { status: 400 });
  }) as typeof fetch;

  try {
    await assert.rejects(
      () =>
        uploadPrivateDraft({
          filePath,
          title: "Resumable test",
          description: "test",
          tags: [],
          privacyStatus: "public",
          publishAt,
          refreshToken: "not-used",
          chunkSizeBytes: 256 * 1024,
          accessTokenProvider: async () => "access-token",
          fetchImpl: firstFetch,
          onCheckpoint: async (value) => {
            checkpoint = value;
          },
        }),
      /permanent test interruption/,
    );
    assert.equal(firstRanges[0], `bytes 0-262143/${fileSize}`);
    assert.equal(checkpoint?.uploadedBytes, 262144);

    const resumedRanges: string[] = [];
    let resumedCall = 0;
    const resumedFetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      resumedCall += 1;
      if (resumedCall === 1) {
        assert.equal(new Headers(init?.headers).get("content-range"), `bytes */${fileSize}`);
        return new Response(null, { status: 308, headers: { range: "bytes=0-262143" } });
      }
      const range = new Headers(init?.headers).get("content-range") ?? "";
      resumedRanges.push(range);
      if (resumedRanges.length === 1) {
        return new Response(null, { status: 308, headers: { range: "bytes=0-524287" } });
      }
      return Response.json(
        { id: "video-resumed", status: { privacyStatus: "private" } },
        { status: 201 },
      );
    }) as typeof fetch;

    const result = await uploadPrivateDraft({
      filePath,
      title: "Resumable test",
      description: "test",
      tags: [],
      privacyStatus: "public",
      publishAt,
      refreshToken: "not-used",
      chunkSizeBytes: 256 * 1024,
      accessTokenProvider: async () => "access-token",
      fetchImpl: resumedFetch,
      resumeCheckpoint: checkpoint,
      onCheckpoint: async (value) => {
        checkpoint = value;
      },
    });
    assert.equal(result.videoId, "video-resumed");
    assert.deepEqual(resumedRanges, [
      `bytes 262144-524287/${fileSize}`,
      `bytes 524288-${fileSize - 1}/${fileSize}`,
    ]);
    assert.equal(resumedCall, 3, "resume must reuse the existing session instead of POSTing metadata again");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }

  console.log("YouTube resumable upload tests passed");
}

void main();
