/**
 * Gemini (Google Generative Language API v1beta) thin wrapper.
 *
 * Two uses for the competitor-intelligence engine:
 *   - geminiJson    — structured JSON generation (SEO databank, title optimise)
 *   - geminiVision  — multimodal image analysis (thumbnail style guide / QA)
 *
 * Key: GEMINI_API_KEY. If absent, callers should `hasGeminiKey()`-guard and
 * degrade gracefully — these functions throw loud only when actually invoked
 * without a key, so the build/import never crashes.
 */

const BASE = "https://generativelanguage.googleapis.com/v1beta";

export class GeminiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GeminiError";
  }
}

export function hasGeminiKey(): boolean {
  return Boolean(process.env.GEMINI_API_KEY);
}

function key(): string {
  const k = process.env.GEMINI_API_KEY;
  if (!k) throw new GeminiError("GEMINI_API_KEY is not configured");
  return k;
}

interface GeminiPart {
  text?: string;
  inlineData?: { mimeType: string; data: string };
  fileData?: { mimeType: string; fileUri: string };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Upload a video to the Gemini File API, wait until it's ACTIVE, then ask the
 * model to WATCH it and answer `prompt`. Used by qa_refine to critique the whole
 * rendered video (not just sampled frames). Returns the model's text/JSON.
 */
export async function geminiVideo(args: {
  path: string;
  prompt: string;
  model?: string;
  json?: boolean;
  maxTokens?: number;
  temperature?: number;
  mimeType?: string;
}): Promise<string> {
  const file = await uploadGeminiVideo(args.path, args.mimeType);
  return geminiVideoUri({ ...args, fileUri: file.fileUri, mimeType: file.mimeType });
}

/** Ask a model to watch an ALREADY-UPLOADED video (reuse one upload across passes). */
export async function geminiVideoUri(args: {
  fileUri: string;
  mimeType: string;
  prompt: string;
  model?: string;
  json?: boolean;
  maxTokens?: number;
  temperature?: number;
}): Promise<string> {
  return generate(
    args.model ?? "gemini-2.5-flash",
    [{ fileData: { mimeType: args.mimeType, fileUri: args.fileUri } }, { text: args.prompt }],
    { json: args.json, maxTokens: args.maxTokens ?? 2048, temperature: args.temperature ?? 0.3 },
  );
}

/** Upload a local video to the Gemini File API and wait until ACTIVE. */
export async function uploadGeminiVideo(
  path: string,
  mime?: string,
): Promise<{ fileUri: string; mimeType: string }> {
  const { readFile } = await import("node:fs/promises");
  const bytes = await readFile(path);
  const mimeType = mime ?? "video/mp4";
  const k = key();

  // 1) start resumable upload
  const start = await fetch(`https://generativelanguage.googleapis.com/upload/v1beta/files?key=${k}`, {
    method: "POST",
    headers: {
      "X-Goog-Upload-Protocol": "resumable",
      "X-Goog-Upload-Command": "start",
      "X-Goog-Upload-Header-Content-Length": String(bytes.length),
      "X-Goog-Upload-Header-Content-Type": mimeType,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ file: { display_name: "render" } }),
  });
  const uploadUrl = start.headers.get("x-goog-upload-url");
  if (!uploadUrl) throw new GeminiError(`gemini file upload start failed: HTTP ${start.status} ${(await start.text()).slice(0, 200)}`);

  // 2) upload bytes + finalize
  const up = await fetch(uploadUrl, {
    method: "POST",
    headers: { "Content-Length": String(bytes.length), "X-Goog-Upload-Offset": "0", "X-Goog-Upload-Command": "upload, finalize" },
    body: bytes,
  });
  if (!up.ok) throw new GeminiError(`gemini file upload failed: HTTP ${up.status} ${(await up.text()).slice(0, 200)}`);
  const uploaded = ((await up.json()) as { file?: { name?: string; uri?: string; state?: string; mimeType?: string } }).file;
  if (!uploaded?.name || !uploaded?.uri) throw new GeminiError("gemini file upload: no file in response");
  const fileName = uploaded.name.replace(/^files\//, "");
  const fileUri = uploaded.uri;
  let state = uploaded.state;
  let fileMime = uploaded.mimeType ?? mimeType;

  // 3) poll until the video finishes processing (ACTIVE)
  for (let i = 0; i < 40 && state === "PROCESSING"; i++) {
    await sleep(3000);
    const st = await fetch(`${BASE}/files/${fileName}?key=${k}`);
    const j = (await st.json()) as { state?: string; mimeType?: string };
    state = j.state;
    if (j.mimeType) fileMime = j.mimeType;
  }
  if (state !== "ACTIVE") throw new GeminiError(`gemini file not ACTIVE (state=${state})`);
  return { fileUri, mimeType: fileMime };
}

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
  error?: { message?: string };
}

async function generate(
  model: string,
  parts: GeminiPart[],
  opts: { json?: boolean; maxTokens?: number; temperature?: number } = {},
): Promise<string> {
  const body: Record<string, unknown> = {
    contents: [{ role: "user", parts }],
    generationConfig: {
      maxOutputTokens: opts.maxTokens ?? 2048,
      temperature: opts.temperature ?? 0.7,
      // Gemini 2.5 FLASH spends maxOutputTokens on internal "thinking" first,
      // which truncated small structured/JSON replies (finishReason MAX_TOKENS)
      // → disable thinking there. PRO REJECTS budget 0 ("only works in thinking
      // mode") — the blanket 0 made every gemini-2.5-pro call fail with HTTP 400
      // (the one-shot long-script path silently fell back to chunked forever).
      ...(/flash/i.test(model) ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
      ...(opts.json ? { responseMimeType: "application/json" } : {}),
    },
  };
  // Retry transient overload / rate-limit / server errors with backoff — Gemini
  // 2.5 Flash frequently returns 503 "high demand", which previously threw and
  // silently degraded vision/JSON callers to placeholder output. Honest grounding
  // means surviving a transient blip, not falling back.
  let json: GeminiResponse | undefined;
  let lastErr = "";
  for (let attempt = 0; attempt < 4; attempt++) {
    // Hard per-attempt deadline: a dead socket with no timeout once hung a
    // render for 2+ hours. Timeouts/network drops are transient -> retry.
    let res: Response;
    try {
      res = await fetch(
        `${BASE}/models/${model}:generateContent?key=${key()}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(120_000),
        },
      );
    } catch (e) {
      lastErr = `network/timeout: ${e instanceof Error ? e.message : e}`;
      if (attempt < 3) {
        await sleep(2000 * (attempt + 1) * (attempt + 1));
        continue;
      }
      throw new GeminiError(`gemini ${model} -> ${lastErr}`);
    }
    json = (await res.json()) as GeminiResponse;
    if (res.ok) break;
    const code = res.status;
    lastErr = `HTTP ${code}: ${json.error?.message ?? ""}`;
    if ((code === 429 || code === 500 || code === 503) && attempt < 3) {
      await sleep(2000 * (attempt + 1) * (attempt + 1)); // 2s, 8s, 18s
      continue;
    }
    throw new GeminiError(`gemini ${model} -> ${lastErr}`);
  }
  const text = json?.candidates?.[0]?.content?.parts
    ?.map((p) => p.text ?? "")
    .join("")
    .trim();
  if (!text) throw new GeminiError(`gemini returned no text${lastErr ? ` (last: ${lastErr})` : ""}`);
  return text;
}

/**
 * Analyze a public YouTube video directly (no download) — Gemini accepts a
 * YouTube URL as a fileData part. Capped to the first `windowSec` seconds to
 * bound cost/latency. Returns the raw model text (use json:true for structured).
 */
export async function geminiAnalyzeYouTube(
  url: string,
  prompt: string,
  opts: { json?: boolean; maxTokens?: number; windowSec?: number; model?: string } = {},
): Promise<string> {
  const window = opts.windowSec ?? 90;
  const part = {
    fileData: { fileUri: url },
    videoMetadata: { startOffset: "0s", endOffset: `${window}s` },
  } as unknown as GeminiPart;
  return generate(opts.model ?? "gemini-2.5-flash", [part, { text: prompt }], {
    json: opts.json ?? true,
    maxTokens: opts.maxTokens ?? 900,
    temperature: 0.3,
  });
}

/**
 * Escape raw control characters INSIDE JSON string literals. Gemini frequently
 * emits real newlines/tabs inside long narration strings ("Bad control
 * character in string literal") — structurally valid JSON otherwise, so repair
 * instead of failing the whole section. Whitespace BETWEEN tokens is left
 * untouched (it's legal JSON).
 */
function escapeCtrlInStrings(s: string): string {
  let out = "";
  let inStr = false;
  let esc = false;
  for (const ch of s) {
    if (inStr) {
      if (esc) { out += ch; esc = false; continue; }
      if (ch === "\\") { out += ch; esc = true; continue; }
      if (ch === '"') { inStr = false; out += ch; continue; }
      const code = ch.charCodeAt(0);
      if (code < 0x20) {
        out += code === 10 ? "\\n" : code === 13 ? "\\r" : code === 9 ? "\\t" : " ";
        continue;
      }
      out += ch;
    } else {
      if (ch === '"') inStr = true;
      out += ch;
    }
  }
  return out;
}

/** Parse a JSON object out of a model response (tolerates code fences). */
export function parseJsonLoose<T = unknown>(text: string): T {
  let s = text.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  // A TRUNCATED response can open a fence and never close it — strip the
  // leading fence anyway (this made every truncated Claude critique unparseable:
  // "Unexpected token '`'").
  s = s.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  // Fall back to the first {...} or [...] span if there's surrounding prose.
  if (!/^[[{]/.test(s)) {
    const m = s.match(/[[{][\s\S]*[\]}]/);
    if (m) s = m[0];
  }
  try {
    return JSON.parse(s) as T;
  } catch {
    try {
      return JSON.parse(escapeCtrlInStrings(s)) as T;
    } catch {
      // Last resort: the reply was TRUNCATED mid-value (maxTokens) — close the
      // open string and any unclosed objects/arrays so the parsed prefix is
      // usable instead of losing the whole result.
      return JSON.parse(closeTruncatedJson(escapeCtrlInStrings(s))) as T;
    }
  }
}

/** Close an unterminated string + unclosed braces/brackets on truncated JSON. */
function closeTruncatedJson(s: string): string {
  let inStr = false;
  let esc = false;
  const stack: string[] = [];
  for (const ch of s) {
    if (inStr) {
      if (esc) { esc = false; continue; }
      if (ch === "\\") { esc = true; continue; }
      if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") stack.push("}");
    else if (ch === "[") stack.push("]");
    else if (ch === "}" || ch === "]") stack.pop();
  }
  let out = s;
  if (esc) out = out.slice(0, -1); // drop a dangling backslash
  if (inStr) out += '"';
  out = out.replace(/,\s*$/, "");
  while (stack.length) out += stack.pop();
  return out;
}

/** Generate strict JSON via Gemini 2.5 Flash (json mode). */
export async function geminiJson<T = unknown>(args: {
  prompt: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
}): Promise<T> {
  const text = await generate(
    args.model ?? "gemini-2.5-flash",
    [{ text: args.prompt }],
    { json: true, maxTokens: args.maxTokens, temperature: args.temperature },
  );
  return parseJsonLoose<T>(text);
}

/**
 * Analyse one or more images (by URL) with a text prompt. Downloads each image,
 * inlines it as base64, and returns the model's text answer. Used for the
 * thumbnail style guide and the thumbnail QA gate.
 */
export async function geminiVision(args: {
  prompt: string;
  imageUrls: string[];
  model?: string;
  json?: boolean;
  maxTokens?: number;
}): Promise<string> {
  const parts: GeminiPart[] = [{ text: args.prompt }];
  for (const url of args.imageUrls.slice(0, 12)) {
    try {
      const r = await fetch(url);
      if (!r.ok) continue;
      const buf = Buffer.from(await r.arrayBuffer());
      const mime = r.headers.get("content-type") ?? "image/jpeg";
      parts.push({
        inlineData: { mimeType: mime, data: buf.toString("base64") },
      });
    } catch {
      /* skip unreachable images */
    }
  }
  return generate(args.model ?? "gemini-2.5-flash", parts, {
    json: args.json,
    maxTokens: args.maxTokens ?? 1024,
  });
}

/**
 * Like {@link geminiVision} but inlines LOCAL image files (e.g. ffmpeg-grabbed
 * frames) instead of fetching URLs. Used by the qa_visual gate.
 */
/**
 * Native AUDIO judging — Gemini hears the clips (base64 mp3) and returns a
 * structured verdict. Used by voice casting (auditions vs the DNA register).
 */
export async function geminiAudioJudge(args: {
  audios: string[]; // base64 mp3
  prompt: string;
  model?: string;
  maxTokens?: number;
}): Promise<{ takes?: { idx?: number; score?: number; note?: string }[]; winner?: number; why?: string }> {
  const parts: GeminiPart[] = [{ text: args.prompt }];
  for (const b64 of args.audios.slice(0, 6)) {
    parts.push({ inlineData: { mimeType: "audio/mpeg", data: b64 } });
  }
  const raw = await generate(args.model ?? "gemini-2.5-flash", parts, {
    json: true,
    maxTokens: args.maxTokens ?? 800,
    temperature: 0.2,
  });
  return parseJsonLoose(raw);
}

export async function geminiVisionLocal(args: {
  prompt: string;
  imagePaths: string[];
  model?: string;
  json?: boolean;
  maxTokens?: number;
}): Promise<string> {
  const { readFile } = await import("node:fs/promises");
  const parts: GeminiPart[] = [{ text: args.prompt }];
  for (const p of args.imagePaths.slice(0, 12)) {
    try {
      const buf = await readFile(p);
      const mime = p.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg";
      parts.push({ inlineData: { mimeType: mime, data: buf.toString("base64") } });
    } catch {
      /* skip unreadable frame */
    }
  }
  return generate(args.model ?? "gemini-2.5-flash", parts, {
    json: args.json,
    maxTokens: args.maxTokens ?? 1024,
  });
}
