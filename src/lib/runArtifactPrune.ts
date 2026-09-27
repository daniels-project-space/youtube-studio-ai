import {
  retainedFinalMasterReleaseObjectKeys,
  verifyFinalMasterReleaseEvidenceObjects,
  type FinalMasterReleaseCertificate,
} from "@/lib/finalMasterReleaseCertificate";
/**
 * Seal release evidence and inventory a run. Deletion happens later through
 * the immutable-key retention worker, after this ledger is completed.
 */
export async function pruneRunObjectsWithVerifiedFinalMasterEvidence(args: {
  keyPrefix: string;
  runId: string;
  certificateKey: string;
  certificate: FinalMasterReleaseCertificate;
  additionalCertificates?: readonly {
    certificateKey: string;
    certificate: FinalMasterReleaseCertificate;
  }[];
  keepNames: readonly string[];
  /** Exact reusable-library keys, including superseded revisions. */
  keepKeys?: readonly string[];
  getObjectBytes: (key: string) => Promise<Uint8Array>;
  getObjectIntegrity: (key: string) => Promise<{ sha256: string; byteLength: number }>;
  listObjects: (prefix: string) => Promise<string[]>;
}): Promise<{
  cleaned: boolean;
  removedObjects: number;
  retainedReleaseEvidence: string[];
  retainedObjectCount: number;
  error?: string;
}> {
  let retainedReleaseEvidence: string[] = [];
  let retainedObjectCount = 0;
  try {
    const certificates = [
      { certificateKey: args.certificateKey, certificate: args.certificate },
      ...(args.additionalCertificates ?? []),
    ];
    const retainedSets = await Promise.all(
      certificates.map(async ({ certificateKey, certificate }) => {
        const retained = retainedFinalMasterReleaseObjectKeys({
          keyPrefix: args.keyPrefix,
          runId: args.runId,
          certificateKey,
          certificate,
        });
        await verifyFinalMasterReleaseEvidenceObjects({
          certificate,
          getObjectBytes: args.getObjectBytes,
          getObjectIntegrity: args.getObjectIntegrity,
        });
        return retained;
      }),
    );
    retainedReleaseEvidence = [...new Set(retainedSets.flat())].sort();
    const prefix = `${args.keyPrefix}runs/${args.runId}/`;
    if (args.keepKeys?.some((key) => !key.startsWith(prefix))) {
      throw new Error("reusable library key escapes the scoped run namespace");
    }
    if (args.keepNames.some((name) => name.includes("..") || name.startsWith("/"))) {
      throw new Error("run keep name escapes its scoped namespace");
    }
    const all = await args.listObjects(prefix);
    if (all.some((key) => typeof key !== "string" || !key.startsWith(prefix) || key === prefix) ||
        new Set(all).size !== all.length) {
      throw new Error("cleanup listing contains duplicate or out-of-run objects");
    }
    retainedObjectCount = all.length;
    return {
      cleaned: true,
      removedObjects: 0,
      retainedReleaseEvidence,
      retainedObjectCount,
    };
  } catch (error) {
    return {
      cleaned: false,
      removedObjects: 0,
      retainedReleaseEvidence,
      retainedObjectCount,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
