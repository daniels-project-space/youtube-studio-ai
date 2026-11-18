export class RequestBodyTooLarge extends Error {}

/** Bound bytes while reading, including requests with an absent or false Content-Length. */
export async function readBoundedRequestText(request: Request, maxBytes: number): Promise<string> {
  const length = request.headers.get("content-length");
  if (length && /^\d+$/.test(length) && Number(length) > maxBytes) throw new RequestBodyTooLarge();
  if (!request.body) return "";
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let result = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) return result + decoder.decode();
      size += value.byteLength;
      if (size > maxBytes) {
        void reader.cancel().catch(() => {});
        throw new RequestBodyTooLarge();
      }
      result += decoder.decode(value, { stream: true });
    }
  } finally { reader.releaseLock(); }
}
