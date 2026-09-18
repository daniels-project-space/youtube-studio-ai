/**
 * Nano Banana thumbnail credential boundary.
 *
 * The generic vault is imported by pure Convex functions, so it must remain
 * provider-neutral. This Node/runtime-only adapter is the sole place allowed
 * to combine the Gemini capability with a vault read.
 */
import {
  assertGeminiRuntimeAllowed,
  sealedNanoBananaThumbnailPurpose,
} from "@/lib/gemini";
import { listByService } from "@/lib/vault";

/** Hydrate only the credential admitted for the sealed thumbnail provider. */
export async function hydrateSealedNanoBananaThumbnailCredential(): Promise<string[]> {
  assertGeminiRuntimeAllowed(
    "Nano Banana thumbnail credential",
    sealedNanoBananaThumbnailPurpose(),
  );
  const map = await listByService("gemini");
  const loaded: string[] = [];
  for (const [key, value] of Object.entries(map)) {
    if (!process.env[key]) {
      process.env[key] = value;
      loaded.push(key);
    }
  }
  return loaded;
}
