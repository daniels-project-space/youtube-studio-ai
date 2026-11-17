import { z } from "zod";
import { authorizeStudioRoute } from "@/lib/operatorSession";
import { checkWorkshopPipeline } from "@/engine/workshopPipelineCheck";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const inputSchema = z.object({
  family: z.string().min(1).max(80),
  entries: z.array(z.object({
    block: z.string().regex(/^[a-z][a-z0-9_]{0,79}$/),
    version: z.string().min(1).max(80).optional(),
    params: z.record(z.string(), z.unknown()).optional(),
  }).strict()).max(100),
}).strict();

export async function POST(request: Request) {
  const denied = await authorizeStudioRoute(request);
  if (denied) return denied;
  const raw = await request.text();
  if (Buffer.byteLength(raw) > 100_000) return Response.json({ ok: false, error: "Draft is too large to check" }, { status: 413 });
  let input: z.infer<typeof inputSchema>;
  try { input = inputSchema.parse(JSON.parse(raw)); }
  catch { return Response.json({ ok: false, error: "Invalid draft or format" }, { status: 400 }); }
  try {
    return Response.json({ ok: true, result: checkWorkshopPipeline(input.family, input.entries) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "Compatibility check failed" }, { headers: { "Cache-Control": "no-store" } });
  }
}
