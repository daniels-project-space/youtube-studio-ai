import {
  retainedFinalMasterReleaseObjectKeys,
  verifyFinalMasterReleaseEvidenceObjects,
  type FinalMasterReleaseCertificate,
} from "@/lib/finalMasterReleaseCertificate";

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
    const retainedReleaseEvidence = [...new Set(retainedSets.flat())].sort();
    const prefix = `${args.keyPrefix}runs/${args.runId}/`;
    const keep = new Set([
      ...args.keepNames.map((name) => `${prefix}${name.replace(/^\/+/, "")}`),
      ...retainedReleaseEvidence,
    ]);
    const all = await args.listObjects(prefix);
    const deletable = all.filter((key) => !keep.has(key));
    const deleted = await args.deleteObjects(deletable);
    return {
      cleaned: true,
      removedObjects: deleted,
      retainedReleaseEvidence,
      retainedObjectCount: all.length - deletable.length,
    };
  } catch (error) {
    return {
      cleaned: false,
      removedObjects: 0,
      retainedReleaseEvidence: [],
      retainedObjectCount: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
