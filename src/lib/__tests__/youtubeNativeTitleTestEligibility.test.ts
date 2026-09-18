import assert from "node:assert/strict";

import { getNativeTitleTestEligibility } from "@/lib/youtube";

async function main(): Promise<void> {
  const savedFetch = globalThis.fetch;
  try {
    const requests: Array<{ url: string; authorization: string | null }> = [];
    globalThis.fetch = (async (input, init) => {
      requests.push({
        url: String(input),
        authorization: new Headers(init?.headers).get("authorization"),
      });
      return Response.json({
        items: [
          { id: "eligible", snippet: { channelId: "UC-owner", liveBroadcastContent: "none" }, status: { privacyStatus: "public", madeForKids: false } },
          { id: "private", snippet: { channelId: "UC-owner", liveBroadcastContent: "none" }, status: { privacyStatus: "private", madeForKids: false } },
          { id: "kids", snippet: { channelId: "UC-owner", liveBroadcastContent: "none" }, status: { privacyStatus: "public", madeForKids: true } },
          { id: "live", snippet: { channelId: "UC-owner", liveBroadcastContent: "upcoming" }, status: { privacyStatus: "public", madeForKids: false } },
          { id: "short", snippet: { channelId: "UC-owner", tags: ["#Shorts"] }, status: { privacyStatus: "public", madeForKids: false } },
          { id: "other-channel", snippet: { channelId: "UC-other" }, status: { privacyStatus: "public", madeForKids: false } },
          { id: "incomplete", snippet: { channelId: "UC-owner", liveBroadcastContent: "none" }, status: { privacyStatus: "public" } },
        ],
      });
    }) as typeof fetch;

    const result = await getNativeTitleTestEligibility(
      "access-token",
      ["eligible", "private", "kids", "live", "short", "other-channel", "incomplete", "missing"],
      "UC-owner",
    );
    assert.equal(requests.length, 1, "eligible candidate checks must be batched into one Data API read");
    assert.match(requests[0]!.url, /part=snippet%2Cstatus/);
    assert.equal(requests[0]!.authorization, "Bearer access-token");
    assert.equal(result.get("eligible")?.eligible, true);
    assert.match(result.get("private")?.reason ?? "", /private/i);
    assert.match(result.get("kids")?.reason ?? "", /kids/i);
    assert.match(result.get("live")?.reason ?? "", /live or upcoming/i);
    assert.match(result.get("short")?.reason ?? "", /Shorts/i);
    assert.match(result.get("other-channel")?.reason ?? "", /different channel/i);
    assert.match(result.get("incomplete")?.reason ?? "", /made-for-kids state/i);
    assert.match(result.get("missing")?.reason ?? "", /did not return/i);
  } finally {
    globalThis.fetch = savedFetch;
  }
}

void main().then(() => {
  console.log("YouTube native title-test eligibility adapter passed");
});
