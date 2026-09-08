import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function main(): Promise<void> {
  const page = await readFile(new URL("./page.tsx", import.meta.url), "utf8");
  const styles = await readFile(new URL("./channelHub.module.css", import.meta.url), "utf8");
  const pipelineTab = page.slice(
    page.indexOf("function PipelineTab"),
    page.indexOf("/* ------------------------------- Identity"),
  );

  assert.match(pipelineTab, /const bands = buildPipelineTopology\(pipeline\)/);
  assert.match(pipelineTab, /<ol className=\{styles\.pipelineBands\}>/);
  assert.match(pipelineTab, /data-phase=\{band\.phase\}/);
  assert.match(pipelineTab, /if \(module\.controlCount === 0 \|\| !params\)[\s\S]{0,500}?<article/,
    "default modules must be informative, not empty interactive disclosures");
  assert.match(pipelineTab, /<details[\s\S]{0,250}?data-tuned="true"[\s\S]{0,500}?<dl className=\{styles\.pipelineParams\}>/,
    "only tuned modules should expose saved controls");
  assert.doesNotMatch(pipelineTab, /pipeline\.map\(/,
    "the UI should consume the order-preserving compact topology rather than rebuilding it inline");

  assert.match(styles, /\.pipelineModuleGrid \{[^}]*repeat\(auto-fit,minmax\(190px,1fr\)\)/);
  assert.match(styles, /\.pipelineModuleSummary \{[^}]*min-height: 48px/,
    "interactive module summaries retain a usable pointer target");
  assert.match(styles, /@media \(max-width: 440px\)[\s\S]*\.pipelineModuleGrid \{ grid-template-columns: 1fr; \}/);

  console.log("Channel pipeline compact topology UI contracts passed");
}

void main();
