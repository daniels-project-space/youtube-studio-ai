import assert from "node:assert/strict";
import { designPipeline } from "../designer";
import { checkWorkshopPipeline } from "../workshopPipelineCheck";

const design = designPipeline({ family: "narrated_stock", nicheKey: "history", lengthMinutes: 5, publishMode: "draft" });
const result = checkWorkshopPipeline("narrated_stock", design.pipeline);
assert.equal(result.lane, "narrated_documentary");
assert.equal(result.modules.length, design.pipeline.length);
assert.match(result.fingerprint, /^[a-f0-9]{64}$/);
assert.ok(Number.isFinite(result.reservedMaxCostUsd) && result.reservedMaxCostUsd > 0);
assert.throws(() => checkWorkshopPipeline("not-a-format", design.pipeline), /supported video format/);
assert.throws(() => checkWorkshopPipeline("narrated_stock", []), /pipeline is empty/);
assert.throws(() => checkWorkshopPipeline("narrated_stock", [{ block: "not_a_module" }]), /unknown block/);
const withoutVisuals = design.pipeline.filter(entry => entry.block !== "stock_footage");
assert.throws(() => checkWorkshopPipeline("narrated_stock", withoutVisuals));
assert.throws(() => checkWorkshopPipeline("music_loop", design.pipeline));
console.log("Workshop compiler check: valid pipeline passes; unknown, incomplete and wrong-format drafts fail");
