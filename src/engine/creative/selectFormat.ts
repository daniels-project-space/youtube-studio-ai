/**
 * Intelligent format + crew selection.
 *
 * The channel builder already turns a pasted EXAMPLE CLIP into a family suggestion
 * (`/api/analyze-clip`). What it lacked: a TEXT path — describe a channel in words
 * and get the best-fit format — and any recommendation of the film CREW (which has
 * always been a deterministic `FAMILY_CREW` / niche-preset roster).
 *
 * This module fills both. An LLM reads the REAL families catalog + crew roles and
 * the operator's concept, then recommends a format, a crew roster (a justified
 * subset of the family default — not every channel needs every role), reasoning,
 * confidence and alternates. Every LLM pick is validated against the real catalog;
 * a keyword heuristic is the deterministic floor so this never throws and works
 * even with no API key.
 *
 * Gemini only (Claude is banned in YSA). Single responsibility: it RECOMMENDS — the
 * operator confirms and `designChannel` still owns the actual pipeline build.
 */
import {
  FAMILIES,
  FAMILY_KEYS,
  FAMILY_CREW,
  getFamily,
  type FamilyKey,
} from "@/engine/families";
import { geminiJson } from "@/lib/gemini";

const KNOWN_ROLES = ["director", "cinematographer", "editor", "composer", "critic"] as const;
type Role = (typeof KNOWN_ROLES)[number];

export interface FormatSelectionInput {
  /** The operator's description of the channel they want to build. */
  concept: string;
  niche?: string;
  audience?: string;
  sampleTopics?: string[];
}

export interface FormatRecommendation {
  family: FamilyKey;
  /** false → the family's visual engine isn't built yet; channel saves as a DRAFT. */
  available: boolean;
  /** Recommended film-crew roster (a validated subset of the known roles). */
  crew: Role[];
  reasoning: string;
  /** 0..1 — how well the concept matches the chosen family. */
  confidence: number;
  alternates: { family: FamilyKey; why: string }[];
  /** true → the LLM pick was unusable and a deterministic heuristic was used. */
  fallback: boolean;
}

/** A compact, machine-readable view of the real catalog for the prompt. */
function catalogForPrompt(): string {
  return FAMILY_KEYS.map((k) => {
    const f = FAMILIES[k];
    return (
      `- ${k}: ${f.label} — ${f.description} ` +
      `[${f.narrated ? "narrated" : "no narration"}; default crew: ${FAMILY_CREW[k].join(", ")}; ` +
      `${f.available ? "available" : "ENGINE NOT BUILT (draft only)"}]`
    );
  }).join("\n");
}

/** Deterministic floor: keyword-match the concept to a family. Never throws. */
function heuristicFamily(input: FormatSelectionInput): FamilyKey {
  const t = `${input.concept} ${input.niche ?? ""} ${(input.sampleTopics ?? []).join(" ")}`.toLowerCase();
  const has = (...w: string[]) => w.some((x) => t.includes(x));
  if (has("vertical", "shorts", "short-form", "tiktok", "reel", "9:16")) return "shorts";
  if (has("sleep", "insomnia", "rain sounds", "ambient", "white noise", "calm down")) return "sleep";
  if (has("lofi", "lo-fi", "study beats", "chillhop", "music loop", "loop visual", "ghibli")) return "music_loop";
  if (has("whiteboard", "explainer", "drawn", "hand-draw", "doodle", "sketch")) return "whiteboard";
  if (has("cinematic", "heist", "crime", "true crime", "thriller", "reconstruction", "ai scenes")) return "cinematic";
  return "narrated_stock"; // the most general format
}

function asRole(x: unknown): Role | undefined {
  return typeof x === "string" && (KNOWN_ROLES as readonly string[]).includes(x) ? (x as Role) : undefined;
}

/** Validate + normalize a crew roster; fall back to the family default if empty. */
function validateCrew(raw: unknown, family: FamilyKey): Role[] {
  const seen = new Set<Role>();
  if (Array.isArray(raw)) {
    for (const r of raw) {
      const role = asRole(r);
      if (role) seen.add(role);
    }
  }
  // The critic is the load-bearing QA gate — never drop it.
  seen.add("critic");
  const out = KNOWN_ROLES.filter((r) => seen.has(r)); // canonical order
  return out.length > 1 ? out : (FAMILY_CREW[family] as Role[]);
}

interface RawPick {
  family?: string;
  crew?: unknown;
  reasoning?: string;
  confidence?: number;
  alternates?: { family?: string; why?: string }[];
}

/**
 * Recommend a format + crew for a channel concept. Always resolves (LLM →
 * validated, else keyword heuristic). `log` is optional for trigger/route tracing.
 */
export async function selectFormat(
  input: FormatSelectionInput,
  log: (m: string) => void = () => {},
): Promise<FormatRecommendation> {
  const concept = input.concept?.trim();
  if (!concept) {
    const family = "narrated_stock" as FamilyKey;
    return {
      family,
      available: FAMILIES[family].available,
      crew: FAMILY_CREW[family] as Role[],
      reasoning: "No concept provided — defaulted to the most general narrated format.",
      confidence: 0.2,
      alternates: [],
      fallback: true,
    };
  }

  const prompt =
    `You are a YouTube channel architect. Pick the single best PRODUCTION FORMAT for this channel from the catalog, ` +
    `and the film CREW it actually needs (omit roles that add no value — e.g. a music-only loop needs no editor; a ` +
    `whiteboard explainer needs no cinematographer). The critic role is always kept.\n\n` +
    `CHANNEL CONCEPT: ${concept}\n` +
    (input.niche ? `NICHE: ${input.niche}\n` : "") +
    (input.audience ? `AUDIENCE: ${input.audience}\n` : "") +
    (input.sampleTopics?.length ? `SAMPLE TOPICS: ${input.sampleTopics.join("; ")}\n` : "") +
    `\nFORMAT CATALOG (choose family by its exact key):\n${catalogForPrompt()}\n\n` +
    `CREW ROLES: director (narrative/structure), cinematographer (shot/visual look), editor (pacing/cuts), ` +
    `composer (music/score), critic (QA gate).\n\n` +
    `Prefer an AVAILABLE family; only pick a draft-only one if it is clearly the right format. ` +
    `Return STRICT JSON: {"family":"<key>","crew":["<role>",...],"reasoning":"<=2 sentences",` +
    `"confidence":0..1,"alternates":[{"family":"<key>","why":"<short>"}]}.`;

  let pick: RawPick | null = null;
  try {
    pick = await geminiJson<RawPick>({ prompt, maxTokens: 500, temperature: 0.3 });
  } catch (e) {
    log(`selectFormat: LLM failed (${e instanceof Error ? e.message : e}) — using heuristic`);
  }

  const llmFamily =
    pick && typeof pick.family === "string" && FAMILY_KEYS.includes(pick.family as FamilyKey)
      ? (pick.family as FamilyKey)
      : null;

  if (!llmFamily) {
    const family = heuristicFamily(input);
    log(`selectFormat: no valid LLM family — heuristic → ${family}`);
    return {
      family,
      available: FAMILIES[family].available,
      crew: FAMILY_CREW[family] as Role[],
      reasoning:
        pick?.reasoning?.trim() ||
        `Matched the concept to "${FAMILIES[family].label}" by keyword (LLM unavailable).`,
      confidence: 0.4,
      alternates: [],
      fallback: true,
    };
  }

  const alternates = (Array.isArray(pick?.alternates) ? pick!.alternates : [])
    .map((a) => ({ family: a?.family, why: (a?.why ?? "").trim() }))
    .filter((a): a is { family: FamilyKey; why: string } =>
      typeof a.family === "string" && FAMILY_KEYS.includes(a.family as FamilyKey) && a.family !== llmFamily,
    )
    .slice(0, 2);

  const confidence = Math.max(0, Math.min(1, typeof pick?.confidence === "number" ? pick!.confidence : 0.7));

  log(`selectFormat: ${llmFamily} (conf ${confidence.toFixed(2)})${getFamily(llmFamily)?.available ? "" : " [DRAFT]"}`);
  return {
    family: llmFamily,
    available: FAMILIES[llmFamily].available,
    crew: validateCrew(pick?.crew, llmFamily),
    reasoning: pick?.reasoning?.trim() || `Best match for the concept among the catalog.`,
    confidence,
    alternates,
    fallback: false,
  };
}
