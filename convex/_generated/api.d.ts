/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as analytics from "../analytics.js";
import type * as assets from "../assets.js";
import type * as channels from "../channels.js";
import type * as competitors from "../competitors.js";
import type * as contentPlan from "../contentPlan.js";
import type * as folders from "../folders.js";
import type * as runLogs from "../runLogs.js";
import type * as runStages from "../runStages.js";
import type * as runs from "../runs.js";
import type * as seo from "../seo.js";
import type * as topicMemory from "../topicMemory.js";
import type * as videos from "../videos.js";
import type * as youtubeAuth from "../youtubeAuth.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  analytics: typeof analytics;
  assets: typeof assets;
  channels: typeof channels;
  competitors: typeof competitors;
  contentPlan: typeof contentPlan;
  folders: typeof folders;
  runLogs: typeof runLogs;
  runStages: typeof runStages;
  runs: typeof runs;
  seo: typeof seo;
  topicMemory: typeof topicMemory;
  videos: typeof videos;
  youtubeAuth: typeof youtubeAuth;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
