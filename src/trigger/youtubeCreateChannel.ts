/**
 * `youtube-create-channel` — headless creation of a YouTube Brand-Account channel
 * via Browserbase + Stagehand's CUA agent, using a pre-authenticated Browserbase
 * context (BROWSERBASE_CONTEXT_ID). YouTube has NO channel-create API and the flow
 * is BotGuard-gated, so a real browser (running Google's JS) is required — this is
 * the right tool, not a workaround.
 *
 * The create dialog ("Your profile") exposes a NAME field and an @HANDLE field as
 * plain inputs, so we set a clean handle at birth. The avatar/photo, however, goes
 * through Google's cross-origin OneGoogle photo-picker iframe whose file input is
 * unreachable from this stack (proven exhaustively: deepLocator, raw CDP
 * setFileInputFiles, fileChooser interception, and Browserbase's upload-inject all
 * fail to reach it). So the avatar is NOT set here — it's a one-time, ~15s step in
 * the operator's own (trusted) browser. Description/banner/country come via the
 * official API after Link.
 *
 * After creating + switching, it reads the channel id from the Studio URL and
 * records it on the app channel (youtubeCreated) so the UI can prompt the operator
 * to Connect (the OAuth grant is the one step Google forces a human through).
 */
import { task } from "@trigger.dev/sdk";
import { createHash } from "node:crypto";
import { StudioConvexHttpClient as ConvexHttpClient } from "@/lib/studioConvexHttpClient";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { bootstrapSecrets } from "@/lib/bootstrap";
import { withStagehand, hasBrowserbase } from "@/lib/browserbase";
import {
  studioActionApprovalFingerprint,
  verifyStudioActionApproval,
  youtubeChannelApprovalSubject,
  type StudioActionApprovalReceipt,
} from "@/lib/studioActionApproval";
import {
  assessExactYoutubeProviderIdentity,
  assertYoutubeCreationBinding,
  assertYoutubePreProviderInventoryProof,
  assertYoutubePreProviderInventoryAllowsProviderStart,
  normalizeYoutubeChannelName,
  normalizeYoutubeHandle,
  suggestYoutubeHandle,
  type YoutubeCreationBinding,
  type YoutubePreProviderInventoryProof,
} from "@/lib/youtubeChannelCreationClaim";
import {
  assessYoutubeExactIdentityInventory,
  installYoutubeRecoveryGuards,
  readYoutubeChannelSwitcherCandidates,
  selectExactExistingYoutubeChannel,
  type YoutubeRecoveryLinkCandidate,
  type YoutubeRecoveryContext,
  type YoutubeRecoveryPage,
} from "@/lib/youtubeRecoveryBrowser";
import {
  executeYoutubeCreationProviderBoundary,
  YoutubeProviderBoundaryError,
} from "@/lib/youtubeCreationProviderBoundary";

function buildPreProviderInventoryProof(args: {
  binding: YoutubeCreationBinding;
  candidates: YoutubeRecoveryLinkCandidate[];
  observedAt: number;
}): YoutubePreProviderInventoryProof {
  const assessment = assessYoutubeExactIdentityInventory(args.candidates, {
    name: args.binding.name,
    handle: args.binding.requestedHandle,
  });
  const normalizedCandidates = args.candidates.map((candidate) => ({
    href: candidate.href.trim(),
    textLines: candidate.textLines.map((line) =>
      normalizeYoutubeChannelName(line)).filter(Boolean).sort(),
  })).sort((left, right) =>
    `${left.href}\0${left.textLines.join("\0")}`.localeCompare(
      `${right.href}\0${right.textLines.join("\0")}`,
    ));
  const inventoryFingerprint = createHash("sha256").update(JSON.stringify({
    version: "youtube-pre-provider-inventory/v1",
    binding: args.binding,
    observedAt: args.observedAt,
    assessment,
    candidates: normalizedCandidates,
  })).digest("hex");
  const proof: YoutubePreProviderInventoryProof = {
    version: "youtube-pre-provider-inventory/v1",
    ...args.binding,
    inventoryFingerprint,
    ...assessment,
    observedAt: args.observedAt,
  };
  assertYoutubePreProviderInventoryProof(proof, args.binding);
  return proof;
}

export interface CreateChannelArgs {
  /** Display name for the new YouTube channel. */
  name: string;
  /** App channelId to wire the created channel back to. */
  channelId: string;
  /** Owner whose app channel is being provisioned. */
  ownerId: string;
  /** Stable, channel-bound idempotency key. */
  requestKey: string;
  /** Server-signed authority bound to owner + channel + requestKey. */
  approval: StudioActionApprovalReceipt;
  /** Desired @handle (without the @). Defaults to a slug of the name. */
  handle?: string;
}

interface SHPage extends YoutubeRecoveryPage {
  url: () => string;
  goto: (url: string, opts?: Record<string, unknown>) => Promise<unknown>;
  waitForTimeout: (ms: number) => Promise<void>;
}
interface SHAgent {
  execute: (instr: string | Record<string, unknown>) => Promise<{ success?: boolean; completed?: boolean; message?: string }>;
}
interface SH {
  context: YoutubeRecoveryContext & { newPage: (url?: string) => Promise<SHPage> };
  agent: (opts: Record<string, unknown>) => SHAgent;
}

/** Extract a UC… channel id from a studio/youtube URL. */
function channelIdFromUrl(u: string): string | undefined {
  const m = u.match(/\/channel\/(UC[0-9A-Za-z_-]{20,})/);
  return m?.[1];
}

interface ExactProviderChannelProof {
  exact: boolean;
  channelId?: string;
  observedName?: string;
  observedHandle?: string;
  reason?: string;
}

/**
 * Proves identity from provider-owned page metadata and then requires the
 * authenticated Studio account to resolve to the same UC id. Agent success text
 * is never accepted as a creation receipt.
 */
async function proveExactActiveChannel(
  page: SHPage,
  expectedName: string,
  expectedHandle: string,
): Promise<ExactProviderChannelProof> {
  const providerUrl = `https://www.youtube.com/@${encodeURIComponent(expectedHandle)}/about`;
  let observed: { name?: string; handle?: string; channelId?: string } = {};
  let observedName: string | undefined;
  let observedHandle = "";
  let metadataAssessment: ReturnType<typeof assessExactYoutubeProviderIdentity> = {
    exact: false,
    reason: "provider metadata has not propagated yet",
  };
  // Newly-created public metadata can lag briefly. Refresh provider-owned state
  // three times without another agent call or any create/edit interaction.
  for (let attempt = 1; attempt <= 3; attempt++) {
    await page.goto(providerUrl, { timeout: 45_000 });
    await page.waitForTimeout(2_500);
    observed = await page.evaluate(() => {
      const content = (selector: string) =>
        document.querySelector<HTMLMetaElement>(selector)?.content?.trim();
      const href = (selector: string) =>
        document.querySelector<HTMLLinkElement>(selector)?.href?.trim();
      const html = document.documentElement.innerHTML;
      const canonicalUrl =
        content('meta[property="og:url"]') ??
        content('meta[name="twitter:url"]') ??
        href('link[rel="canonical"]') ??
        window.location.href;
      const handleMatch = canonicalUrl.match(/youtube\.com\/@([^/?#"&]+)/i) ??
        html.match(/vanityChannelUrl(?:\\?"|&quot;):(?:\\?"|&quot;)[^"<]*youtube\.com\/@([^\\"&<]+)/i);
      const channelId =
        content('meta[itemprop="channelId"]') ??
        html.match(/(?:externalId|channelId)\\?"?\s*:\s*\\?"(UC[A-Za-z0-9_-]{20,})/)?.[1];
      return {
        name: content('meta[property="og:title"]'),
        handle: handleMatch?.[1] ? decodeURIComponent(handleMatch[1]) : undefined,
        channelId,
      };
    });
    observedName = observed.name
      ? normalizeYoutubeChannelName(observed.name)
      : undefined;
    observedHandle = normalizeYoutubeHandle(observed.handle ?? "").toLowerCase();
    metadataAssessment = assessExactYoutubeProviderIdentity({
      expectedName,
      expectedHandle,
      observed: {
        name: observedName,
        handle: observedHandle,
        channelId: observed.channelId,
        studioChannelId: observed.channelId,
      },
    });
    if (metadataAssessment.exact) break;
  }
  if (!metadataAssessment.exact) {
    return {
      exact: false,
      observedName,
      observedHandle: observed.handle,
      channelId: observed.channelId,
      reason: metadataAssessment.reason,
    };
  }
  await page.goto("https://studio.youtube.com", { timeout: 45_000 });
  await page.waitForTimeout(3_500);
  const studioChannelId = channelIdFromUrl(page.url());
  const activeAssessment = assessExactYoutubeProviderIdentity({
    expectedName,
    expectedHandle,
    observed: {
      name: observedName,
      handle: observedHandle,
      channelId: observed.channelId,
      studioChannelId,
    },
  });
  if (!activeAssessment.exact) {
    return {
      exact: false,
      observedName,
      observedHandle: observed.handle,
      channelId: observed.channelId,
      reason: activeAssessment.reason,
    };
  }
  return {
    exact: true,
    observedName,
    observedHandle: observed.handle,
    channelId: observed.channelId,
  };
}

export const youtubeCreateChannelTask = task({
  id: "youtube-create-channel",
  maxDuration: 1200,
  // A retry is useful for recovery, but the durable claim makes every attempt
  // after provider_started reconciliation-only. The create click is never run
  // twice, including after a lost provider response.
  retry: { maxAttempts: 2, minTimeoutInMs: 5000, maxTimeoutInMs: 20000, factor: 2 },
  run: async (payload: CreateChannelArgs, { ctx }) => {
    const log = (m: string, x?: Record<string, unknown>) => console.log(`[yt-create] ${m}`, x ?? "");
    if (
      typeof payload?.ownerId !== "string" ||
      typeof payload?.channelId !== "string" ||
      typeof payload?.requestKey !== "string" ||
      typeof payload?.name !== "string"
    ) {
      throw new Error("YouTube creation requires ownerId, channelId, requestKey, and name");
    }
    await bootstrapSecrets(log);
    const name = normalizeYoutubeChannelName(payload.name);
    const handle = normalizeYoutubeHandle(
      payload.handle?.trim() || suggestYoutubeHandle(name),
    );
    const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
    if (!convexUrl) throw new Error("Convex is required for durable YouTube creation claims");
    const convex = new ConvexHttpClient(convexUrl);
    const channelId = payload.channelId as Id<"channels">;
    const workerId = ctx.run.id;
    const existing = await convex.query(api.youtubeCreationClaims.get, {
      ownerId: payload.ownerId,
      channelId,
      requestKey: payload.requestKey,
    });
    const receiptFingerprint = studioActionApprovalFingerprint(payload.approval);
    const binding: YoutubeCreationBinding = {
      ownerId: payload.ownerId,
      channelId: payload.channelId,
      requestKey: payload.requestKey,
      name,
      requestedHandle: handle,
      receiptFingerprint,
    };
    assertYoutubeCreationBinding(binding);
    if (!verifyStudioActionApproval(payload.approval, {
      action: "youtube-channel-create",
      ownerId: payload.ownerId,
      subject: youtubeChannelApprovalSubject({
        ownerId: payload.ownerId,
        channelId: payload.channelId,
        requestKey: payload.requestKey,
        name,
        handle,
      }),
      persistedReceiptFingerprint: existing?.receiptFingerprint,
    })) {
      // This branch is deliberately before hasBrowserbase/withStagehand.
      throw new Error("YouTube channel creation approval is missing, invalid, expired, or misbound");
    }
    if (!hasBrowserbase()) throw new Error("Browserbase not configured");
    if (!process.env.BROWSERBASE_CONTEXT_ID) {
      throw new Error("No authenticated Browserbase context (BROWSERBASE_CONTEXT_ID)");
    }

    const mutationBinding = {
      ownerId: payload.ownerId,
      channelId,
      requestKey: payload.requestKey,
      name,
      requestedHandle: handle,
      receiptFingerprint,
    };
    const claimed = await convex.mutation(api.youtubeCreationClaims.claim, {
      ...mutationBinding,
      workerId,
      approvalSubject: payload.approval.subject,
      approvalActor: payload.approval.actor,
      approvalEvidence: payload.approval.evidence,
      approvalIssuedAt: payload.approval.issuedAt,
      approvalExpiresAt: payload.approval.expiresAt,
      approvalReceipt: payload.approval,
      now: Date.now(),
    });

    const reuse = (claim: typeof claimed.claim) => ({
      ok: true,
      reused: true,
      name: claim?.name ?? name,
      handle: claim?.handle ?? `@${handle}`,
      channelId: payload.channelId,
      ytChannelId: claim?.ytChannelId ?? null,
      finalUrl: claim?.url ?? null,
      requestKey: payload.requestKey,
    });
    if (claimed.action === "reuse") return reuse(claimed.claim);
    if (claimed.action === "wait") {
      return {
        ok: false,
        inProgress: true,
        channelId: payload.channelId,
        requestKey: payload.requestKey,
        error: "another worker owns the pre-provider YouTube creation claim",
      };
    }
    if (claimed.action === "new_intent_required") {
      return {
        ok: false,
        newIntentRequired: true,
        channelId: payload.channelId,
        requestKey: payload.requestKey,
        error: "the prior intent failed before provider start; confirm a new creation intent",
      };
    }

    const markAmbiguous = async (error: unknown, providerSessionId?: string) => {
      try {
        await convex.mutation(api.youtubeCreationClaims.markAmbiguous, {
          ...mutationBinding,
          workerId,
          providerSessionId,
          error: error instanceof Error ? error.message : String(error),
          now: Date.now(),
        });
      } catch (checkpointError) {
        log("failed to persist ambiguous YouTube creation state", {
          error: checkpointError instanceof Error ? checkpointError.message : String(checkpointError),
        });
        throw checkpointError;
      }
    };

    if (claimed.action === "recover") {
      const boundary = await executeYoutubeCreationProviderBoundary({
        action: "recover",
        beginRecovery: async () => {
          const recovery = await convex.mutation(api.youtubeCreationClaims.beginRecovery, {
            ...mutationBinding,
            workerId,
            now: Date.now(),
          });
          if (recovery.action === "reuse") {
            return { action: "reuse" as const, receipt: recovery.claim ?? null };
          }
          if (recovery.action === "wait") return { action: "wait" as const };
          return { action: "recover" as const };
        },
        recoverExact: async () => {
          const recovered = await withStagehand(async (shU) => {
            const sh = shU as SH;
            // Recovery is a mechanically read-only reconciliation path: install
            // guards before loading provider content and never invoke an agent.
            const page = await sh.context.newPage("about:blank");
            await installYoutubeRecoveryGuards(sh.context, page);
            await page.goto("https://www.youtube.com/channel_switcher", { timeout: 45_000 });
            await page.waitForTimeout(3500);
            const selection = await selectExactExistingYoutubeChannel(page, { name, handle });
            if (!selection.selected) {
              return {
                exact: false,
                reason: selection.reason,
              } satisfies ExactProviderChannelProof;
            }
            return await proveExactActiveChannel(page, name, handle);
          }, log);
          return {
            ...recovered.value,
            providerSessionId: recovered.sessionId,
          };
        },
        markCreated: async (proof) => await convex.mutation(
          api.youtubeCreationClaims.markCreated,
          {
            ...mutationBinding,
            workerId,
            ytChannelId: proof.channelId!,
            providerSessionId: proof.providerSessionId,
            now: Date.now(),
          },
        ),
        markAmbiguous: async (error, proof) => {
          await markAmbiguous(error, proof?.providerSessionId);
        },
      });
      if (boundary.kind === "reuse") return reuse(boundary.receipt ?? null);
      if (boundary.kind === "wait") {
        return {
          ok: false,
          inProgress: true,
          recovery: true,
          channelId: payload.channelId,
          requestKey: payload.requestKey,
        };
      }
      if (boundary.kind === "ambiguous") {
        return {
          ok: false,
          ambiguous: true,
          recovery: true,
          needsManualRecovery: true,
          channelId: payload.channelId,
          requestKey: payload.requestKey,
          error: boundary.error,
        };
      }
      if (boundary.kind === "recovered" || boundary.kind === "created") {
        log("yt-create recovered exact existing channel", {
          ytChannelId: boundary.receipt?.ytChannelId,
          requestKey: payload.requestKey,
        });
        return {
          ...reuse(boundary.receipt ?? null),
          reused: false,
          recovered: true,
          sessionId: boundary.proof.providerSessionId,
        };
      }
      throw new Error("unexpected YouTube recovery boundary result");
    }

    try {
      const boundary = await executeYoutubeCreationProviderBoundary({
        action: "create",
        markProviderStarted: async () => await convex.mutation(
          api.youtubeCreationClaims.markProviderStarted,
          {
            ...mutationBinding,
            workerId,
            now: Date.now(),
          },
        ),
        createExact: async (checkpointProviderStarted) => {
          const created = await withStagehand(async (shU) => {
            const sh = shU as SH;
            const page = await sh.context.newPage("https://www.youtube.com/channel_switcher");
            await page.waitForTimeout(3500);
            const candidates = await readYoutubeChannelSwitcherCandidates(page);
            const persistedInventory = claimed.claim?.preProviderInventory as
              | YoutubePreProviderInventoryProof
              | undefined;
            let inventory = persistedInventory;
            if (persistedInventory) {
              assertYoutubePreProviderInventoryProof(persistedInventory, binding);
            } else {
              inventory = buildPreProviderInventoryProof({
                binding,
                candidates,
                observedAt: Date.now(),
              });
              await convex.mutation(api.youtubeCreationClaims.recordPreProviderInventory, {
                ...mutationBinding,
                workerId,
                proof: inventory,
                now: Date.now(),
              });
            }
            assertYoutubePreProviderInventoryAllowsProviderStart(inventory, binding);
            // Re-read after the immutable inventory has committed. This closes
            // the useful race window between the baseline observation and the
            // durable authorization checkpoint; an exact identity appearing in
            // that window can never reach the provider create click.
            const authorizationCandidates = await readYoutubeChannelSwitcherCandidates(page);
            const authorizationAssessment = assessYoutubeExactIdentityInventory(
              authorizationCandidates,
              { name, handle },
            );
            if (authorizationAssessment.exactIdentityState !== "absent") {
              throw new Error(
                "the exact YouTube name and handle now exist; a new channel cannot be causally proven",
              );
            }
            // Inherit the non-Google model pinned by withStagehand().
            const agent = sh.agent({ mode: "hybrid" });
            // This durable checkpoint is the one-way gate. Once it commits,
            // no retry can enter this create closure again.
            await checkpointProviderStarted();
            const res = await agent.execute({
              instruction:
                `Goal: create a NEW YouTube channel and switch to it. On this channel-switcher page click ` +
                `"Create a channel" / "+ Create a channel" / "Kanal erstellen". A dialog titled "Your profile"/"Dein ` +
                `Profil" opens with a NAME field, an @handle/Alias field, a "Choose picture" button, and a final ` +
                `"Create channel"/"Kanal erstellen" button. Type the name "${name}" into the NAME field. Set the ` +
                `@handle/Alias field to "${handle}" (clear any prefilled value first). The exact handle is part of an ` +
                `immutable creation receipt: if YouTube says it is unavailable, STOP before the final create click. ` +
                `Never accept a suggestion or alter it. Do NOT click "Choose picture"/skip the photo. Only when the ` +
                `exact name and handle are accepted, click "Create channel"/"Kanal erstellen". Then make "${name}" the ACTIVE ` +
                `channel and skip any later optional step (Set-up-later/Save-and-continue). Stop once "${name}" exists ` +
                `and is active. Do NOT touch other existing channels.`,
              maxSteps: 24,
            });
            await page.waitForTimeout(2500);
            const proof = await proveExactActiveChannel(page, name, handle);
            return {
              ...proof,
              channelId: proof.exact ? proof.channelId : undefined,
              finalUrl: page.url(),
              agentMessage: res?.message ?? "",
            };
          }, log);
          return {
            ...created.value,
            providerSessionId: created.sessionId,
          };
        },
        markCreated: async (proof) => await convex.mutation(
          api.youtubeCreationClaims.markCreated,
          {
            ...mutationBinding,
            workerId,
            ytChannelId: proof.channelId!,
            providerSessionId: proof.providerSessionId,
            now: Date.now(),
          },
        ),
        markAmbiguous: async (error, proof) => {
          await markAmbiguous(error, proof?.providerSessionId);
        },
      });
      if (boundary.kind !== "created") {
        throw new Error(`unexpected YouTube provider boundary result: ${boundary.kind}`);
      }
      const { receipt, proof } = boundary;
      const sessionId = proof.providerSessionId;
      const liveView = sessionId ? `https://www.browserbase.com/sessions/${sessionId}` : undefined;
      log("yt-create finished", {
        ok: true,
        ytChannelId: receipt?.ytChannelId,
        handle,
        url: proof.finalUrl,
        liveView,
        requestKey: payload.requestKey,
      });
        return {
          ok: true,
          name,
          handle: `@${handle}`,
          channelId: payload.channelId,
          ytChannelId: receipt?.ytChannelId ?? proof.channelId,
          agentMessage: proof.agentMessage,
          finalUrl: proof.finalUrl,
          sessionId,
          liveView,
          requestKey: payload.requestKey,
        };
    } catch (error) {
      const boundaryError = error instanceof YoutubeProviderBoundaryError
        ? error
        : undefined;
      if (
        boundaryError?.providerStarted &&
        !boundaryError.ambiguityPersisted
      ) {
        await markAmbiguous(error, boundaryError.providerSessionId);
      } else if (!boundaryError?.providerStarted && ctx.attempt.number >= 2) {
        try {
          await convex.mutation(api.youtubeCreationClaims.markPreProviderFailed, {
            ...mutationBinding,
            workerId,
            error: error instanceof Error ? error.message : String(error),
            now: Date.now(),
          });
        } catch (checkpointError) {
          log("failed to persist pre-provider terminal state", {
            error: checkpointError instanceof Error ? checkpointError.message : String(checkpointError),
          });
        }
      }
      // Throw so Trigger's one retry follows the durable recovery branch. A
      // hard process loss has the same behavior because provider_started was
      // committed before the click.
      throw error;
    }
  },
});
