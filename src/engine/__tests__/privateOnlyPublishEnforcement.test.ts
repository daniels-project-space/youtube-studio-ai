import assert from "node:assert/strict";

import { registerAllBlocks } from "@/engine/blocks";
import { getManifest } from "@/engine/registry";
import {
  compilePipeline,
  PipelinePolicyError,
  type PipelinePolicy,
} from "@/engine/pipelineCompiler";
import type { ResolvedPipeline } from "@/engine/validate";
import type { PipelineEntry } from "@/engine/types";

/**
 * Regression coverage for the `publish.private_only` compiler-level guard
 * (pipelineCompiler.ts: enforcePrivateOnlyPublication). Every Casefile
 * source/evidence/cinematic-signing admission module and every children
 * curriculum/show-bible/safety module declares this capability
 * (moduleContracts.ts), but before this fix nothing actually enforced it: a
 * pipeline could combine a `publish.private_only` module with an
 * `upload_draft`/`shorts_spinoff`/`crosspost` entry set to a public or
 * scheduled release and compile cleanly. The fix is a fail-closed check on
 * the pipeline's aggregate capability set — the exact mechanism the compiler
 * already uses for `publish.connector_bound`/`publish.synthetic_disclosed`
 * (PRODUCTION_CONTRACT_POLICY.requiredCapabilities) — that runs independently
 * of `approvedForPublish` and of a channel's `approvalMode` schedule setting,
 * which this compiler never reads.
 */

registerAllBlocks();

/**
 * A permissive test policy that isolates the private_only guard from every
 * OTHER production requirement (script/master/thumbnail/crew-bindings/etc.).
 * enforcePrivateOnlyPublication does not read `policy` at all — it runs
 * unconditionally whenever the aggregate capability set contains
 * "publish.private_only" — so this only lets a small synthetic pipeline reach
 * that check instead of failing earlier on unrelated missing capabilities.
 */
const MINIMAL_POLICY: PipelinePolicy = {
  id: "test-minimal-private-only",
  version: "0.0.0",
  minimumCertification: "contract",
  requiredCapabilities: [],
  requireCrewBindings: false,
  requireStoryAlignmentForGeneratedVisuals: false,
  allowOpaqueMigrationArtifacts: true,
};

function resolvedFrom(entries: PipelineEntry[]): ResolvedPipeline {
  const manifests = entries.map((entry) => {
    const manifest = getManifest(entry.block);
    if (!manifest) {
      throw new Error(`test setup: no manifest registered for block "${entry.block}"`);
    }
    return manifest;
  });
  return {
    blocks: manifests.map((manifest) => manifest.block),
    manifests,
    entries,
    producedKeys: [],
  };
}

function expectPrivateOnlyRejection(entries: PipelineEntry[], messageContains: string): void {
  assert.throws(
    () => compilePipeline(resolvedFrom(entries), MINIMAL_POLICY),
    (error: unknown) => {
      assert.ok(error instanceof PipelinePolicyError, `expected PipelinePolicyError, got ${String(error)}`);
      assert.ok(
        (error as Error).message.includes("publish.private_only"),
        `expected error to reference "publish.private_only", got: ${(error as Error).message}`,
      );
      assert.ok(
        (error as Error).message.includes(messageContains),
        `expected error to reference "${messageContains}", got: ${(error as Error).message}`,
      );
      return true;
    },
  );
}

function run(): void {
  /* ---- 1. private_only content blocked from a PUBLIC upload_draft, even
     with approvedForPublish=true (the operator-approval escape hatch that
     validatePublicationApproval otherwise honors must NOT satisfy this). ---- */
  expectPrivateOnlyRejection(
    [
      { block: "casefile_source_packet", params: {} },
      { block: "upload_draft", params: { publishMode: "public", approvedForPublish: true } },
    ],
    "upload_draft",
  );

  /* ---- 2. Same for a SCHEDULED upload_draft — scheduled is still a future
     public release, not a draft. ---- */
  expectPrivateOnlyRejection(
    [
      { block: "casefile_source_packet", params: {} },
      { block: "upload_draft", params: { publishMode: "scheduled", approvedForPublish: true } },
    ],
    "upload_draft",
  );

  /* ---- 3. private_only content with a DRAFT upload_draft compiles cleanly
     — draft/private is exactly what the capability permits. ---- */
  {
    const compilation = compilePipeline(
      resolvedFrom([
        { block: "casefile_source_packet", params: {} },
        { block: "upload_draft", params: { publishMode: "draft" } },
      ]),
      MINIMAL_POLICY,
    );
    assert.ok(
      compilation.capabilities.includes("publish.private_only"),
      "sanity check: the pipeline must actually carry the capability under test",
    );
  }

  /* ---- 4. private_only pipeline blocked from a public shorts_spinoff. Set
     approvedForPublish=true so the run reaches the NEW guard instead of
     tripping the pre-existing validatePublicationApproval operator-approval
     gate first — proving private_only wins even when that gate is satisfied. ---- */
  expectPrivateOnlyRejection(
    [
      { block: "casefile_source_packet", params: {} },
      { block: "shorts_spinoff", params: { publishShort: "public", approvedForPublish: true } },
    ],
    "shorts_spinoff",
  );

  /* ---- 5. private_only pipeline blocked from a crossposted shorts_spinoff ---- */
  expectPrivateOnlyRejection(
    [
      { block: "casefile_source_packet", params: {} },
      { block: "shorts_spinoff", params: { crosspostShort: true, approvedForPublish: true } },
    ],
    "shorts_spinoff",
  );

  /* ---- 6. private_only pipeline blocked from ANY crosspost entry — that
     block has no private mode at all. ---- */
  expectPrivateOnlyRejection(
    [
      { block: "casefile_source_packet", params: {} },
      { block: "crosspost", params: { approvedForPublish: true } },
    ],
    "crosspost",
  );

  /* ---- 7. REGRESSION SAFETY: a pipeline with NO publish.private_only module
     (e.g. a normal narrated_stock-style channel) is completely unaffected —
     public, scheduled, and draft upload_draft all compile exactly as before. ---- */
  {
    const publicCompile = compilePipeline(
      resolvedFrom([
        { block: "upload_draft", params: { publishMode: "public", approvedForPublish: true } },
      ]),
      MINIMAL_POLICY,
    );
    assert.ok(
      !publicCompile.capabilities.includes("publish.private_only"),
      "a plain upload_draft-only pipeline must not carry publish.private_only",
    );

    const scheduledCompile = compilePipeline(
      resolvedFrom([
        { block: "upload_draft", params: { publishMode: "scheduled", approvedForPublish: true } },
      ]),
      MINIMAL_POLICY,
    );
    assert.ok(!scheduledCompile.capabilities.includes("publish.private_only"));

    const draftCompile = compilePipeline(
      resolvedFrom([{ block: "upload_draft", params: { publishMode: "draft" } }]),
      MINIMAL_POLICY,
    );
    assert.ok(!draftCompile.capabilities.includes("publish.private_only"));

    // Regression: without any approvedForPublish, a public/scheduled attempt
    // must still fail on the PRE-EXISTING validatePublicationApproval gate
    // (untouched by this change), proving the new check did not replace or
    // weaken it.
    assert.throws(
      () =>
        compilePipeline(
          resolvedFrom([{ block: "upload_draft", params: { publishMode: "public" } }]),
          MINIMAL_POLICY,
        ),
      (error: unknown) => {
        assert.ok(error instanceof PipelinePolicyError);
        assert.ok((error as Error).message.includes("approvedForPublish"));
        return true;
      },
    );
  }

  console.log("privateOnlyPublishEnforcement: all assertions passed");
}

run();
