import type { AssetFirstShortBoard } from "./assetFirstShort";

const assetRoot = "assets/shorts/voyager-golden-record-v2";
const cutoutRoot = "assets/shorts/voyager-golden-record-v3";
const standardRoot = "assets/documentary-standard/v1/nasa";

/**
 * This is both the production brief and the renderer input.  It deliberately
 * records all support assets rather than inventing extras inside the renderer.
 */
export const voyagerGoldenRecordAssetBoard = {
  id: "voyager-golden-record-asset-first-v4",
  fps: 30,
  durationInFrames: 450,
  worldAnchor: {
    palette: "oxidized gold / midnight navy / bone paper / faded signal red",
    treatment: ["35mm grain", "paper wash", "shutter shadow", "corner vignette", "stepped movement"],
    continuity: "1977 launch → what the record carries → Voyager's literal photograph of Earth → present-day interstellar distance.",
  },
  scenes: [
    {
      id: "record",
      startFrame: 0,
      durationInFrames: 104,
      narration: "In 1977, Voyager left Earth with a Golden Record.",
      claim: "Voyager launched in 1977 carrying the Golden Record.",
      visualVerb: "NASA record image opens under a foreground cutout; the mission card tears forward as the camera pushes through",
      caption: "A RECORD / LEAVES EARTH",
      soundCue: "soft projector click, paper pull, low relay pulse",
      assets: [
        { id: "nasa-record-setting", ownerSceneId: "record", role: "setting", file: `${standardRoot}/voyager-golden-record-pia14113.jpg`, provenance: "licensed-editorial", purpose: "literal NASA/JPL record and Voyager evidence image", layer: 0 },
        { id: "gold-record-hero", ownerSceneId: "record", role: "hero", file: `${standardRoot}/voyager-golden-record-pia14113.jpg`, provenance: "licensed-editorial", purpose: "recurring factual Golden Record focal object", layer: 2 },
        { id: "record-cutout", ownerSceneId: "record", role: "hero", file: `${cutoutRoot}/gold-record-cutout.png`, provenance: "generated-original", purpose: "independent foreground record for depth and focus pulls", layer: 3 },
        { id: "outbound-card", ownerSceneId: "record", role: "prop", provenance: "procedural", purpose: "taped physical mission card", layer: 4 },
        { id: "record-title", ownerSceneId: "record", role: "type", provenance: "procedural", purpose: "short reaction copy", layer: 5 },
        { id: "analogue-treatment", ownerSceneId: "record", role: "texture", provenance: "procedural", purpose: "shared film and shutter treatment", layer: 9 },
      ],
    },
    {
      id: "inside",
      startFrame: 104,
      durationInFrames: 112,
      narration: "It carried 115 images and greetings in 55 languages.",
      claim: "The record includes 115 images and greetings in 55 languages.",
      visualVerb: "literal Earth photograph, photo-count card, and greeting card fan into a proof stack under a moving camera",
      caption: "115 IMAGES / 55 GREETINGS",
      soundCue: "paper fan, card snaps, soft voice texture",
      assets: [
        { id: "archive-setting", ownerSceneId: "inside", role: "setting", file: `${assetRoot}/archive-tray.png`, provenance: "generated-original", purpose: "physical archival tabletop", layer: 0 },
        { id: "contact-sheet", ownerSceneId: "inside", role: "evidence", file: `${assetRoot}/archive-tray.png`, provenance: "generated-original", purpose: "unreadable original contact-sheet texture", layer: 2 },
        { id: "earth-photo", ownerSceneId: "inside", role: "evidence", file: `${standardRoot}/blue-marble-earth-pia18033.jpg`, provenance: "licensed-editorial", purpose: "bright literal NASA Earth photograph used as factual image evidence", layer: 3 },
        { id: "evidence-stack-cutout", ownerSceneId: "inside", role: "evidence", file: `${cutoutRoot}/evidence-stack-cutout.png`, provenance: "generated-original", purpose: "independent archival evidence stack for layered card choreography", layer: 4 },
        { id: "image-card", ownerSceneId: "inside", role: "prop", provenance: "procedural", purpose: "115 evidence card", layer: 4 },
        { id: "greeting-card", ownerSceneId: "inside", role: "prop", provenance: "procedural", purpose: "55 evidence card", layer: 5 },
        { id: "record-card", ownerSceneId: "inside", role: "prop", provenance: "procedural", purpose: "gold-record evidence card", layer: 6 },
        { id: "analogue-treatment", ownerSceneId: "inside", role: "texture", provenance: "procedural", purpose: "shared film and shutter treatment", layer: 9 },
      ],
    },
    {
      id: "earth",
      startFrame: 216,
      durationInFrames: 114,
      narration: "Thirteen years later, Voyager looked back. Earth was one pale-blue dot.",
      claim: "Voyager 1 photographed Earth as the Pale Blue Dot in 1990.",
      visualVerb: "real Pale Blue Dot photograph fills the frame; the probe and a paper evidence window drift on separate depth planes",
      caption: "LOOK BACK / HOME",
      soundCue: "shutter breathe, low tape swell, quiet signal wash",
      assets: [
        { id: "earth-setting", ownerSceneId: "earth", role: "setting", file: `${standardRoot}/pale-blue-dot-revisited-pia23645.jpg`, provenance: "licensed-editorial", purpose: "literal NASA/JPL Earth photograph as the main evidence plate", layer: 0 },
        { id: "earth-photo", ownerSceneId: "earth", role: "evidence", file: `${standardRoot}/pale-blue-dot-pia00452.jpg`, provenance: "licensed-editorial", purpose: "original 1990 Pale Blue Dot reference image", layer: 2 },
        { id: "probe-cutout", ownerSceneId: "earth", role: "hero", file: `${cutoutRoot}/probe-cutout.png`, provenance: "generated-original", purpose: "independent probe foreground for depth and focus pulls", layer: 3 },
        { id: "earth-window", ownerSceneId: "earth", role: "prop", provenance: "procedural", purpose: "taped factual photo window", layer: 4 },
        { id: "signal-thread", ownerSceneId: "earth", role: "prop", provenance: "procedural", purpose: "animated causal connector", layer: 5 },
        { id: "earth-title", ownerSceneId: "earth", role: "type", provenance: "procedural", purpose: "short factual title", layer: 6 },
        { id: "analogue-treatment", ownerSceneId: "earth", role: "texture", provenance: "procedural", purpose: "shared film and shutter treatment", layer: 9 },
      ],
    },
    {
      id: "distance",
      startFrame: 330,
      durationInFrames: 120,
      narration: "Now Voyager is beyond the solar system, still carrying that message.",
      claim: "Voyager 1 is the farthest human-made object from Earth.",
      visualVerb: "the probe outruns the record card; Earth fades behind it while the camera pulls into black",
      caption: "STILL OUTBOUND.",
      soundCue: "low relay wash, paper release, long sub tail",
      assets: [
        { id: "final-setting", ownerSceneId: "distance", role: "setting", file: `${assetRoot}/final-message.png`, provenance: "generated-original", purpose: "emotional deep-space closing image", layer: 0 },
        { id: "record-hero", ownerSceneId: "distance", role: "hero", file: `${assetRoot}/final-message.png`, provenance: "generated-original", purpose: "final physical message", layer: 2 },
        { id: "record-cutout", ownerSceneId: "distance", role: "hero", file: `${cutoutRoot}/gold-record-cutout.png`, provenance: "generated-original", purpose: "independent record foreground for final drift", layer: 3 },
        { id: "probe-cutout", ownerSceneId: "distance", role: "hero", file: `${cutoutRoot}/probe-cutout.png`, provenance: "generated-original", purpose: "literal outbound Voyager foreground hero", layer: 4 },
        { id: "earth-slip", ownerSceneId: "distance", role: "prop", file: `${standardRoot}/pale-blue-dot-pia00452.jpg`, provenance: "licensed-editorial", purpose: "literal Earth photo fading into the outbound distance", layer: 5 },
        { id: "final-title", ownerSceneId: "distance", role: "type", provenance: "procedural", purpose: "final concise story landing", layer: 6 },
        { id: "analogue-treatment", ownerSceneId: "distance", role: "texture", provenance: "procedural", purpose: "shared film and shutter treatment", layer: 9 },
      ],
    },
  ],
} as const satisfies AssetFirstShortBoard;
