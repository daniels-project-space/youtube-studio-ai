/**
 * Mastra agent layer (hybrid: Mastra authors the agent calls; the block engine
 * still orchestrates the pipeline DAG; Trigger.dev runs it).
 *
 * Two agents shared by every creative chunk:
 *   - producer  → Gemini 2.5 Flash (cheap, fast generation)
 *   - director  → Claude Sonnet (separate, stronger critic / judge)
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
import { geminiJson, hasGeminiKey } from "@/lib/gemini";
import { claudeJson, hasAnthropicKey } from "@/lib/anthropic";

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

const GEMINI_MODEL = process.env.MASTRA_PRODUCER_MODEL ?? "google/gemini-2.5-flash";
// Anthropic removed for cost (2026-06-12): the Director + Showrunner now run on
// Gemini like the rest of the crew. MASTRA_DIRECTOR_MODEL can still override.
const DIRECTOR_MODEL = process.env.MASTRA_DIRECTOR_MODEL ?? GEMINI_MODEL;

interface RoleConfig {
  /** REST-fallback provider when Mastra is unavailable. */
  provider: "gemini" | "claude";
  model: string;
  instructions: string;
}

/**
 * One row per agent. Generation-heavy crew roles run on Gemini (cheap, fast);
 * the Showrunner (creation-time, high value) + the strategist Director run on
 * Claude. The Critic AUTHORS the validation spec on Gemini; vision JUDGING of
 * that spec is done elsewhere (gemini-vision / the director).
 */
const ROLE_CONFIG: Record<AgentRole, RoleConfig> = {
  producer: {
    provider: "gemini",
    model: GEMINI_MODEL,
    instructions:
      "You are the Producer in an autonomous YouTube content pipeline. You generate " +
      "high-quality candidates that strictly fit the given channel identity and " +
      "constraints. Always return valid structured output and nothing else.",
  },
  director: {
    provider: "gemini",
    model: DIRECTOR_MODEL,
    instructions:
      "You are the Director: a senior YouTube content strategist and critic. You " +
      "judge candidates against channel identity, freshness/distinctiveness, and " +
      "audience appeal. Score objectively (0..1) and return concrete, actionable " +
      "issues as structured output.",
  },
  showrunner: {
    provider: "gemini",
    model: DIRECTOR_MODEL,
    instructions:
      "You are the Showrunner: you define a YouTube channel's creative essence. From a " +
      "niche + format + competitor signals you write the show bible — positioning, the " +
      "emotional vibe, the one iconic visual motif, exactly what WORKS in this space and " +
      "(critically) what does NOT, and which crew roles the channel needs. Be specific and " +
      "opinionated; generic answers are failures. Return structured output only.",
  },
  crew_director: {
    provider: "gemini",
    model: GEMINI_MODEL,
    instructions:
      "You are the Director (narrative). For one video you design the STRUCTURE: a " +
      "scroll-stopping hook and an ordered beat map with intended durations and the emotional " +
      "intent of each beat, faithful to the channel's vibe. Return structured output only.",
  },
  cinematographer: {
    provider: "gemini",
    model: GEMINI_MODEL,
    instructions:
      "You are the Cinematographer (DP). You own the LOOK: concrete footage/keyframe " +
      "selection criteria, color/mood, and motion language for one video, consistent with the " +
      "channel's iconic motif. Output concrete search queries / prompt styles, not adjectives. " +
      "Return structured output only.",
  },
  editor: {
    provider: "gemini",
    model: GEMINI_MODEL,
    instructions:
      "You are the Editor. You own CUTS & RHYTHM: cut cadence per section, transition language, " +
      "caption styling, and overlay placement rules for one video, matched to the channel's pace. " +
      "Return structured output only.",
  },
  composer: {
    provider: "gemini",
    model: GEMINI_MODEL,
    instructions:
      "You are the Composer / Sound designer. You write the MUSIC generation prompt (genre, " +
      "instrumentation, dynamics, BPM band, and what to avoid) and the audio brief (ducking, " +
      "bed loudness, optional voice FX) for one video, true to the channel's vibe. Return " +
      "structured output only.",
  },
  critic: {
    provider: "gemini",
    model: GEMINI_MODEL,
    instructions:
      "You are the Critic / QA Director. You author the VALIDATION SPEC for one video: the " +
      "specific, checkable assertions it must satisfy given its format and the channel's " +
      "dealbreakers, each with a check kind, threshold, and severity. Prefer deterministic, " +
      "measurable checks. Return structured output only.",
  },
};

/**
 * Map our GEMINI_API_KEY to the names the model layer expects. Mastra's model
 * router (models.dev gateway) looks up GOOGLE_API_KEY for the `google` provider;
 * the raw @ai-sdk/google provider uses GOOGLE_GENERATIVE_AI_API_KEY. Set both.
 */
function ensureProviderEnv(): void {
  const g = process.env.GEMINI_API_KEY;
  if (g) {
    if (!process.env.GOOGLE_API_KEY) process.env.GOOGLE_API_KEY = g;
    if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) process.env.GOOGLE_GENERATIVE_AI_API_KEY = g;
  }
}

interface MastraBundle {
  // Minimal shape we use — kept loose to avoid coupling to Mastra's types here.
  getAgent: (id: AgentRole) => {
    generate: (
      prompt: string,
      opts: Record<string, unknown>,
    ) => Promise<{ object?: unknown }>;
  };
}

let bundlePromise: Promise<MastraBundle | null> | null = null;
let mastraDisabled = false;

/** Build (once) the Mastra instance + agents + optional Langfuse exporter. */
async function getBundle(): Promise<MastraBundle | null> {
  if (mastraDisabled) return null;
  if (bundlePromise) return bundlePromise;
  bundlePromise = (async () => {
    try {
      ensureProviderEnv();
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

  const bundle = await getBundle();
  if (bundle) {
    try {
      const agent = bundle.getAgent(o.role);
      const res = await agent.generate(o.prompt, {
        structuredOutput: { schema: o.schema },
        ...(o.temperature !== undefined ? { temperature: o.temperature } : {}),
        ...(o.maxTokens !== undefined ? { maxOutputTokens: o.maxTokens } : {}),
        // Flash agents were silently billing THINKING tokens (the REST helper
        // disables thinking; the AI-SDK path never did) — kill it here too.
        providerOptions: { google: { thinkingConfig: { thinkingBudget: 0 } } },
      });
      if (res?.object !== undefined && res.object !== null) {
        return o.schema.parse(res.object);
      }
      log(`agentJson(${o.role}): Mastra returned no object — falling back to REST`);
    } catch (e) {
      log(`agentJson(${o.role}): Mastra path failed (${e instanceof Error ? e.message : e}) — REST fallback`);
    }
  }

  // REST fallback (existing, proven, vault-wired helpers), routed by the role's
  // declared provider. If the preferred provider's key is missing, fall back to
  // the other so a crew brief never hard-fails when only one key is configured.
  const cfg = ROLE_CONFIG[o.role];
  const preferGemini = cfg?.provider === "gemini";
  const system = o.system ?? cfg?.instructions;
  const useGemini = preferGemini ? hasGeminiKey() : !hasAnthropicKey() && hasGeminiKey();
  if (useGemini) {
    if (!hasGeminiKey()) throw new Error(`agentJson(${o.role}): no Mastra and no GEMINI_API_KEY`);
    const out = await geminiJson<T>({
      prompt: system ? `${system}\n\n${o.prompt}` : o.prompt,
      maxTokens: o.maxTokens,
      temperature: o.temperature,
    });
    return o.schema.parse(out);
  }
  if (!hasAnthropicKey()) throw new Error(`agentJson(${o.role}): no Mastra and no ANTHROPIC_API_KEY`);
  const out = await claudeJson<T>({
    prompt: o.prompt,
    system,
    maxTokens: o.maxTokens,
    temperature: o.temperature,
  });
  return o.schema.parse(out);
}
