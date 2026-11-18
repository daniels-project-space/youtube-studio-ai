import assert from "node:assert/strict";
import { readBoundedRequestText, RequestBodyTooLarge } from "../readBoundedRequestText";

async function main() {
  const bytes = new TextEncoder().encode("a€b");
  const split = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(bytes.slice(0, 2)); controller.enqueue(bytes.slice(2)); controller.close(); } });
  assert.equal(await readBoundedRequestText(new Request("http://local", { method: "POST", body: split, duplex: "half" } as RequestInit), 5), "a€b");
  let cancelled = false;
  const oversized = new ReadableStream<Uint8Array>({ pull(controller) { controller.enqueue(new Uint8Array(4)); }, cancel() { cancelled = true; } });
  await assert.rejects(readBoundedRequestText(new Request("http://local", { method: "POST", headers: { "content-length": "1" }, body: oversized, duplex: "half" } as RequestInit), 7), RequestBodyTooLarge);
  assert.equal(cancelled, true);
  await assert.rejects(readBoundedRequestText(new Request("http://local", { method: "POST", headers: { "content-length": "100" }, body: "x" }), 7), RequestBodyTooLarge);
  assert.equal(await readBoundedRequestText(new Request("http://local"), 7), "");
  console.log("Request body limits enforce bytes while streaming");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
