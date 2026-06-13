import { ConvexHttpClient } from "convex/browser";
import { bootstrapSecrets } from "@/lib/bootstrap";
import { auditionBank } from "@/lib/voicecraft";
(async () => {
  await bootstrapSecrets();
  const convex = new ConvexHttpClient((process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL)!);
  const n = await auditionBank({ convex, ownerId: "owner_daniel", log: (m) => console.log(m) });
  console.log("DONE", n);
})();
