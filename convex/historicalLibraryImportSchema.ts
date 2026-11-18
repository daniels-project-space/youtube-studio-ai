import { defineTable } from "convex/server";
import { v } from "convex/values";

// Merge this fragment into schema.ts with the release owner before deployment.
export const historicalLibraryImportSchema = {
  historicalLibraryImports: defineTable({
    ownerId: v.string(), sourceDeployment: v.string(), sourceRunId: v.string(),
    manifest: v.any(), attestation: v.any(), runId: v.id("runs"), importedAt: v.number(),
  }).index("by_source", ["ownerId", "sourceDeployment", "sourceRunId"]),
};
