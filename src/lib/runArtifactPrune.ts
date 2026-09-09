import {
  retainedFinalMasterReleaseObjectKeys,
  verifyFinalMasterReleaseEvidenceObjects,
  type FinalMasterReleaseCertificate,
} from "@/lib/finalMasterReleaseCertificate";
import { ObjectDeletionError } from "@/lib/storage";

/**
 * Delete a run's intermediates only after every retained release certificate
 * and every object it references has been re-read and byte-verified. Any gap
 * returns a fail-closed result and leaves the entire run namespace untouched.
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
  getObjectBytes: (key: string) => Promise<Uint8Array>;
  getObjectIntegrity: (key: string) => Promise<{ sha256: string; byteLength: number }>;
  listObjects: (prefix: string) => Promise<string[]>;
  deleteObjects: (keys: string[]) => Promise<number>;
}): Promise<{
  cleaned: boolean;
  removedObjects: number;
  retainedReleaseEvidence: string[];
  retainedObjectCount: number;
  error?: string;
}> {
  let retainedReleaseEvidence: string[] = [];
  let retainedObjectCount = 0;
  let removedObjects = 0;
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
    const keep = new Set([
      ...args.keepNames.map((name) => `${prefix}${name.replace(/^\/+/, "")}`),
      ...retainedReleaseEvidence,
    ]);
    const all = await args.listObjects(prefix);
    if (all.some((key) => typeof key !== "string" || !key.startsWith(prefix) || key === prefix) ||
        new Set(all).size !== all.length) {
      throw new Error("cleanup listing contains duplicate or out-of-run objects");
    }
    const deletable = all.filter((key) => !keep.has(key));
    retainedObjectCount = all.length - deletable.length;
    const deleted = await args.deleteObjects(deletable);
    if (Number.isSafeInteger(deleted) && deleted >= 0 && deleted <= deletable.length) removedObjects = deleted;
    if (deleted !== deletable.length) throw new Error("cleanup deletion acknowledgement is incomplete");
    return {
      cleaned: true,
      removedObjects: deleted,
      retainedReleaseEvidence,
      retainedObjectCount,
    };
  } catch (error) {
    return {
      cleaned: false,
      removedObjects: error instanceof ObjectDeletionError ? error.confirmedDeleted : removedObjects,
      retainedReleaseEvidence,
      retainedObjectCount,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
