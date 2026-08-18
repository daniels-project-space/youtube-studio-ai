import assert from "node:assert/strict";
import {
  assessDocumentaryVisualQuality,
  documentaryVisualProofsFor,
  editorialCoverageFor,
  editorialMotionArcFor,
  editorialTypographyFor,
} from "../documentaryVisualQuality";

function run(): void {
  const earthProofs = documentaryVisualProofsFor(
    "Voyager carried images from Earth.",
    "Earth images on the record",
  );
  assert.ok(earthProofs.some((proof) => proof.id === "earth-photograph"));

  const slop = assessDocumentaryVisualQuality([{
    narration: "Voyager carried images from Earth.",
    beat: "Earth images on the record",
    kind: "photo_slide",
    camera: { move: "drift", intensity: "subtle" },
    assets: [{ brief: "generic dark documentary collage background" }],
  }]);
  assert.equal(slop.grade, "slop");
  assert.ok(slop.blockers.some((blocker) => blocker.includes("photograph of Earth")));

  const directed = (shot: {
    narration: string;
    beat: string;
    kind: string;
    scale: "establishing" | "wide" | "medium" | "close";
    camera: { move: "push_in" | "pull_back" | "pan_left" | "pan_right" | "drift"; intensity: "subtle" | "medium" | "strong"; revealMove?: "push_in" | "pull_back" | "pan_left" | "pan_right" | "drift"; revealAtPercent?: number };
    assets: Array<{ brief: string }>;
    rackFocus?: "near_to_far" | "far_to_near";
  }) => ({
    ...shot,
    durationSec: 5,
    coverage: editorialCoverageFor(shot.narration, shot.beat, shot.kind),
    motionArc: editorialMotionArcFor(shot.narration, shot.beat, shot.camera),
    typography: editorialTypographyFor(shot.kind),
  });
  const good = assessDocumentaryVisualQuality([
    directed({
      narration: "In 1977, Voyager left Earth with a Golden Record.",
      beat: "Voyager and the Golden Record",
      kind: "parallax_portrait",
      scale: "establishing",
      camera: { move: "push_in", intensity: "strong", revealMove: "pan_right", revealAtPercent: 0.52 },
      assets: [{ brief: "NASA photograph of Voyager carrying the Golden Record" }, { brief: "earth launch environment" }],
    }),
    directed({
      narration: "It carried 115 images and 55 greetings.",
      beat: "a spread of photographs and greetings",
      kind: "evidence_board",
      scale: "wide",
      camera: { move: "pan_left", intensity: "medium", revealMove: "push_in", revealAtPercent: 0.48 },
      assets: [{ brief: "a contact sheet of Earth photographs and a greeting voice archive" }, { brief: "paper evidence board" }],
    }),
    directed({
      narration: "Later, Voyager photographed Earth as a pale blue dot.",
      beat: "a photograph of Earth",
      kind: "depth_parallax",
      scale: "medium",
      camera: { move: "pull_back", intensity: "medium", revealMove: "push_in", revealAtPercent: 0.48 },
      rackFocus: "near_to_far",
      assets: [{ brief: "NASA photograph of Earth from Voyager, the pale blue dot" }],
    }),
    directed({
      narration: "Now Voyager drifts beyond the solar system.",
      beat: "Voyager beyond the solar system",
      kind: "matte_sequence",
      scale: "close",
      camera: { move: "pan_right", intensity: "medium", revealMove: "push_in", revealAtPercent: 0.48 },
      assets: [{ brief: "Voyager spacecraft moving beyond the solar system" }, { brief: "deep interstellar space" }],
    }),
  ]);
  assert.equal(good.grade, "good");
  assert.equal(good.blockers.length, 0);
}

run();
