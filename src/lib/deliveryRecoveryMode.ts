export type DeliveryRecoveryMode = "individual" | "shared";

/** Changing this deployment setting requires schedule synchronization and verification. */
export function deliveryRecoveryMode(): DeliveryRecoveryMode {
  const mode = process.env.STUDIO_DELIVERY_RECOVERY_MODE ?? "individual";
  if (mode !== "individual" && mode !== "shared") {
    throw new Error("STUDIO_DELIVERY_RECOVERY_MODE must be individual or shared");
  }
  return mode;
}
