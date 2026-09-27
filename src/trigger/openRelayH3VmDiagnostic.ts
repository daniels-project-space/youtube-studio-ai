import { task } from "@trigger.dev/sdk";
import { bootstrapSecrets } from "@/lib/bootstrap";
import { OpenRelayVmClient } from "@/lib/openRelay";

/** Read-only check of the pinned VM fields; never return IDs or credentials. */
export const openRelayH3VmDiagnostic = task({
  id: "openrelay-h3-vm-diagnostic",
  maxDuration: 60,
  run: async () => {
    await bootstrapSecrets(() => undefined, {
      services: ["youtube"],
      required: ["OPENRELAY_API_KEY", "MINIMAX_H3_OPENRELAY_VM_ID"],
    });
    const key = process.env.OPENRELAY_API_KEY?.trim();
    const id = process.env.MINIMAX_H3_OPENRELAY_VM_ID?.trim();
    if (!key || !id) throw new Error("H3 provider identity is unavailable");
    const vm = await new OpenRelayVmClient({ apiKey: key }).getVm(id);
    return {
      name: vm.name,
      status: vm.status,
      public: vm.public,
      gpuModelName: vm.gpuModelName,
      gpuCount: vm.gpuCount,
      diskSizeGb: vm.diskSizeGb,
    };
  },
});
