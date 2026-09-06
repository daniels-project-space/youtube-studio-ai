/**
 * A notification must not undo a publish.
 *
 * `notify` runs AFTER upload_draft and immediately BEFORE cleanup. Its sender
 * throws loudly on a missing bot token, a missing chat id, or any Telegram API
 * error — which is right for the sender and wrong here, because the throw:
 *
 *   marked a run FAILED whose video had already been published, and
 *   stopped `cleanup` from ever sealing its retention schedule, so every
 *   intermediate artifact stayed in R2 indefinitely.
 *
 * All for an advisory message whose output, `notified`, is read by nothing.
 *
 * Degrading is therefore correct — but it must never be silent, or the first
 * sign that notifications stopped would be nobody noticing they stopped. The
 * block logs the loss and returns notified:false.
 *
 * This asserts the SHIPPING block's behaviour by running it with the Telegram
 * environment removed, which is the exact condition that used to fail the run.
 */
import assert from "node:assert/strict";

import { notify } from "@/trigger/blocks/lofiBlocks";
import type { StageContext } from "@/engine/types";

const saved = {
  token: process.env.TELEGRAM_BOT_TOKEN,
  chat: process.env.TELEGRAM_CHAT_ID,
  admin: process.env.TELEGRAM_ADMIN_CHAT_ID,
};

function restore(): void {
  for (const [key, value] of Object.entries({
    TELEGRAM_BOT_TOKEN: saved.token,
    TELEGRAM_CHAT_ID: saved.chat,
    TELEGRAM_ADMIN_CHAT_ID: saved.admin,
  })) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function context(logs: string[]): StageContext {
  return {
    store: { watchUrl: "https://youtu.be/abc123", title: "A published video" },
    params: {},
    log: (message: string) => logs.push(message),
    runId: "test-run",
    keyPrefix: "test/",
  } as unknown as StageContext;
}

async function main(): Promise<void> {
  // The exact condition that used to end the run: no Telegram configuration.
  delete process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.TELEGRAM_CHAT_ID;
  delete process.env.TELEGRAM_ADMIN_CHAT_ID;

  const logs: string[] = [];
  const result = await notify.run(context(logs)).catch((error: unknown) => {
    throw new Error(
      `notify THREW after a successful publish — that fails the run and stops cleanup ` +
        `from sealing its retention schedule: ${error instanceof Error ? error.message : String(error)}`,
    );
  });

  assert.equal(
    (result as { notified?: unknown }).notified,
    false,
    "an undelivered notification must report notified:false, not claim success",
  );
  assert.ok(
    logs.some((line) => /NOTIFICATION DID NOT GO OUT/.test(line)),
    `the loss must be named — a silent degrade means nobody learns notifications stopped; got ${JSON.stringify(logs)}`,
  );
  assert.ok(
    logs.some((line) => line.includes("https://youtu.be/abc123")),
    "the log must identify WHICH video went unannounced",
  );
  // The claim and the outcome must not disagree.
  assert.ok(
    !logs.some((line) => /draft-ready sent/.test(line)),
    "nothing may log that the message was sent when it was not",
  );
}

main()
  .then(() => {
    restore();
    console.log("NOTIFY PASS — a failed notification degrades loudly instead of undoing a publish");
  })
  .catch((error) => {
    restore();
    console.error(error);
    process.exit(1);
  });
