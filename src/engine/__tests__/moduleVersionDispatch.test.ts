import assert from "node:assert/strict";
import {
  _clear, all, allManifests, get, getManifest, register, registerManifest,
  registerManifestVersion, require_,
} from "@/engine/registry";
import { manifestFromBlock, type ModuleManifest } from "@/engine/moduleManifest";
import { PipelineValidationError, validatePipeline } from "@/engine/validate";
import type { Block, PipelineEntry } from "@/engine/types";

function manifest(id: string, version: string, consumes: string[] = [], produces = ["marker"]): ModuleManifest {
  const block: Block = { id, consumes, produces, run: async () => ({ marker: version }) };
  return manifestFromBlock(block, { version, capabilities: [] });
}

function main(): void {
  _clear();
  try {
    const original = manifest("versioned_fixture", "1.0.0");
    const alternate = manifest("versioned_fixture", "2.0.0-evaluation", ["newInput"], ["newOutput"]);
    assert.throws(() => registerManifestVersion(alternate), /without default block: versioned_fixture/);
    assert.equal(get("versioned_fixture"), undefined);
    assert.deepEqual(allManifests(), []);

    registerManifest(original);
    const defaultBefore = validatePipeline([{ block: original.id }]);
    const blocksBefore = all();
    const manifestsBefore = allManifests();
    registerManifestVersion(alternate);

    assert.equal(get(original.id), original.block, "alternate registration must not replace the default");
    assert.equal(getManifest(original.id), original);
    assert.equal(require_(original.id), original.block);
    assert.deepEqual(all(), blocksBefore, "alternate implementations are not default-discoverable");
    assert.deepEqual(allManifests(), manifestsBefore);
    assert.deepEqual(validatePipeline([{ block: original.id }]), defaultBefore);

    for (const installed of [original, alternate]) {
      assert.equal(get(installed.id, installed.version), installed.block);
      assert.equal(getManifest(installed.id, installed.version), installed);
      assert.equal(require_(installed.id, installed.version), installed.block);
      const entries: PipelineEntry[] = [{ block: installed.id, version: installed.version, params: { explicit: true } }];
      const resolved = validatePipeline(entries, installed.block.consumes);
      assert.equal(resolved.blocks[0], installed.block);
      assert.equal(resolved.manifests[0], installed);
      assert.equal(resolved.entries, entries, "validation preserves explicit selection and params");
      assert.deepEqual(resolved.producedKeys, installed.block.produces);
    }
    assert.throws(
      () => validatePipeline([{ block: alternate.id, version: alternate.version }]),
      /consumes "newInput"/,
      "validation applies the alternate contract, not the default contract",
    );

    for (const version of ["9.0.0", "latest", "^2.0.0", "2.0.0", " 1.0.0", "1.0.0 "]) {
      assert.equal(get(original.id, version), undefined);
      assert.equal(getManifest(original.id, version), undefined);
      assert.throws(() => require_(original.id, version), (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.ok(error.message.includes(original.id));
        assert.ok(error.message.includes(`version "${version}"`));
        return true;
      });
      assert.throws(() => validatePipeline([{ block: original.id, version }]), (error: unknown) => {
        assert.ok(error instanceof PipelineValidationError);
        assert.ok(error.message.includes(`version "${version}"`));
        return true;
      });
    }
    assert.equal(get("absent", original.version), undefined);
    assert.equal(getManifest("absent", alternate.version), undefined);
    assert.throws(() => require_("absent"), /^Error: unknown block: absent$/);
    assert.throws(() => validatePipeline([{ block: "absent", version: "1.0.0" }]), /unknown block "absent" version "1.0.0"/);

    for (const version of ["", " \t\n", null, false, 0, 2, [], {}, new String("1.0.0")]) {
      const malformed = { block: original.id, version } as unknown as PipelineEntry;
      assert.throws(() => validatePipeline([malformed]), (error: unknown) =>
        error instanceof PipelineValidationError && /version must be a non-empty string/.test(error.message));
      assert.equal(get(original.id, version as string), undefined);
      assert.equal(getManifest(original.id, version as string), undefined);
      assert.throws(() => require_(original.id, version as string));
    }
    assert.equal(validatePipeline([{ block: original.id, version: undefined }]).manifests[0], original);

    assert.throws(() => registerManifestVersion(original), /version already registered/);
    assert.throws(() => registerManifestVersion(alternate), /version already registered/);
    assert.throws(() => registerManifestVersion({ ...alternate, version: "invalid" }), /invalid version/);
    assert.throws(() => registerManifestVersion({ ...alternate, version: "3.0.0", block: { ...alternate.block, id: "different" } }), /does not match/);
    assert.equal(get(original.id, "3.0.0"), undefined, "failed registration cannot install a partial entry");
    for (const version of ["", "  ", null, 3]) {
      assert.throws(() => registerManifestVersion({ ...alternate, version } as ModuleManifest), /non-empty string version/);
    }
    assert.throws(() => register(original.block), /block already registered: versioned_fixture/);
    assert.throws(() => register(alternate.block), /block already registered: versioned_fixture/);
    assert.throws(() => registerManifest(alternate), /block already registered: versioned_fixture/);
    assert.equal(getManifest(original.id), original);
    assert.equal(getManifest(original.id, alternate.version), alternate);

    const legacy: Block = { id: "legacy_fixture", consumes: [], produces: [], run: async () => ({}) };
    register(legacy);
    const legacyManifest = getManifest(legacy.id)!;
    registerManifestVersion(manifest(legacy.id, "2.0.0"));
    assert.equal(get(legacy.id), legacy);
    assert.equal(get(legacy.id, legacyManifest.version), legacy);
    assert.deepEqual(all(), [original.block, legacy]);
    assert.deepEqual(allManifests(), [original, legacyManifest]);

    _clear();
    assert.deepEqual(all(), []);
    assert.deepEqual(allManifests(), []);
    for (const installed of [original, alternate, legacyManifest]) {
      assert.equal(get(installed.id), undefined);
      assert.equal(get(installed.id, installed.version), undefined);
      assert.equal(getManifest(installed.id, installed.version), undefined);
      assert.throws(() => require_(installed.id, installed.version), /unknown block/);
    }
    registerManifest(original);
    assert.equal(get(original.id, alternate.version), undefined, "re-registering a default cannot resurrect cleared alternates");
    registerManifestVersion(alternate);
    assert.equal(get(original.id, alternate.version), alternate.block);
    console.log("MODULE VERSION DISPATCH PASS: defaults preserved; exact opt-in versions; fail-closed validation; reset clears both maps");
  } finally { _clear(); }
}

main();
