import { config } from "dotenv"; config({ path: ".env.local" });
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { designPipeline } from "../../src/engine/designer";

const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL as string);
const log = (m: string) => console.log(`[repair2] ${m}`);

async function main() {
  // COMIC: fresh floor (FAMILY_CREW.comic now composer-free) + GLOBAL DNA
  // string repair + aggressive pool dedupe by rare-token overlap.
  {
    const id = "j97btry53hv0y363bwq6w69yx989wqr0" as Id<"channels">;
    const ch = (await convex.query(api.channels.getChannel, { channelId: id })) as Record<string, any>;
    const d = designPipeline({ family: "comic", nicheKey: "history", lengthMinutes: 3, publishMode: "draft", toggles: { shorts: false, crosspost: false } });
    const dnaStr = JSON.stringify(ch.styleDNA ?? {})
      .replace(/papercraft|paper-craft|paper craft/gi, "inked comic-book art")
      .replace(/diorama[a-z-]*/gi, "comic page")
      .replace(/parallax( layers?| depth)?/gi, "3D page-camera moves")
      .replace(/breathing (cutouts?|figures?)/gi, "hand-drawn panel reveals")
      .replace(/torn-paper transitions?/gi, "page turns")
      .replace(/layered cut-?outs?/gi, "inked panels");
    const identity = JSON.parse(JSON.stringify(ch.identity ?? {}));
    const kept: string[] = [];
    const keptToks: Set<string>[] = [];
    for (const t of identity.topicPool ?? []) {
      if (/channel style|deep dive|documentary style|youtube|style deep/i.test(t)) continue;
      const toks = new Set(String(t).toLowerCase().match(/[a-z]{4,}/g) ?? []);
      const dup = keptToks.some((k) => {
        const inter = [...toks].filter((x) => k.has(x)).length;
        return inter / Math.max(1, Math.min(toks.size, k.size)) >= 0.6;
      });
      if (!dup) { kept.push(t); keptToks.push(toks); }
    }
    identity.topicPool = kept.slice(0, 20);
    await convex.mutation(api.channels.updateChannel, { channelId: id, pipeline: d.pipeline, styleDNA: JSON.parse(dnaStr), identity });
    log(`comic: pipeline=${d.pipeline.map(p=>p.block).join(",")} | pool ${(ch.identity?.topicPool ?? []).length}->${kept.length}`);
  }
  // LOFI: qaRubric global re-anchor (anime-character + cafe phrasing out).
  {
    const id = "j9734c02jsjc5d04ta5ax9g43n89wxwv" as Id<"channels">;
    const ch = (await convex.query(api.channels.getChannel, { channelId: id })) as Record<string, any>;
    if (ch.qaRubric) {
      const s = JSON.stringify(ch.qaRubric)
        .replace(/Anime-style character silhouetted against a rainy window/gi, "Rain-streaked floor-to-ceiling penthouse window wall, warm lamplight against the neon city below")
        .replace(/anime-style character[^"]*/gi, "rain-streaked penthouse window view")
        .replace(/café|cafe/gi, "penthouse")
        .replace(/cozy, art-filled/gi, "luxurious neon-lit");
      await convex.mutation(api.channels.updateChannel, { channelId: id, qaRubric: JSON.parse(s) });
      log("lofi: qaRubric re-anchored");
    }
  }
  log("repair2 done");
}
main().catch((e) => { console.error(e); process.exit(1); });
