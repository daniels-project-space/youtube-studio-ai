import crypto from "node:crypto";
import { assertLtx25BenchmarkOutputBinding } from "./ltx25BenchmarkOutputProvenance.mjs";

/** Serialize a receipt deterministically before deriving its integrity hash. */
export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error("benchmark receipt contains an undefined value");
  return encoded;
}

export function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function incompleteReason(error) {
  return String(error?.message || error || "unknown failure")
    .replace(/https?:\/\/[^\s"<>]+/g, "[url]")
    .replace(/[A-Za-z0-9_-]{40,}/g, "[redacted]")
    .slice(0, 500);
}

function assertTerminalOutputBindings(unsignedReport) {
  if (!Array.isArray(unsignedReport?.outputs) || unsignedReport.outputs.length < 1) {
    throw new Error("complete LTX benchmark reports require controller output proofs");
  }
  const ids = new Set();
  const keys = new Set();
  for (const output of unsignedReport.outputs) {
    if (!output || typeof output.id !== "string" || !output.id || !output.key || typeof output.key !== "string") {
      throw new Error("complete LTX benchmark reports require identified output artifacts");
    }
    if (ids.has(output.id) || keys.has(output.key)) {
      throw new Error("complete LTX benchmark reports cannot duplicate output artifacts");
    }
    ids.add(output.id);
    keys.add(output.key);
    assertLtx25BenchmarkOutputBinding(output.controllerProof);
  }
}

/**
 * The benchmark has one terminal outcome.  A report is only complete once its
 * R2 object and its immutable checksum metadata have both been observed.
 *
 * `putJson` and `headObject` are injected so this concurrency boundary can be
 * tested without credentials, a GPU, or a provider request.
 */
export function createLtx25BenchmarkTerminal({
  contract,
  reportKey,
  incompleteKey,
  nonce,
  ltxModelManifestKey,
  putJson,
  headObject,
  onIncomplete,
}) {
  let state = "running";
  let incompletePromise;

  async function markIncomplete({ error, signal } = {}) {
    if (state === "complete") return;
    if (!incompletePromise) {
      state = "incomplete";
      const receipt = {
        contract,
        ok: false,
        status: "incomplete",
        nonce,
        ltxModelManifestKey,
        ...(signal ? { signal } : {}),
        reason: incompleteReason(error || `received ${signal || "unknown signal"}`),
      };
      incompletePromise = putJson(incompleteKey, receipt)
        .then(() => onIncomplete?.(incompleteKey))
        // A caller may make one bounded retry if the provider itself was down.
        .catch((markError) => {
          incompletePromise = undefined;
          throw markError;
        });
    }
    return incompletePromise;
  }

  async function sealSuccess(unsignedReport) {
    if (state !== "running") {
      throw new Error(`benchmark cannot seal a success report after terminal state ${state}`);
    }
    assertTerminalOutputBindings(unsignedReport);
    state = "sealing";
    const core = { ...unsignedReport, status: "complete" };
    const report = { ...core, reportSha256: sha256(canonicalJson(core)) };
    const bodyLength = Buffer.byteLength(JSON.stringify(report));
    const metadata = {
      "report-sha256": report.reportSha256,
      "terminal-status": "complete",
    };

    await putJson(reportKey, report, metadata);
    const head = await headObject(reportKey);
    if (head?.ContentLength !== bodyLength
      || head.Metadata?.["report-sha256"] !== report.reportSha256
      || head.Metadata?.["terminal-status"] !== "complete") {
      throw new Error("benchmark success report could not be sealed and verified in R2");
    }
    // A signal can arrive while either R2 request is in flight.  In that case
    // the incomplete receipt wins and this report is deliberately not accepted.
    if (state !== "sealing") {
      throw new Error(`benchmark was interrupted while sealing its success report (${state})`);
    }
    state = "complete";
    return report;
  }

  return {
    markIncomplete,
    sealSuccess,
    state: () => state,
  };
}
