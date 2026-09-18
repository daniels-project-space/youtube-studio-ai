import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { ReleaseEvidenceBadge } from "./ReleaseEvidenceBadge";

const historicalCompleted = renderToStaticMarkup(
  <ReleaseEvidenceBadge status="not_ready" compact completedWithoutEvidence />,
);
assert.match(historicalCompleted, /Completed · unverified/);
assert.match(historicalCompleted, /completed run has no retained final-master release evidence/i);

const activePending = renderToStaticMarkup(
  <ReleaseEvidenceBadge status="not_ready" compact />,
);
assert.match(activePending, /Evidence pending/);
assert.doesNotMatch(activePending, /Completed · unverified/);

const retainedMaster = renderToStaticMarkup(
  <ReleaseEvidenceBadge status="not_ready" compact labelContext="master" completedWithoutEvidence />,
);
assert.match(retainedMaster, /Master evidence pending/);
assert.doesNotMatch(retainedMaster, /Completed · unverified/);

console.log("release evidence badge presentation contracts passed");
