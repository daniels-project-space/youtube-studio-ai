export interface YoutubeProviderBoundaryProof {
  channelId?: string;
  providerSessionId?: string;
}

export class YoutubeProviderBoundaryError extends Error {
  readonly providerStarted: boolean;
  readonly providerSessionId?: string;
  readonly ambiguityPersisted: boolean;

  constructor(
    message: string,
    args: {
      providerStarted: boolean;
      providerSessionId?: string;
      ambiguityPersisted?: boolean;
      cause?: unknown;
    },
  ) {
    super(message, { cause: args.cause });
    this.name = "YoutubeProviderBoundaryError";
    this.providerStarted = args.providerStarted;
    this.providerSessionId = args.providerSessionId;
    this.ambiguityPersisted = args.ambiguityPersisted ?? !args.providerStarted;
  }
}

export type YoutubeProviderBoundaryResult<R, P extends YoutubeProviderBoundaryProof> =
  | { kind: "created" | "recovered"; receipt: R; proof: P }
  | { kind: "reuse"; receipt: R }
  | { kind: "wait" }
  | { kind: "ambiguous"; error: string; proof?: P };

type RecoveryAdmission<R> =
  | { action: "recover" }
  | { action: "reuse"; receipt: R }
  | { action: "wait" };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The small, provider-agnostic state machine around the irreversible boundary.
 * It is used by the real Trigger task and can be exercised against a
 * serializable fake store/provider without contacting YouTube.
 */
export async function executeYoutubeCreationProviderBoundary<
  R,
  P extends YoutubeProviderBoundaryProof,
>(args: {
  action: "create";
  markProviderStarted: () => Promise<{ started: boolean; status: string }>;
  createExact: (checkpointProviderStarted: () => Promise<void>) => Promise<P>;
  markCreated: (proof: P) => Promise<R>;
  markAmbiguous: (error: unknown, proof?: P) => Promise<void>;
} | {
  action: "recover";
  beginRecovery: () => Promise<RecoveryAdmission<R>>;
  recoverExact: () => Promise<P>;
  markCreated: (proof: P) => Promise<R>;
  markAmbiguous: (error: unknown, proof?: P) => Promise<void>;
}): Promise<YoutubeProviderBoundaryResult<R, P>> {
  if (args.action === "recover") {
    const admission = await args.beginRecovery();
    if (admission.action === "reuse") {
      return { kind: "reuse", receipt: admission.receipt };
    }
    if (admission.action === "wait") return { kind: "wait" };
    let proof: P | undefined;
    try {
      proof = await args.recoverExact();
      if (!proof.channelId) {
        const error = new Error("exact existing YouTube channel was not proven during recovery");
        await args.markAmbiguous(error, proof);
        return { kind: "ambiguous", error: error.message, proof };
      }
      const receipt = await args.markCreated(proof);
      return { kind: "recovered", receipt, proof };
    } catch (error) {
      try {
        await args.markAmbiguous(error, proof);
      } catch (checkpointError) {
        throw new YoutubeProviderBoundaryError(errorMessage(error), {
          providerStarted: true,
          providerSessionId: proof?.providerSessionId,
          ambiguityPersisted: false,
          cause: new AggregateError([error, checkpointError], "recovery checkpoint failed"),
        });
      }
      return { kind: "ambiguous", error: errorMessage(error), proof };
    }
  }

  let providerStarted = false;
  let proof: P | undefined;
  try {
    proof = await args.createExact(async () => {
      const admission = await args.markProviderStarted();
      if (!admission.started) {
        throw new Error(`provider click denied by durable claim state: ${admission.status}`);
      }
      providerStarted = true;
    });
    if (!proof.channelId) {
      throw new Error("provider response did not prove the exact created YouTube channel");
    }
    const receipt = await args.markCreated(proof);
    return { kind: "created", receipt, proof };
  } catch (error) {
    let ambiguityPersisted = !providerStarted;
    if (providerStarted) {
      try {
        await args.markAmbiguous(error, proof);
        ambiguityPersisted = true;
      } catch {
        ambiguityPersisted = false;
      }
    }
    throw new YoutubeProviderBoundaryError(errorMessage(error), {
      providerStarted,
      providerSessionId: proof?.providerSessionId,
      ambiguityPersisted,
      cause: error,
    });
  }
}
