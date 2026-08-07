import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  STUDIO_AUTOMATION_GATES,
  studioAutomationGate,
  type StudioAutomationGate,
} from "@/lib/automationGate";

const gates = Object.values(STUDIO_AUTOMATION_GATES);
const rejectedValues = [undefined, "", "off", "ON", "On", "true", "1", " on "];

for (const gate of gates) {
  assert.deepEqual(studioAutomationGate(gate, { [gate]: "on" }), {
    enabled: true,
    gate,
  });

  for (const value of rejectedValues) {
    assert.deepEqual(studioAutomationGate(gate, { [gate]: value }), {
      disabled: true,
      enabled: false,
      gate,
      requiredValue: "on",
    });
  }
}

type ScheduleContract = {
  file: string;
  exportName: string;
  cron: string;
  gate: StudioAutomationGate;
  hazardousCall: string;
};

const scheduleContracts: ScheduleContract[] = [
  {
    file: "src/trigger/scheduler.ts",
    exportName: "generationScheduler",
    cron: "0 */6 * * *",
    gate: STUDIO_AUTOMATION_GATES.autopilot,
    hazardousCall: "await bootstrapSecrets",
  },
  {
    file: "src/trigger/statsRefresh.ts",
    exportName: "statsRefreshSchedule",
    cron: "0 */6 * * *",
    gate: STUDIO_AUTOMATION_GATES.insights,
    hazardousCall: "await bootstrapSecrets",
  },
  {
    file: "src/trigger/learn.ts",
    exportName: "learningRefreshSchedule",
    cron: "0 7 * * *",
    gate: STUDIO_AUTOMATION_GATES.insights,
    hazardousCall: "return refresh(",
  },
  {
    file: "src/trigger/seoReoptimize.ts",
    exportName: "seoReoptimizeSchedule",
    cron: "0 9 * * 1",
    gate: STUDIO_AUTOMATION_GATES.insights,
    hazardousCall: "return reoptimize(",
  },
  {
    file: "src/trigger/refreshNicheResearch.ts",
    exportName: "refreshNicheResearchSchedule",
    cron: "0 6 * * 1",
    gate: STUDIO_AUTOMATION_GATES.insights,
    hazardousCall: "await bootstrapSecrets",
  },
];

function exportedConstant(source: string, exportName: string): string {
  const start = source.indexOf(`export const ${exportName}`);
  assert.notEqual(start, -1, `${exportName} must remain exported`);
  const nextExport = source.indexOf("\nexport const ", start + 1);
  return source.slice(start, nextExport === -1 ? undefined : nextExport);
}

for (const contract of scheduleContracts) {
  const source = readFileSync(join(process.cwd(), contract.file), "utf8");
  const schedule = exportedConstant(source, contract.exportName);
  assert.ok(
    schedule.includes(`cron: "${contract.cron}"`),
    `${contract.exportName} must declare cron ${contract.cron}`,
  );

  const gateKey =
    contract.gate === STUDIO_AUTOMATION_GATES.autopilot ? "autopilot" : "insights";
  const gateCall = `studioAutomationGate(STUDIO_AUTOMATION_GATES.${gateKey})`;
  const gateIndex = schedule.indexOf(gateCall);
  const earlyReturnIndex = schedule.indexOf("if (!gate.enabled) return gate;");
  const hazardousIndex = schedule.indexOf(contract.hazardousCall);
  assert.notEqual(gateIndex, -1, `${contract.exportName} must evaluate ${contract.gate}`);
  assert.ok(
    earlyReturnIndex > gateIndex && hazardousIndex > earlyReturnIndex,
    `${contract.exportName} must fail closed before ${contract.hazardousCall}`,
  );
}

const manualContracts = [
  ["src/trigger/statsRefresh.ts", "statsRefreshTask"],
  ["src/trigger/learn.ts", "learningRefreshTask"],
  ["src/trigger/seoReoptimize.ts", "seoReoptimizeTask"],
  ["src/trigger/refreshNicheResearch.ts", "refreshNicheResearchTask"],
] as const;

for (const [file, exportName] of manualContracts) {
  const source = readFileSync(join(process.cwd(), file), "utf8");
  const manualTask = exportedConstant(source, exportName);
  assert.doesNotMatch(
    manualTask,
    /studioAutomationGate\(/,
    `${exportName} must remain manually callable when scheduled automation is disabled`,
  );
}

console.log("AUTOMATION GATE PASS: exact fail-closed gates and schedule contracts verified");
