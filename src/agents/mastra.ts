/**
 * Mastra agent layer (hybrid: Mastra authors the agent calls; the block engine
 * still orchestrates the pipeline DAG; Trigger.dev runs it).
 *
 * Creative agents shared by every chunk use the configured non-Google model.
 * Gemini is deliberately not a text-agent fallback: its sole admitted use is
 * the sealed Nano Banana thumbnail module.
 *
 * `agentJson()` is the single entry point chunks call. It is RESILIENT by design:
 * it tries the Mastra agent (structured output validated by a zod schema, traced
 * to Langfuse when keys are present) and, on ANY failure (bundling, runtime, API),
 * falls back to the existing REST helpers. So adopting Mastra can never break a
 * working chunk — that is the hybrid seam.
 *
 * Mastra + AI-SDK packages are dynamically imported so a module-load/bundle
 * problem is caught here rather than crashing the Trigger task at import time.
 * They are also marked `external` in trigger.config.ts so they install in the
 * image rather than being bundled.
 */
import type { z } from "zod";
import { assertNonGeminiModelIdentifier } from "@/lib/gemini";
import { claudeJson, hasAnthropicKey } from "@/lib/anthropic";
import {
  cacheModelResponse,
  getCachedModelResponse,
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

const CLAUDE_MODEL = process.env.MASTRA_PRODUCER_MODEL
  ?? process.env.ANTHROPIC_CREATIVE_FAST_MODEL
  ?? "anthropic/claude-sonnet-4-5-20250929";
const DIRECTOR_MODEL = process.env.MASTRA_DIRECTOR_MODEL
  ?? process.env.ANTHROPIC_CREATIVE_PRO_MODEL
  ?? CLAUDE_MODEL;

interface RoleConfig {
  /** REST-fallback provider when Mastra is unavailable. */
  provider: "claude";
  model: string;
  /**
   * Coarse REST-fallback tier mirroring this role's Mastra model choice
   * (CLAUDE_MODEL/"fast" roles -> "flash", DIRECTOR_MODEL/"pro" roles ->
   * "pro"). Mastra's per-role `model` string is the source of truth when
   * Mastra is available; this is only consulted by the REST fallback in
   * `agentJson()` so a Mastra outage degrades gracefully instead of
   * collapsing every role to the tier-less ("flash") default.
   */
  tier: "flash" | "pro";
  instructions: string;
}

/**
 * Text agents are non-Google by default. Gemini is reserved for the sealed
 * Nano Banana thumbnail module; visual judging is separately non-Google.
 */
const ROLE_CONFIG: Record<AgentRole, RoleConfig> = {
  producer: {
    provider: "claude",
    model: CLAUDE_MODEL,
    tier: "flash",
    instructions:
      "You are the Producer in an autonomous YouTube content pipeline. You generate " +
      "high-quality candidates that strictly fit the given channel identity and " +
      "constraints. Always return valid structured output and nothing else.",
  },
  director: {
    provider: "claude",
    model: DIRECTOR_MODEL,
    tier: "pro",
    instructions:
      "You are the Director: a senior YouTube content strategist and critic. You " +
      "judge candidates against channel identity, freshness/distinctiveness, and " +
      "audience appeal. Score objectively (0..1) and return concrete, actionable " +
      "issues as structured output.",
  },
  showrunner: {
    provider: "claude",
    model: DIRECTOR_MODEL,
    tier: "pro",
    instructions:
      "You are the Showrunner: you define a YouTube channel's creative essence. From a " +
      "niche + format + competitor signals you write the show bible — positioning, the " +
      "emotional vibe, the one iconic visual motif, exactly what WORKS in this space and " +
      "(critically) what does NOT, and which crew roles the channel needs. Be specific and " +
      "opinionated; generic answers are failures. Return structured output only.",
  },
  crew_director: {
    provider: "claude",
    model: CLAUDE_MODEL,
    tier: "flash",
    instructions:
      "You are the Director (narrative). For one video you design the STRUCTURE: a " +
      "scroll-stopping hook and an ordered beat map with intended durations and the emotional " +
      "intent of each beat, faithful to the channel's vibe. Return structured output only.",
  },
  cinematographer: {
    provider: "claude",
    model: CLAUDE_MODEL,
    tier: "flash",
    instructions:
      "You are the Cinematographer (DP). You own the LOOK: concrete footage/keyframe " +
      "selection criteria, color/mood, and motion language for one video, consistent with the " +
      "channel's iconic motif. Output concrete search queries / prompt styles, not adjectives. " +
      "Return structured output only.",
  },
  editor: {
    provider: "claude",
    model: CLAUDE_MODEL,
    tier: "flash",
    instructions:
      "You are the Editor. You own CUTS & RHYTHM: cut cadence per section, transition language, " +
      "caption styling, and overlay placement rules for one video, matched to the channel's pace. " +
      "Return structured output only.",
  },
  composer: {
    provider: "claude",
    model: CLAUDE_MODEL,
    tier: "flash",
    instructions:
      "You are the Composer / Sound designer. You write the MUSIC generation prompt (genre, " +
      "instrumentation, dynamics, BPM band, and what to avoid) and the audio brief (ducking, " +
      "bed loudness, optional voice FX) for one video, true to the channel's vibe. Return " +
      "structured output only.",
  },
  critic: {
    provider: "claude",
    model: CLAUDE_MODEL,
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
    provider: configuredModel.startsWith("anthropic/") ? "anthropic" : "mastra",
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
 * REST-fallback on any failure. Throws only if BOTH paths are unavailable.
 */
export async function agentJson<T>(o: AgentJsonOptions<T>): Promise<T> {
  const log = o.log ?? (() => {});
  const cfg = ROLE_CONFIG[o.role];
  // A model override must never route creative text through Gemini. The only
  // admitted Google integration lives in the receipt-bound thumbnail module.
  assertNonGeminiModelIdentifier(cfg.model, `agentJson(${o.role})`);
  const requestKey = modelRequestCacheKey("mastra", cfg.model, {
    role: o.role,
    prompt: o.prompt,
    temperature: o.temperature,
    maxTokens: o.maxTokens,
  });
  const cached = getCachedModelResponse<T>(requestKey, {
    provider: cfg.model.startsWith("anthropic/") ? "anthropic" : "mastra",
    model: cfg.model,
    kind: "text",
  });
  if (cached !== undefined) return cached;

  const bundle = await getBundle();
  if (bundle) {
    try {
      const agent = bundle.getAgent(o.role);
      const res = await agent.generate(o.prompt, {
        structuredOutput: { schema: o.schema },
        ...(o.temperature !== undefined ? { temperature: o.temperature } : {}),
        ...(o.maxTokens !== undefined ? { maxOutputTokens: o.maxTokens } : {}),
      });
      recordMastraUsage(cfg.model, res);
      if (res?.object !== undefined && res.object !== null) {
        const parsed = o.schema.parse(res.object);
        cacheModelResponse(requestKey, parsed);
        return parsed;
      }
      log(`agentJson(${o.role}): Mastra returned no object — falling back to REST`);
    } catch (e) {
      log(`agentJson(${o.role}): Mastra path failed (${e instanceof Error ? e.message : e}) — REST fallback`);
    }
  }

  // REST fallback uses the same declared non-Google provider. No hidden
  // provider substitution is allowed for creative text.
  const system = o.system ?? cfg?.instructions;
  if (!hasAnthropicKey()) throw new Error(`agentJson(${o.role}): no Mastra and no ANTHROPIC_API_KEY`);
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
  });
  const parsed = o.schema.parse(out);
  cacheModelResponse(requestKey, parsed);
  return parsed;
}
