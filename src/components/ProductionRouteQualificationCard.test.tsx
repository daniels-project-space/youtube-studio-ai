import assert from "node:assert/strict";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  ProductionRouteQualificationCard,
  productionRouteQualificationSummary,
  type ProductionRouteQualificationSummary,
} from "./ProductionRouteQualificationCard";
import { assessProductionRouteQualification } from "@/engine/productionRouteQualification";

const automatic: ProductionRouteQualificationSummary = {
  mode: "automatic",
  status: "qualified",
  automaticReady: true,
  blockers: [],
};

const supervised: ProductionRouteQualificationSummary = {
  mode: "supervised",
  status: "supervised_review",
  automaticReady: false,
  blockers: [],
};

const blocked: ProductionRouteQualificationSummary = {
  mode: "automatic",
  status: "blocked",
  automaticReady: false,
  blockers: [
    {
      domain: "runtime",
      code: "runtime_evidence_missing",
      message: "runtime evidence is required",
      remediation: "Assess the exact frozen pipeline.",
    },
  ],
};

const unavailableHtml = renderToStaticMarkup(createElement(ProductionRouteQualificationCard));
assert.match(unavailableHtml, /NO RECEIPT CONNECTED/);
assert.match(unavailableHtml, /not proof that a concrete channel route is ready/i);

const automaticHtml = renderToStaticMarkup(
  createElement(ProductionRouteQualificationCard, { qualification: automatic }),
);
assert.match(automaticHtml, /AUTOMATIC/);
assert.match(automaticHtml, /No evidence blockers were reported/i);

const supervisedHtml = renderToStaticMarkup(
  createElement(ProductionRouteQualificationCard, { qualification: supervised }),
);
assert.match(supervisedHtml, /SUPERVISED/);
assert.match(supervisedHtml, /human review remains the selected operating mode/i);

const blockedHtml = renderToStaticMarkup(
  createElement(ProductionRouteQualificationCard, { qualification: blocked }),
);
assert.match(blockedHtml, /BLOCKED/);
assert.match(blockedHtml, /runtime evidence is required/i);
assert.match(blockedHtml, /Assess the exact frozen pipeline/i);

const safeSummary = productionRouteQualificationSummary(assessProductionRouteQualification({}));
assert.equal("evidence" in safeSummary, false);
assert.equal("binding" in safeSummary, false);
assert.equal("qualificationFingerprint" in safeSummary, false);

console.log("production route qualification card tests passed");
