/**
 * Mastra agent layer (hybrid: Mastra authors the agent calls; the block engine
 * still orchestrates the pipeline DAG; Trigger.dev runs it).
 *
 * Creative agents shared by every chunk use the pinned OpenRouter Gemini 3.7
 * Flash route. Direct-provider SDKs are intentionally not eligible here;
 * image generation remains separately limited to the sealed thumbnail module.
 *
 * `agentJson()` is the single entry point chunks call. It uses the Mastra agent
 * when its bundle is available (structured output validated by a zod schema,
 * traced to Langfuse when keys are present). A REST fallback is permitted only
 * when that bundle was unavailable before a provider submission. Once
 * `agent.generate()` has started, a failure or malformed response may represent
 * a paid outcome, so it must fail closed rather than buy the same work twice.
 *
 * Mastra + AI-SDK packages are dynamically imported so a module-load/bundle
 * problem is caught here rather than crashing the Trigger task at import time.
 * They are also marked `external` in trigger.config.ts so they install in the
 * image rather than being bundled.
 */
import type { z } from "zod";
import { claudeJson, hasAnthropicKey } from "@/lib/anthropic";
import { openRouterModel } from "@/lib/openRouter";
import {
  getOrCreateModelResponse,
  modelResponseContractIdentity,
  modelRequestCacheKey,
  recordModelUsage,
} from "@/lib/modelUsage";

/**
 * Agent roles. `producer` + `director` are the original generate/critique pair;
 * the rest are the FILM CREW (creative-direction layer). Each role is a named
 * Mastra agent with persistent instructions, so per-agent traces show up in
 * Langfuse. The crew's *function* is fixed here; its per-channel *goal* arrives
 * in the prompt (the Show Bible).
 */
export type AgentRole =
  | "producer"
  | "director"
  | "showrunner"
  | "crew_director"
  | "cinematographer"
  | "editor"
  | "composer"
  | "critic";

const FLASH_MODEL = openRouterModel("intelligence");
const CREATIVE_MODEL = openRouterModel("creative");

interface RoleConfig {
  /** Pinned creative-text provider. Mastra cannot bypass this boundary. */
  provider: "openrouter";
  model: string;
  /**
   * Coarse tier for response budgeting. Both tiers resolve to the pinned
   * OpenRouter model, while retaining the existing caller contract.
   */
  tier: "flash" | "pro";
  instructions: string;
}

/**
 * Text agents use the pinned OpenRouter Gemini route. Image generation remains
 * separately limited to the sealed Nano Banana thumbnail module.
 */
const ROLE_CONFIG: Record<AgentRole, RoleConfig> = {
  producer: {
    provider: "openrouter",
    model: FLASH_MODEL,
    tier: "flash",
    instructions:
      "You are the Producer in an autonomous YouTube content pipeline. You generate " +
      "high-quality candidates that strictly fit the given channel identity and " +
      "constraints. Always return valid structured output and nothing else.",
  },
  director: {
    provider: "openrouter",
    model: CREATIVE_MODEL,
    tier: "pro",
    instructions:
      "You are the Director: a senior YouTube content strategist and critic. You " +
      "judge candidates against channel identity, freshness/distinctiveness, and " +
      "audience appeal. Score objectively (0..1) and return concrete, actionable " +
      "issues as structured output.",
  },
  showrunner: {
    provider: "openrouter",
    model: CREATIVE_MODEL,
    tier: "pro",
    instructions:
      "You are the Showrunner: you define a YouTube channel's creative essence. From a " +
      "niche + format + competitor signals you write the show bible — positioning, the " +
      "emotional vibe, the one iconic visual motif, exactly what WORKS in this space and " +
      "(critically) what does NOT, and which crew roles the channel needs. Be specific and " +
      "opinionated; generic answers are failures. Return structured output only.",
  },
  crew_director: {
    provider: "openrouter",
    model: FLASH_MODEL,
    tier: "flash",
    instructions:
      "You are the Director (narrative). For one video you design the STRUCTURE: a " +
      "scroll-stopping hook and an ordered beat map with intended durations and the emotional " +
      "intent of each beat, faithful to the channel's vibe. Return structured output only.",
  },
  cinematographer: {
    provider: "openrouter",
    model: FLASH_MODEL,
    tier: "flash",
    instructions:
      "You are the Cinematographer (DP). You own the LOOK: concrete footage/keyframe " +
      "selection criteria, color/mood, and motion language for one video, consistent with the " +
      "channel's iconic motif. Output concrete search queries / prompt styles, not adjectives. " +
      "Return structured output only.",
  },
  editor: {
    provider: "openrouter",
    model: FLASH_MODEL,
    tier: "flash",
    instructions:
      "You are the Editor. You own CUTS & RHYTHM: cut cadence per section, transition language, " +
      "caption styling, and overlay placement rules for one video, matched to the channel's pace. " +
      "Return structured output only.",
  },
  composer: {
    provider: "openrouter",
    model: FLASH_MODEL,
    tier: "flash",
    instructions:
      "You are the Composer / Sound designer. You write the MUSIC generation prompt (genre, " +
      "instrumentation, dynamics, BPM band, and what to avoid) and the audio brief (ducking, " +
      "bed loudness, optional voice FX) for one video, true to the channel's vibe. Return " +
      "structured output only.",
  },
  critic: {
    provider: "openrouter",
    model: FLASH_MODEL,
    tier: "flash",
    instructions:
      "You are the Critic / QA Director. You author the VALIDATION SPEC for one video: the " +
      "specific, checkable assertions it must satisfy given its format and the channel's " +
      "dealbreakers, each with a check kind, threshold, and severity. Prefer deterministic, " +
      "measurable checks. Return structured output only.",
  },
};

interface MastraUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  reasoningTokens?: number;
  cachedInputTokens?: number;
  inputTokenDetails?: { cacheReadTokens?: number };
  outputTokenDetails?: { textTokens?: number; reasoningTokens?: number };
}

interface MastraGenerationResponse {
  object?: unknown;
  usage?: MastraUsage;
  totalUsage?: MastraUsage;
  modelId?: string;
  response?: { id?: string; modelId?: string };
}

interface MastraBundle {
  // Minimal shape we use — kept loose to avoid coupling to Mastra's types here.
  getAgent: (id: AgentRole) => {
    generate: (
      prompt: string,
      opts: Record<string, unknown>,
    ) => Promise<MastraGenerationResponse>;
  };
}

function finiteToken(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

function recordMastraUsage(
  configuredModel: string,
  response: MastraGenerationResponse,
): void {
  const usage = response.totalUsage ?? response.usage;
  const reasoning =
    finiteToken(usage?.outputTokenDetails?.reasoningTokens) ??
    finiteToken(usage?.reasoningTokens) ??
    0;
  const totalOutput = finiteToken(usage?.outputTokens);
  const textOutput =
    finiteToken(usage?.outputTokenDetails?.textTokens) ??
    (totalOutput !== undefined ? Math.max(0, totalOutput - reasoning) : undefined);
  recordModelUsage({
    provider: "mastra",
    model: response.response?.modelId ?? response.modelId ?? configuredModel,
    kind: "text",
    requestId: response.response?.id,
    inputTokens: finiteToken(usage?.inputTokens),
    outputTokens: textOutput,
    reasoningTokens: reasoning,
    cachedInputTokens:
      finiteToken(usage?.inputTokenDetails?.cacheReadTokens) ??
      finiteToken(usage?.cachedInputTokens),
    totalTokens: finiteToken(usage?.totalTokens),
    ...(!usage ? { unpricedReason: "Mastra/AI SDK response omitted usage" } : {}),
  });
}

let bundlePromise: Promise<MastraBundle | null> | null = null;
let mastraDisabled = false;

/**
 * `agent.generate()` does not expose a durable provider receipt that lets us
 * distinguish a local failure from a request accepted by the model provider.
 * Callers and retry policy must therefore treat every post-dispatch Mastra
 * failure as terminal until an explicit recovery/reconciliation path exists.
 */
export class MastraGenerationOutcomeUnknownError extends Error {
  readonly code = "mastra_generation_outcome_unknown";
  readonly retryable = false;

  constructor(role: AgentRole, detail: string, options?: ErrorOptions) {
    super(
      `agentJson(${role}): Mastra generation may already have consumed provider work; ` +
        `refusing REST fallback: ${detail}`,
      options,
    );
    this.name = "MastraGenerationOutcomeUnknownError";
  }
}

/** A native provider rejected the request before a generation could start. */
export class MastraGenerationUnavailableError extends Error {
  readonly code = "mastra_generation_unavailable";
  readonly retryable = false;

  constructor(role: AgentRole, detail: string, options?: ErrorOptions) {
    super(`agentJson(${role}): native provider is unavailable before generation: ${detail}`, options);
    this.name = "MastraGenerationUnavailableError";
  }
}

function knownPreGenerationProviderFailure(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const rawStatus = (error as { statusCode?: unknown; status?: unknown }).statusCode
    ?? (error as { status?: unknown }).status;
  return typeof rawStatus === "number" && rawStatus >= 400 && rawStatus < 500 && rawStatus !== 408;
}

/**
 * Mastra does not yet own an OpenRouter-only provider adapter in this app.
 * Calling it would let the SDK select a native provider, which violates the
 * pinned route. Keep the REST OpenRouter boundary as the sole dispatch path.
 */
function hasDirectMastraCredential(_model: string): boolean {
  return false;
}

/**
 * Validate a completed Mastra response without offering a second provider
 * route. This is deliberately separate from generation so a response that was
 * accepted but cannot satisfy the requested contract is still terminal.
 */
export function parseMastraStructuredObject<T>(args: {
  role: AgentRole;
  schema: z.ZodType<T>;
  response: MastraGenerationResponse;
}): T {
  if (args.response.object === undefined || args.response.object === null) {
    throw new MastraGenerationOutcomeUnknownError(
      args.role,
      "agent.generate() returned no structured object",
    );
  }
  try {
    return args.schema.parse(args.response.object);
  } catch (error) {
    throw new MastraGenerationOutcomeUnknownError(
      args.role,
      "agent.generate() returned a structured object that failed the requested contract",
      { cause: error },
    );
  }
}

/** Build (once) the Mastra instance + agents + optional Langfuse exporter. */
async function getBundle(): Promise<MastraBundle | null> {
  if (mastraDisabled) return null;
  if (bundlePromise) return bundlePromise;
  bundlePromise = (async () => {
    try {
      const { Mastra } = await import("@mastra/core");
      const { Agent } = await import("@mastra/core/agent");

      // One named Mastra agent per role (producer, director, + the film crew).
      const agents: Record<string, unknown> = {};
      for (const [role, cfg] of Object.entries(ROLE_CONFIG)) {
        agents[role] = new Agent({
          id: role,
          name: role,
          instructions: cfg.instructions,
          model: cfg.model,
        });
      }

      // Optional Langfuse tracing — only when keys are configured.
      let observability: unknown = undefined;
      if (process.env.LANGFUSE_PUBLIC_KEY && process.env.LANGFUSE_SECRET_KEY) {
        try {
          const { Observability } = await import("@mastra/observability");
          const { LangfuseExporter } = await import("@mastra/langfuse");
          observability = new Observability({
            configs: {
              default: {
                serviceName: "youtube-studio-ai",
                exporters: [
                  new LangfuseExporter({
                    publicKey: process.env.LANGFUSE_PUBLIC_KEY,
                    secretKey: process.env.LANGFUSE_SECRET_KEY,
                    baseUrl: process.env.LANGFUSE_BASE_URL,
                    realtime: true,
                  }),
                ],
              },
            },
          });
        } catch (e) {
          // Tracing is best-effort — but say WHY it's off (the silent catch hid
          // a missing @mastra/observability dep for weeks: "traced to Langfuse
          // when keys are present" was simply false).
          console.warn(`[mastra] Langfuse tracing unavailable: ${e instanceof Error ? e.message : e}`);
        }
      }

      const mastra = new Mastra({
        agents,
        ...(observability ? { observability } : {}),
      } as ConstructorParameters<typeof Mastra>[0]);

      return mastra as unknown as MastraBundle;
    } catch (e) {
      // Mastra unavailable (bundle/runtime) — disable for the process; REST covers.
      // LOUD once: the silent latch made a broken Mastra install indistinguishable
      // from a healthy one (everything quietly fell back to REST forever).
      console.warn(`[mastra] stack unavailable — REST fallback for this process: ${e instanceof Error ? e.message : e}`);
      mastraDisabled = true;
      return null;
    }
  })();
  return bundlePromise;
}

export interface AgentJsonOptions<T> {
  role: AgentRole;
  prompt: string;
  schema: z.ZodType<T>;
  /** REST-fallback system prompt (Mastra uses the agent's instructions). */
  system?: string;
  temperature?: number;
  maxTokens?: number;
  log?: (msg: string) => void;
}

/**
 * Structured generation via the named agent. Mastra-first (validated + traced),
 * with REST fallback only when the Mastra bundle was unavailable before any
 * provider submission.
 */
export async function agentJson<T>(o: AgentJsonOptions<T>): Promise<T> {
  const log = o.log ?? (() => {});
  const cfg = ROLE_CONFIG[o.role];
  const responseContract = modelResponseContractIdentity(o.schema);
  const requestKey = modelRequestCacheKey("openrouter", cfg.model, {
    role: o.role,
    prompt: o.prompt,
    // Mastra itself uses the sealed role instructions, but this is the exact
    // system prompt sent by the non-Google REST recovery path. Keep it in the
    // identity so two callers that intentionally change that quality contract
    // can never share a response during a concurrent recovery.
    system: o.system?.trim() || undefined,
    temperature: o.temperature,
    maxTokens: o.maxTokens,
    // Mastra sends this contract as structuredOutput. Never let different
    // schemas share an otherwise identical response within a run.
    responseContract,
  });
  return getOrCreateModelResponse(requestKey, {
    provider: "openrouter",
    model: cfg.model,
    kind: "text",
  }, async () => {
    const bundle = hasDirectMastraCredential(cfg.model) ? await getBundle() : null;
    if (bundle) {
      const agent = bundle.getAgent(o.role);
      let res: MastraGenerationResponse;
      try {
        res = await agent.generate(o.prompt, {
          structuredOutput: { schema: o.schema },
          ...(o.temperature !== undefined ? { temperature: o.temperature } : {}),
          ...(o.maxTokens !== undefined ? { maxOutputTokens: o.maxTokens } : {}),
        });
      } catch (e) {
        if (knownPreGenerationProviderFailure(e)) {
          throw new MastraGenerationUnavailableError(
            o.role,
            e instanceof Error ? e.message : String(e),
            { cause: e },
          );
        }
        throw new MastraGenerationOutcomeUnknownError(
          o.role,
          `agent.generate() failed after dispatch (${e instanceof Error ? e.message : String(e)})`,
          { cause: e },
        );
      }
      recordMastraUsage(cfg.model, res);
      return parseMastraStructuredObject({ role: o.role, schema: o.schema, response: res });
    }

    // REST fallback uses the same declared non-Google provider. No hidden
    // provider substitution is allowed for creative text.
    const system = o.system ?? cfg?.instructions;
    if (!hasAnthropicKey()) throw new Error(`agentJson(${o.role}): OPENROUTER_API_KEY is required`);
    // Mirror the Mastra-available path's model tier here so a Mastra outage
    // degrades gracefully (fast roles -> "flash", higher-stakes roles ->
    // "pro") instead of silently collapsing every role to claudeJson's
    // tier-less "flash" default.
    const out = await claudeJson<T>({
      prompt: o.prompt,
      system,
      tier: cfg?.tier,
      maxTokens: o.maxTokens,
      temperature: o.temperature,
      // The outer memo includes the response contract and only completes after
      // this parse succeeds. A generic JSON memo here could otherwise retain a
      // response rejected by this schema and turn a retry into a stale failure.
      memoize: false,
    });
    return o.schema.parse(out);
  });
}
