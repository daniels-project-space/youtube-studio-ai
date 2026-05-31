/**
 * Telegram notifier (MASTER-PLAN — alerts on draft-ready / failures /
 * Higgsfield token expiry). Bot token + chat id come from env (vault-hydrated),
 * never hardcoded.
 *
 *   TELEGRAM_BOT_TOKEN  - bot token from @BotFather
 *   TELEGRAM_CHAT_ID    - default chat to notify
 */

export interface TelegramOptions {
  /** Override the default chat id. */
  chatId?: string;
  /** Telegram parse mode (default: none → plain text). */
  parseMode?: "MarkdownV2" | "HTML" | "Markdown";
  /** Disable link previews. */
  disablePreview?: boolean;
}

function requireToken(): string {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not configured");
  return token;
}

function resolveChatId(override?: string): string {
  const chatId = override ?? process.env.TELEGRAM_CHAT_ID;
  if (!chatId) throw new Error("TELEGRAM_CHAT_ID is not configured");
  return chatId;
}

/**
 * Send a Telegram message via the bot API. Resolves to the message id on
 * success; throws loud on API error (no silent swallow).
 */
export async function sendMessage(
  text: string,
  opts: TelegramOptions = {},
): Promise<number> {
  const token = requireToken();
  const chatId = resolveChatId(opts.chatId);

  const body: Record<string, unknown> = {
    chat_id: chatId,
    text,
    disable_web_page_preview: opts.disablePreview ?? true,
  };
  if (opts.parseMode) body.parse_mode = opts.parseMode;

  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  const json = (await res.json()) as {
    ok: boolean;
    description?: string;
    result?: { message_id: number };
  };
  if (!res.ok || !json.ok) {
    throw new Error(
      `telegram sendMessage failed: ${json.description ?? `HTTP ${res.status}`}`,
    );
  }
  return json.result!.message_id;
}

/** Convenience: tag a message as a failure alert. */
export async function alertFailure(
  context: string,
  error: string,
  opts: TelegramOptions = {},
): Promise<number> {
  return sendMessage(`❌ ${context}\n${error}`, opts);
}

/** Convenience: draft-ready ping with an optional link. */
export async function notifyDraftReady(
  title: string,
  link?: string,
  opts: TelegramOptions = {},
): Promise<number> {
  const body = link
    ? `✅ Draft ready: ${title}\n${link}`
    : `✅ Draft ready: ${title}`;
  return sendMessage(body, opts);
}
