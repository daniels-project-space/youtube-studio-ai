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

export type StudioAnalyticsRefreshGateDecision =
  | {
      enabled: true;
      gate: typeof STUDIO_AUTOMATION_GATES.insights;
    }
  | {
      disabled: true;
      enabled: false;
      gate: typeof STUDIO_AUTOMATION_GATES.insights;
      requiredValue: "not_off";
    };

/**
 * Analytics ingestion only reconciles read-only data from a connected YouTube
 * channel. It does not spend, alter metadata, render, or publish, so leaving
 * a dashboard stale must not be the default. Set the exact value `off` to
 * pause this schedule immediately.
 */
export function studioAnalyticsRefreshGate(
  env: Readonly<Record<string, string | undefined>> = process.env,
): StudioAnalyticsRefreshGateDecision {
  const gate = STUDIO_AUTOMATION_GATES.insights;
  if (env[gate] !== "off") return { enabled: true, gate };
  return { disabled: true, enabled: false, gate, requiredValue: "not_off" };
}

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
