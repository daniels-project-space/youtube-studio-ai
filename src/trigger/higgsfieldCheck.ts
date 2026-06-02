/**
 * `higgsfield-check` — a zero-credit smoke test that proves the Higgsfield CLI
 * runs HOSTLESS inside the Trigger image: it hydrates the injected credential
 * (bootstrapSecrets), then calls `higgsfield account status` (which costs no
 * credits) and returns the balance. If this succeeds in the cloud, the VPS auth
 * pin is gone. Safe to run anytime; it generates nothing.
 */
import { task } from "@trigger.dev/sdk";
import { bootstrapSecrets } from "@/lib/bootstrap";
import { accountStatus } from "@/lib/higgsfield";

export const higgsfieldCheckTask = task({
  id: "higgsfield-check",
  run: async () => {
    const loaded = await bootstrapSecrets((m, x) =>
      console.log(`[hf-check] ${m}`, x ?? ""),
    );
    const status = await accountStatus();
    return {
      ok: true,
      bin: process.env.HIGGSFIELD_BIN ?? "higgsfield",
      xdg: process.env.XDG_CONFIG_HOME ?? null,
      hydratedKeyCount: loaded.length,
      status,
    };
  },
});
