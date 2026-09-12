/**
 * @deprecated Compatibility aliases for callers not yet migrated to
 * `creativeText`. No Anthropic credential or endpoint is reachable here.
 */
export {
  OpenRouterGenerationOutcomeUnknownError as ClaudeGenerationOutcomeUnknownError,
  creativeTextJson as claudeJson,
  creativeTextJsonPro as claudeJsonPro,
  hasCreativeTextKey as hasAnthropicKey,
  retryOnUnusableOutput,
  scriptProModel,
} from "@/lib/creativeText";
