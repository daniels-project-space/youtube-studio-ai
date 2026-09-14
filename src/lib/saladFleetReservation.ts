import { sha256Hex } from "@/lib/sha256";

/** Shared logical fleet fence for every Salad weekly order. */
export const SALAD_FLEET_RESERVATION_VERSION = "salad-fleet-reservation/v1" as const;
export const SALAD_FLEET_RESERVATION_LEASE_MS = 2 * 60 * 60 * 1_000;
export const SALAD_FLEET_MAX_GPU_SLOTS = 3;

export type SaladFleetReservationPriority = "medium" | "high";

export interface SaladFleetReservationInput {
  ownerId: string;
  orderKey: string;
  requestKeys: readonly string[];
  requestedGpuCount: number;
  priority: SaladFleetReservationPriority;
}

export interface SaladFleetReservationIdentity {
  version: typeof SALAD_FLEET_RESERVATION_VERSION;
  reservationKey: string;
  ownerId: string;
  orderKey: string;
  requestedGpuCount: number;
  priority: SaladFleetReservationPriority;
}

function safePart(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 160 || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(normalized)) {
    throw new Error(`Salad fleet reservation ${label} is invalid`);
  }
  return normalized;
}

/** Stable key lets Trigger retries reuse one held reservation, never buy twice. */
export function saladFleetReservationIdentity(input: SaladFleetReservationInput): SaladFleetReservationIdentity {
  const ownerId = safePart(input.ownerId, "owner id");
  const orderKey = safePart(input.orderKey, "order key");
  if (!Number.isSafeInteger(input.requestedGpuCount) || input.requestedGpuCount < 1 || input.requestedGpuCount > SALAD_FLEET_MAX_GPU_SLOTS) {
    throw new Error(`Salad fleet reservation GPU count must be 1..${SALAD_FLEET_MAX_GPU_SLOTS}`);
  }
  if (input.priority !== "medium" && input.priority !== "high") throw new Error("Salad fleet reservation priority is invalid");
  const requestDigest = sha256Hex(JSON.stringify([...input.requestKeys]));
  return {
    version: SALAD_FLEET_RESERVATION_VERSION,
    reservationKey: `h3-weekly:${sha256Hex(`${ownerId}:${orderKey}:${requestDigest}`)}`,
    ownerId,
    orderKey,
    requestedGpuCount: input.requestedGpuCount,
    priority: input.priority,
  };
}

export function saladFleetReservationExpiry(now: number): number {
  if (!Number.isSafeInteger(now) || now <= 0) throw new Error("Salad fleet reservation timestamp is invalid");
  return now + SALAD_FLEET_RESERVATION_LEASE_MS;
}

