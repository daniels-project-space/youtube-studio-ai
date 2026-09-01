import assert from "node:assert/strict";
import { studioLocationForPathname } from "../studioLocation";

assert.deepEqual(studioLocationForPathname("/"), {
  area: "Workspace",
  title: "Studio",
});
assert.deepEqual(studioLocationForPathname("/channels/new"), {
  area: "Channel workspace",
  title: "New channel",
});
assert.deepEqual(studioLocationForPathname("/channels/quiet-physics"), {
  area: "Channel workspace",
  title: "Operating room",
});
assert.deepEqual(studioLocationForPathname("/runs/run_123"), {
  area: "Production",
  title: "Run detail",
});
assert.deepEqual(studioLocationForPathname("/golden"), {
  area: "Toolbox · Assurance",
  title: "Golden modules",
});
assert.deepEqual(studioLocationForPathname("/unknown"), {
  area: "Workspace",
  title: "AutoStudio",
});

console.log("studio location tests passed");
