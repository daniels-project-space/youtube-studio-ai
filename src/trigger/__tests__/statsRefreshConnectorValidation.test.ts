import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  connectorNeedsLiveRevalidation,
  connectorScopeHealth,
  isRevokedYouTubeRefreshGrant,
} from "../statsRefresh";
import { YouTubeError } from "@/lib/youtube";

const requiredScopes = [
  "https://www.googleapis.com/auth/youtube",
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube.force-ssl",
  "https://www.googleapis.com/auth/youtube.readonly",
  "https://www.googleapis.com/auth/yt-analytics.readonly",
];

assert.equal(connectorScopeHealth([]), "unknown");
assert.equal(connectorScopeHealth(requiredScopes.slice(0, -1)), "partial");
assert.equal(connectorScopeHealth(requiredScopes), "healthy");

const now = 2_000_000_000_000;
assert.equal(
  connectorNeedsLiveRevalidation({ scopeHealth: "healthy", validatedAt: now - (23 * 60 * 60 * 1000), now }),
  false,
  "a recently validated healthy connector must reuse its bounded live grant",
);
assert.equal(
  connectorNeedsLiveRevalidation({ scopeHealth: "healthy", validatedAt: now - (24 * 60 * 60 * 1000), now }),
  true,
  "a stale healthy connector must re-prove the exact YouTube destination",
);
assert.equal(
  connectorNeedsLiveRevalidation({ scopeHealth: "unknown", validatedAt: now, now }),
  true,
  "an unverified legacy scope record must receive a real validation opportunity",
);
assert.equal(
  isRevokedYouTubeRefreshGrant(new YouTubeError("token refresh failed: invalid_grant token expired")),
  true,
);
assert.equal(
  isRevokedYouTubeRefreshGrant(new YouTubeError("token refresh failed: invalid_client configuration")),
  false,
  "provider configuration errors must not falsely quarantine a channel connector",
);

const root = process.cwd();
const task = readFileSync(join(root, "src/trigger/statsRefresh.ts"), "utf8");
const data = readFileSync(join(root, "src/lib/youtubeData.ts"), "utf8");
assert.match(task, /requireYouTubeConnector\(convex, \{ channelId, ownerId \}\)/);
assert.match(task, /const liveConnector = await validateStatsConnector\([\s\S]*?\);[\s\S]*?if \(liveConnector\.action !== "ready"\)/);
assert.match(task, /accessToken: liveConnector\.accessToken/);
assert.doesNotMatch(task, /refreshToken: connector\.refreshToken/);
assert.match(data, /if \(access\.accessToken\) \{[\s\S]*?headers\.Authorization = `Bearer \$\{access\.accessToken\}`;[\s\S]*?\} else if \(access\.refreshToken\)/);

console.log("Stats-refresh connector validation and token-reuse contracts passed");
