/**
 * Recraft V3 via fal.ai — a DESIGN-tuned model (typography + layout + image
 * composed as ONE generation). Used by the thumbnail lab's "recraft" render
 * mode: the whole frame is designed in a single pass, which kills the
 * text-pasted-on-top look. Key: FAL_KEY (vault service "fal").
 */

const ENDPOINT = "https://queue.fal.run/fal-ai/recraft-v3";

/** Hard rail appended to EVERY recraft prompt — the model loves faking YouTube
 * chrome (play buttons, progress bars) which reads as spam in the feed.
 * Kept terse: recraft rejects prompts over 1000 chars (HTTP 422). */
export const NO_UI_CLAUSE =
  " No play buttons, no player UI, no progress bars, no logos, no watermarks.";

/** Recraft's hard API limit — prompts over this 422 at the result endpoint. */
export const RECRAFT_PROMPT_MAX = 1000;

export function hasRecraft(): boolean {
  return !!process.env.FAL_KEY;
}

export async function generateRecraft(args: {
  prompt: string;
  style?: "realistic_image" | "digital_illustration" | "vector_illustration";
  width?: number;
  height?: number;
}): Promise<string | undefined> {
  const key = process.env.FAL_KEY;
  if (!key) throw new Error("FAL_KEY missing (vault service 'fal')");
  const prompt = args.prompt + NO_UI_CLAUSE;
  if (prompt.length > RECRAFT_PROMPT_MAX) {
    throw new Error(`recraft prompt too long (${prompt.length}/${RECRAFT_PROMPT_MAX} chars) — compose tighter`);
  }
  const headers = { Authorization: `Key ${key}`, "content-type": "application/json" };
  const submit = await fetch(ENDPOINT, {
    method: "POST",
    headers,
    body: JSON.stringify({
      prompt,
      image_size: { width: args.width ?? 1280, height: args.height ?? 720 },
      style: args.style ?? "digital_illustration",
    }),
  });
  if (!submit.ok) throw new Error(`recraft submit ${submit.status}: ${(await submit.text()).slice(0, 200)}`);
  const sub = (await submit.json()) as { request_id?: string; status_url?: string; response_url?: string };
  const statusUrl = sub.status_url ?? `${ENDPOINT}/requests/${sub.request_id}/status`;
  const resultUrl = sub.response_url ?? `${ENDPOINT}/requests/${sub.request_id}`;
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const st = (await (await fetch(statusUrl, { headers })).json()) as { status?: string };
    if (st.status === "COMPLETED") {
      const resRaw = await fetch(resultUrl, { headers });
      const res = (await resRaw.json()) as {
        images?: Array<{ url?: string }>;
        image?: { url?: string };
        detail?: unknown;
      };
      const url = res.images?.[0]?.url ?? res.image?.url;
      // fal reports COMPLETED even when the result is a validation error
      // (e.g. prompt over 1000 chars) — surface it, never return undefined.
      if (!url) {
        throw new Error(
          `recraft result ${resRaw.status}: ${JSON.stringify(res.detail ?? res).slice(0, 300)}`,
        );
      }
      return url;
    }
    if (st.status === "FAILED" || st.status === "ERROR") {
      throw new Error(`recraft generation ${st.status}`);
    }
  }
  throw new Error("recraft generation timed out (3min)");
}
