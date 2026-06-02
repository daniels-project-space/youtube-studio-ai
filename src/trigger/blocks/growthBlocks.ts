/**
 * Growth blocks (Phase 8) — optional, opt-in (not in the default archetypes;
 * add to a channel's pipeline when wanted).
 *
 *   crosspost → posts the rendered video to TikTok/Reels/etc. via Ayrshare,
 *               from its public R2 URL. Degrades to a no-op without a key.
 */
import type { Block, StageContext } from "@/engine/types";
import { hasAyrshareKey, crosspost as ayrCrosspost } from "@/lib/ayrshare";
import { publicUrl } from "@/lib/storage";

function str(ctx: StageContext, key: string): string {
  const v = ctx.store[key];
  if (typeof v !== "string" || v.length === 0) {
    throw new Error(`growth: expected non-empty string store["${key}"]`);
  }
  return v;
}

export const crosspost: Block = {
  id: "crosspost",
  consumes: ["videoKey", "title"],
  produces: ["crosspostIds"],
  run: async (ctx) => {
    if (!hasAyrshareKey()) {
      ctx.log("crosspost: no AYRSHARE_API_KEY — skipping (add vault 'ayrshare')");
      return { crosspostIds: [] };
    }
    const platforms =
      (ctx.params["platforms"] as string[] | undefined) ?? ["tiktok", "instagram"];
    const title = str(ctx, "title");
    const description = (ctx.store["description"] as string | undefined) ?? "";
    const caption = `${title}\n\n${description}`.slice(0, 2200);
    const url = publicUrl(str(ctx, "videoKey"));
    const res = await ayrCrosspost({ mediaUrl: url, caption, platforms });
    ctx.log(`crosspost: ${res.ok ? "ok" : "failed"} → ${res.ids.join(", ") || "(none)"}${res.errors?.length ? ` errors: ${res.errors.join("; ")}` : ""}`);
    return { crosspostIds: res.ids };
  },
};

export const growthBlocks: Block[] = [crosspost];
