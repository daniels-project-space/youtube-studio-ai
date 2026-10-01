export class CasefileRequestError extends Error {}

const sourceProofAttachmentFields = [
  "shotId",
  "sourceId",
  "assetId",
  "rightsEvidenceLocator",
  "assetUrl",
  "assetSha256",
  "approvalReceiptId",
] as const;

function requiredObject(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CasefileRequestError(`${name} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requiredArray(value: unknown, name: string): unknown[] {
  if (!Array.isArray(value)) throw new CasefileRequestError(`${name} must be an array`);
  return value;
}

/**
 * Keep the browser's source-proof handoff deliberately narrow. The workflow
 * derives all packet/provenance fields from the owned episode before it can
 * freeze the exact approved asset obligation.
 */
export function sourceProofMediaAttachments(body: Record<string, unknown>): unknown[] {
  const permittedRequestFields = new Set(["action", "episodeId", "attachments"]);
  const unexpectedRequestFields = Object.keys(body).filter((key) => !permittedRequestFields.has(key));
  if (unexpectedRequestFields.length) {
    throw new CasefileRequestError(
      `source-proof media accepts only action, episodeId, and attachments; unrecognized ${unexpectedRequestFields.join(", ")}`,
    );
  }
  const attachments = requiredArray(body.attachments, "attachments");
  return attachments.map((attachment, index) => {
    const input = requiredObject(attachment, `attachments[${index}]`);
    const unexpectedFields = Object.keys(input).filter(
      (key) => !sourceProofAttachmentFields.includes(key as (typeof sourceProofAttachmentFields)[number]),
    );
    if (unexpectedFields.length) {
      throw new CasefileRequestError(
        `attachments[${index}] contains unrecognized ${unexpectedFields.join(", ")}; packet/provenance fields are server-derived`,
      );
    }
    const missingFields = sourceProofAttachmentFields.filter((key) => input[key] === undefined);
    if (missingFields.length) {
      throw new CasefileRequestError(`attachments[${index}] is missing ${missingFields.join(", ")}`);
    }
    return input;
  });
}
