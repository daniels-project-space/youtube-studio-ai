export const STUDIO_AUTOMATION_GATES = {
  autopilot: "STUDIO_AUTOPILOT",
  insights: "STUDIO_INSIGHTS_AUTOMATION",
} as const;

export type StudioAutomationGate =
  (typeof STUDIO_AUTOMATION_GATES)[keyof typeof STUDIO_AUTOMATION_GATES];

export type StudioAutomationGateDecision =
  | {
      enabled: true;
      gate: StudioAutomationGate;
    }
  | {
      disabled: true;
      enabled: false;
      gate: StudioAutomationGate;
      requiredValue: "on";
    };

/**
 * Scheduled automation is fail-closed: only the exact, case-sensitive value
 * `on` is accepted. Deliberately do not trim or normalize the configured value.
 */
export function studioAutomationGate(
  gate: StudioAutomationGate,
  env: Readonly<Record<string, string | undefined>> = process.env,
): StudioAutomationGateDecision {
  if (env[gate] === "on") return { enabled: true, gate };
  return { disabled: true, enabled: false, gate, requiredValue: "on" };
}
