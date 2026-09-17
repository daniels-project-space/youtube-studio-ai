/** A distinct, typed challenge for releasing one fleet-wide source module. */
export function ownerModuleUnlockConfirmation(moduleKey: string): string {
  return `UNLOCK MODULE ${moduleKey}`;
}
