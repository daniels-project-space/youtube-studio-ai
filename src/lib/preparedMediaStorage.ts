/** Limits metadata transfer, not script, image, audio or generation quality. */
export const PREPARED_METADATA_READ = { maxBytes: 8 * 1024 * 1024, timeoutMs: 30_000 } as const;

export function decodePreparedMetadata(bytes: Uint8Array): unknown {
  if (bytes.byteLength > PREPARED_METADATA_READ.maxBytes) throw new Error("prepared metadata exceeds transfer limit; retain for reconciliation");
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}

/** A missing bucket or ambiguous gateway 404 is not permission to regenerate. */
export function preparedObjectAbsent(error: unknown): boolean {
  const candidate = error as { name?: unknown; $metadata?: { httpStatusCode?: unknown } } | null;
  return candidate?.name === "NoSuchKey" && candidate?.$metadata?.httpStatusCode === 404;
}
