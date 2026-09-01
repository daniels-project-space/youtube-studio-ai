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
import type * as analyticsIngestions from "../analyticsIngestions.js";
import type * as analyticsRefreshCursors from "../analyticsRefreshCursors.js";
import type * as assets from "../assets.js";
import type * as casefileEpisodes from "../casefileEpisodes.js";
import type * as casefileResearchAttempts from "../casefileResearchAttempts.js";
import type * as channelArchives from "../channelArchives.js";
import type * as channelLock from "../channelLock.js";
import type * as channelPublishPolicies from "../channelPublishPolicies.js";
import type * as channels from "../channels.js";
import type * as competitors from "../competitors.js";
import type * as contentPlan from "../contentPlan.js";
import type * as crons from "../crons.js";
import type * as editorialEvidencePackets from "../editorialEvidencePackets.js";
import type * as factualReviewCheckpoints from "../factualReviewCheckpoints.js";
import type * as folders from "../folders.js";
import type * as forgedModules from "../forgedModules.js";
import type * as goals from "../goals.js";
import type * as learningGovernance from "../learningGovernance.js";
import type * as novitaWorkerLeases from "../novitaWorkerLeases.js";
import type * as outlierBank from "../outlierBank.js";
import type * as planWeekRenderReceipts from "../planWeekRenderReceipts.js";
import type * as publishContinuationState from "../publishContinuationState.js";
import type * as publishIntents from "../publishIntents.js";
import type * as reviewedEvidencePacks from "../reviewedEvidencePacks.js";
import type * as runArtifacts from "../runArtifacts.js";
import type * as runArtifactRetentions from "../runArtifactRetentions.js";
import type * as runLogs from "../runLogs.js";
import type * as runStages from "../runStages.js";
import type * as runs from "../runs.js";
import type * as scriptSelfDedupLeases from "../scriptSelfDedupLeases.js";
import type * as seo from "../seo.js";
import type * as serializedProgramEpisodes from "../serializedProgramEpisodes.js";
import type * as seriesStoryState from "../seriesStoryState.js";
import type * as studioFunctions from "../studioFunctions.js";
import type * as topicMemory from "../topicMemory.js";
import type * as videoReleaseProvenance from "../videoReleaseProvenance.js";
import type * as videos from "../videos.js";
import type * as voiceBank from "../voiceBank.js";
import type * as youtubeAuth from "../youtubeAuth.js";
import type * as youtubeCreationClaims from "../youtubeCreationClaims.js";
import type * as youtubeUploads from "../youtubeUploads.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  analytics: typeof analytics;
  analyticsIngestions: typeof analyticsIngestions;
  analyticsRefreshCursors: typeof analyticsRefreshCursors;
  assets: typeof assets;
  casefileEpisodes: typeof casefileEpisodes;
  casefileResearchAttempts: typeof casefileResearchAttempts;
  channelArchives: typeof channelArchives;
  channelLock: typeof channelLock;
  channelPublishPolicies: typeof channelPublishPolicies;
  channels: typeof channels;
  competitors: typeof competitors;
  contentPlan: typeof contentPlan;
  crons: typeof crons;
  editorialEvidencePackets: typeof editorialEvidencePackets;
  factualReviewCheckpoints: typeof factualReviewCheckpoints;
  folders: typeof folders;
  forgedModules: typeof forgedModules;
  goals: typeof goals;
  learningGovernance: typeof learningGovernance;
  novitaWorkerLeases: typeof novitaWorkerLeases;
  outlierBank: typeof outlierBank;
  planWeekRenderReceipts: typeof planWeekRenderReceipts;
  publishContinuationState: typeof publishContinuationState;
  publishIntents: typeof publishIntents;
  reviewedEvidencePacks: typeof reviewedEvidencePacks;
  runArtifacts: typeof runArtifacts;
  runArtifactRetentions: typeof runArtifactRetentions;
  runLogs: typeof runLogs;
  runStages: typeof runStages;
  runs: typeof runs;
  scriptSelfDedupLeases: typeof scriptSelfDedupLeases;
  seo: typeof seo;
  serializedProgramEpisodes: typeof serializedProgramEpisodes;
  seriesStoryState: typeof seriesStoryState;
  studioFunctions: typeof studioFunctions;
  topicMemory: typeof topicMemory;
  videoReleaseProvenance: typeof videoReleaseProvenance;
  videos: typeof videos;
  voiceBank: typeof voiceBank;
  youtubeAuth: typeof youtubeAuth;
  youtubeCreationClaims: typeof youtubeCreationClaims;
  youtubeUploads: typeof youtubeUploads;
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
