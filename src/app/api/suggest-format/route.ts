import { NextResponse } from "next/server";
import { recommendFormatDeterministically, type FormatSelectionInput } from "@/engine/creative/selectFormat";
import { authorizeStudioRoute } from "@/lib/operatorSession";

/**
 * POST /api/suggest-format
 *   { concept: string, niche?, audience?, sampleTopics?: string[] }
 *   → FormatRecommendation { family, available, crew, reasoning, confidence, alternates, fallback }
 *
 * The TEXT path of the channel builder: describe a channel in words and get the
 * best-fit format + the crew it actually needs. This route intentionally uses
 * only a local deterministic advisor, so it remains truthful without a remote
 * model/provider and never claims an unobserved clip was analyzed.
 */
export const runtime = "nodejs";

export async function POST(request: Request) {
  const authFailure = await authorizeStudioRoute(request);
  if (authFailure) return authFailure;
  let body: FormatSelectionInput;
  try {
    body = (await request.json()) as FormatSelectionInput;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  if (!body?.concept?.trim()) {
    return NextResponse.json({ error: "missing concept" }, { status: 400 });
  }
  return NextResponse.json(recommendFormatDeterministically(body));
}
