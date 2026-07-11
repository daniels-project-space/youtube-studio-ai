/**
 * Build the LTX-2.3 API-format workflow template from the official UI workflow
 * + a locally-dumped /object_info (the comfyui-api gateway doesn't proxy
 * /object_info, so we use the same image's schema off-VPS). Saves the API
 * template for the render harness to substitute + POST to /prompt.
 */
import fs from "node:fs";
import { uiToApi, type UiWorkflow, type ObjectInfo, type ApiPrompt } from "../src/lib/comfyWorkflow";

const OI = process.env.LTX_OBJINFO ?? "/root/ltx-build/object_info_latest.json";
const objectInfo = JSON.parse(fs.readFileSync(OI, "utf8")) as ObjectInfo;
const base = "https://raw.githubusercontent.com/Lightricks/ComfyUI-LTXVideo/master/example_workflows/2.3/";
const ui = (await (await fetch(base + encodeURIComponent("LTX-2.3_T2V_I2V_Two_Stage_Distilled.json"))).json()) as UiWorkflow;

const { prompt, warnings } = uiToApi(ui, objectInfo);
fs.writeFileSync("/root/ltx-build/ltx23_api_template.json", JSON.stringify(prompt, null, 2));
if (warnings.length) console.log("WARN(" + warnings.length + "):", warnings.slice(0, 8).join(" | "));

const byType = (t: string) => Object.entries(prompt).filter(([, n]) => (n as { class_type: string }).class_type === t);
for (const t of ["LoadImage", "GemmaAPITextEncode", "CLIPTextEncode", "EmptyLTXVLatentVideo", "LTXVEmptyLatentAudio", "CheckpointLoaderSimple", "LTXAVTextEncoderLoader", "LoraLoaderModelOnly", "LatentUpscaleModelLoader", "LTXVImgToVideoConditionOnly", "SaveVideo"]) {
  for (const [id, n] of byType(t)) {
    console.log(`${t} [${id}] ${JSON.stringify((n as ApiPrompt[string]).inputs).slice(0, 170)}`);
  }
}
console.log("total API nodes:", Object.keys(prompt).length);
