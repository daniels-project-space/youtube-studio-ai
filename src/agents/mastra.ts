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
import { claudeJson, hasAnthropicKey, CLAUDE_THUMBNAIL_MODEL } from "@/lib/anthropic";

export type AgentRole = "producer" | "director";

const PRODUCER_MODEL = process.env.MASTRA_PRODUCER_MODEL ?? "google/gemini-2.5-flash";
const DIRECTOR_MODEL =
  process.env.MASTRA_DIRECTOR_MODEL ?? `anthropic/${CLAUDE_THUMBNAIL_MODEL}`;

const PRODUCER_INSTRUCTIONS =
  "You are the Producer in an autonomous YouTube content pipeline. You generate " +
  "high-quality candidates that strictly fit the given channel identity and " +
  "constraints. Always return valid structured output and nothing else.";
const DIRECTOR_INSTRUCTIONS =
  "You are the Director: a senior YouTube content strategist and critic. You " +
  "judge candidates against channel identity, freshness/distinctiveness, and " +
  "audience appeal. Score objectively (0..1) and return concrete, actionable " +
  "issues as structured output.";

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

      const producer = new Agent({
        id: "producer",
        name: "producer",
        instructions: PRODUCER_INSTRUCTIONS,
        model: PRODUCER_MODEL,
      });
      const director = new Agent({
        id: "director",
        name: "director",
        instructions: DIRECTOR_INSTRUCTIONS,
        model: DIRECTOR_MODEL,
      });

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
        } catch {
          /* tracing is best-effort; agents still run without it */
        }
      }

      const mastra = new Mastra({
        agents: { producer, director },
        ...(observability ? { observability } : {}),
      } as ConstructorParameters<typeof Mastra>[0]);

      return mastra as unknown as MastraBundle;
    } catch {
      // Mastra unavailable (bundle/runtime) — disable for the process; REST covers.
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
      });
      if (res?.object !== undefined && res.object !== null) {
        return o.schema.parse(res.object);
      }
      log(`agentJson(${o.role}): Mastra returned no object — falling back to REST`);
    } catch (e) {
      log(`agentJson(${o.role}): Mastra path failed (${e instanceof Error ? e.message : e}) — REST fallback`);
    }
  }

  // REST fallback (existing, proven, vault-wired helpers).
  if (o.role === "producer") {
    if (!hasGeminiKey()) throw new Error("agentJson(producer): no Mastra and no GEMINI_API_KEY");
    const out = await geminiJson<T>({
      prompt: o.prompt,
      maxTokens: o.maxTokens,
      temperature: o.temperature,
    });
    return o.schema.parse(out);
  }
  if (!hasAnthropicKey()) throw new Error("agentJson(director): no Mastra and no ANTHROPIC_API_KEY");
  const out = await claudeJson<T>({
    prompt: o.prompt,
    system: o.system,
    maxTokens: o.maxTokens,
    temperature: o.temperature,
  });
  return o.schema.parse(out);
}
