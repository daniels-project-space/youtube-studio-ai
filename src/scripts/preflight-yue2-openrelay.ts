import { inspectYuE2OpenRelayAdmission } from "@/lib/openRelayYuE2Admission";

async function main() {
  const [organizationId, ceiling, existingVmId] = process.argv.slice(2);
  if (![4, 5].includes(process.argv.length) || !organizationId || !/^\d+$/u.test(ceiling ?? "")) {
    throw new Error("usage: tsx src/scripts/preflight-yue2-openrelay.ts ORGANIZATION_UUID MAX_HOURLY_CENTS [EXISTING_VM_UUID]");
  }
  console.log(JSON.stringify(await inspectYuE2OpenRelayAdmission({
    apiKey: process.env.OPENRELAY_API_KEY ?? "", expectedOrganizationId: organizationId,
    maximumHourlyCents: Number(ceiling), existingVmId,
  }), null, 2));
}

void main().catch(error => {
  // Zod errors may contain provider fields; do not serialize unknown exceptions.
  console.error(error instanceof Error && error.name !== "ZodError" ? error.message : "Invalid OpenRelay preflight evidence");
  process.exitCode = 1;
});
