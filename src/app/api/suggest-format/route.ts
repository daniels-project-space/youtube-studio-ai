import { NextResponse } from "next/server";
import { bootstrapSecrets } from "@/lib/bootstrap";
import { selectFormat, type FormatSelectionInput } from "@/engine/creative/selectFormat";

/**
 * POST /api/suggest-format
 *   { concept: string, niche?, audience?, sampleTopics?: string[] }
 *   → FormatRecommendation { family, available, crew, reasoning, confidence, alternates, fallback }
 *
 * The TEXT path of the channel builder: describe a channel in words and get the
 * best-fit format + the crew it actually needs. Complements /api/analyze-clip
 * (the "I have an example video" path). Gemini direct (vault-hydrated), server-only.
 */
export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: FormatSelectionInput;
  try {
    body = (await request.json()) as FormatSelectionInput;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  if (!body?.concept?.trim()) {
    return NextResponse.json({ error: "missing concept" }, { status: 400 });
  }
  try {
    await bootstrapSecrets((m) => console.log(`[suggest-format] ${m}`));
    const rec = await selectFormat(body, (m) => console.log(`[suggest-format] ${m}`));
    return NextResponse.json(rec);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "selection failed" },
      { status: 500 },
    );
  }
}
