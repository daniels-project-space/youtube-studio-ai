# 03 — CREW / SHOW-BIBLE + GUARD GATES (research, June 2026)

Two adjacent stages of the YouTube factory: **(A) CREW** = per-channel creative direction
(Showrunner distils frozen Style DNA into a `creativeBrief` with director/DP/editor/composer/critic
doctrines; critic authors a `ValidationSpec` the verify stage enforces). **(B) GUARD** = three
pre-spend gates: `qa_script`, `originality_gate` (embeddings dedup), `compliance_check`.

Grounded against source: `src/trigger/blocks/crewBlocks.ts`, `src/trigger/blocks/complianceBlocks.ts`.

---

## NOW

**CREW** — `CREW_BLOCKS` = directorBrief / dpBrief / editorBrief / composerBrief / criticSpec blocks.
A Showrunner reads frozen channel Style DNA (`dnaDigest` / `dnaAudioDigest`) + `creativeBrief` on
`ChannelIdentity`, emits per-video doctrines; the critic block authors a `ValidationSpec` enforced at
verify. `failLoud(blockId)` throws rather than ship a silent empty brief — missing crew = hard stop
(`crewBlocks.ts:141`). Crew is currently **code-as-prompt**: each role is a hardcoded block constant.

**GUARD** — three gates before paid generation:
- `qa_script` — craft check.
- `originality_gate` — Gemini `embedText` → cosine vs a per-channel JSON index of prior uploads +
  competitors; throws at `maxSimilarity >= 0.92` ("inauthentic-content risk"); reserves the vector on
  pass (`complianceBlocks.ts:56`). Self-dedup silently skips when `GEMINI_API_KEY` absent.
- `compliance_check` — policy block.

Gaps: crew personas are not data (N code paths if channels diverge); originality index is a flat
JSON cosine scan (no ANN / MinHash, O(n) per run); compliance is a single LLM pass, not mapped to a
named taxonomy (GARM); critic judges in a vacuum (no real top-competitor anchoring).

---

## AFTER

**CREW → profile-as-data.** Crew personas become a `crewProfile` object on `ChannelProfile`
(role → {doctrine, modelTier, fewShotExemplars, forbiddenList}). One generic Director/Showrunner
**Mastra tool** reads the active channel's profile via `runtimeContext` (`requestContext`) — no per-
channel code path. Channels customise by editing data, not by forking blocks. Keep `failLoud`
semantics: a tool whose `requestContextSchema` lacks a crew profile throws a `MastraError` *before any
LLM call* (Mastra validates context at `generate()` start).

**GUARD → fail-fast typed gates with teaching error contracts.** Each gate is a Mastra tool with a
zod `outputSchema` `{ pass: boolean, score, violations[], selfHealHint }`. On fail it returns (not
just throws) a structured critique the upstream generator can consume to self-heal (Generator-Critic /
Reflexion loop, bounded by a max-revision counter). Originality upgrades from flat cosine to a
two-stage pipeline: MinHash/SimHash-LSH lexical pre-filter → embedding ANN (HNSW) semantic check, so
it catches both copy-paste and paraphrase and scales past O(n). Compliance maps to the **GARM** brand-
safety taxonomy + YouTube advertiser-friendly categories, scored by an LLM-as-judge with a *fixed
rubric* (binary per-criterion, evidence-grounded, cross-family judge). Critic becomes **market-aware**:
pulls real top-competitor titles/scripts for the niche and judges relative to them, not in a vacuum.

---

## HOW LEADERS DO IT

**Roles: personas vs distinct agents vs profile-as-data.** Three live primitives —
LangGraph = node-on-shared-state, AutoGen/MS-Agent-Framework = actor-with-messages,
CrewAI = role-producing-task-output (DataCamp/bestaiweb mapping: state-machine / actor / pipeline).
The decisive lesson from production write-ups: **separate roles only when the critic is genuinely
better at evaluating than the generator is at producing** — otherwise the second pass changes things
without improving them ("the critic degrades output on pass 2 because feedback is too vague",
Medium/LangGraph patterns). A single well-prompted agent at 3s often beats a 3-agent pipeline at 15s.
**What actually improves output (not theater):** (1) doctrine prompts grounded in real source material,
not vibes — `deep-director` reverse-engineers each agent's system prompt from named textbooks (McKee
*Story*, Snyder *Save the Cat*, Kenworthy *Master Shots*) and a Showrunner-as-critic with a 100-point
checklist; (2) a Producer/Critic (Generator-Critic / Reflexion) loop with **external grounding +
citations** and a hard max-iteration cap; (3) structured (Pydantic/zod) handoffs between roles.

**Profile-as-data is the industry default for reusable crews.** CrewAI's recommended pattern is
`agents.yaml` + `tasks.yaml` — role/goal/backstory/llm declared as data with `{topic}`-style template
vars filled at `kickoff(inputs=…)`; code just binds config → Agent. `editorial-squad` ships "templates,
workflows and data files" so the same squad customises per author's DNA without flattening voice. This
is exactly the "one tool, profile injected" model — Mastra's `runtimeContext`/`requestContext` is the
TS-native equivalent (dynamic `instructions`/`tools`/`model` functions resolved per request).

**Guard:** LLM-as-judge is reliable only with a *fixed rubric + calibration*. MT-Bench (Zheng 2023):
GPT-4 ≈ 80% human agreement. Production rules (LangChain, Galtea, learnwithparam, RULERS/Autorubric):
5 dimensions max, binary/low-precision per-criterion scoring, chain-of-thought enumeration before the
score, evidence-grounded verdicts, **cross-family judge** (judge with a different model family than the
generator), shuffle to kill position bias, and **calibrate against a labelled gold set before trusting
it**. For dedup, MinHash+LSH/SimHash is the standard lexical near-dup primitive (Datasketch); semantic
dedup uses embeddings + ANN (HNSW); the two are **complementary, not substitutes** (FOLD/RETSim).

---

## TOOLS

| Tool | Category | What it gives you | URL |
|---|---|---|---|
| Mastra `runtimeContext`/dynamic agents | CREW profile-as-data | Per-channel `instructions`/`tools`/`model` via DI; `requestContextSchema` validates before any LLM call | https://mastra.ai/blog/dynamic-agents · https://mastra.ai/docs/agents/networks |
| CrewAI (agents.yaml/tasks.yaml) | CREW profile-as-data | Declarative role/goal/backstory; hierarchical manager+workers; reference pattern | https://docs.crewai.com/en/quickstart · https://github.com/crewaiinc/crewAI |
| LangGraph reflection / langgraph-reflection | CREW critic loop | Prebuilt Generator-Critic graph, bounded retries, evidence grounding | https://github.com/langchain-ai/langgraph-reflection · https://www.langchain.com/blog/reflection-agents |
| deep-director | CREW doctrine source | Showrunner+DP+screenwriter prompts reverse-engineered from craft textbooks; 100-pt critic | https://github.com/ferzat0918/deep-director |
| Datasketch MinHash LSH | GUARD dedup (lexical) | MinHash+LSH near-dup, sub-linear lookup | https://github.com/ekzhu/datasketch |
| RETSim / google unisim | GUARD dedup (robust) | Robust metric embeddings, beats MinHash on adversarial near-dup | https://github.com/google/unisim · https://arxiv.org/html/2311.17264 |
| Pinecone / HNSW ANN | GUARD dedup (semantic) | Vector index for embedding cosine at scale (replaces flat JSON scan) | https://www.pinecone.io/ |
| LLM-as-judge (LangSmith Align Evals / Galtea / Autorubric / RULERS) | GUARD script QA | Rubric design, calibration to gold set, bias controls | https://www.langchain.com/resources/llm-as-a-judge · https://galtea.ai/blog/llm-as-a-judge-the-complete-guide · https://arxiv.org/html/2601.08654 |
| OpenAI Moderation API | GUARD policy (text, free) | Harmful/sensitive text classification | https://platform.openai.com/docs/guides/moderation |
| Hive AI (Brand Safety + Media Search/IP) | GUARD policy + copyright | GARM-mapped brand-safety classes; copyright/IP + celebrity/likeness detection | https://docs.thehive.ai/docs/brand-safety-and-suitability · https://docs.thehive.ai/docs/intellectual-property-detection |
| YouTube advertiser-friendly guidelines + GARM | GUARD policy taxonomy | Canonical monetization categories to encode as a rubric | https://support.google.com/youtube/answer/6162278 · https://support.google.com/youtube/answer/9725604 |

---

## IMPLEMENTATION (Mastra tools + ChannelProfile)

**1. `ChannelProfile.crewProfile` (data, not code).**
```ts
crewProfile: {
  director:  { doctrine: string; modelTier: "fast"|"max"; forbidden: string[]; exemplars?: string[] };
  dp:        { ...same shape };
  editor:    { ... };
  composer:  { ... };
  critic:    { rubric: RubricCriterion[]; maxRevisions: number; competitorAnchors: boolean };
}
```
`RubricCriterion = { id; definition; scale: "binary"|"1-5"; failRule: string }`. The frozen Style DNA
digest stays as-is; `crewProfile` is the editable, per-channel layer the Director reads.

**2. One generic crew tool, profile via `requestContext`.** Mirror the proven `failLoud` contract but
fail *before* the LLM call by validating context:
```ts
export const directorBrief = createTool({
  id: "director_brief",
  requestContextSchema: z.object({ channelId: z.string(), crewProfile: CrewProfileSchema }),
  outputSchema: BriefSchema,
  execute: async ({ requestContext }) => {
    const p = requestContext.get("crewProfile").director; // throws MastraError if missing
    // build prompt from p.doctrine + p.forbidden + p.exemplars; one model call at p.modelTier
  },
});
```
No per-channel branch — the doctrine *is* the variation. Keeps the "missing crew throws" guarantee
the codebase already relies on (`crewBlocks.ts:141`).

**3. Guard gates = typed fail-fast tools with teaching error contracts.** Every gate returns a
structured verdict the generator can self-heal from (don't only throw):
```ts
outputSchema: z.object({
  pass: z.boolean(),
  score: z.number(),
  violations: z.array(z.object({ rule: z.string(), evidence: z.string() })),
  selfHealHint: z.string().optional(), // fed back into the Generator-Critic loop
})
```
Bound the revise loop with `crewProfile.critic.maxRevisions` (Reflexion cap) to protect the latency/
cost budget.

**4. `originality_gate` upgrade.** Stage 1: MinHash/SimHash-LSH lexical pre-filter (cheap, catches
copy-paste). Stage 2: keep the embedding cosine check but move the flat JSON index → ANN (HNSW /
Pinecone) so it scales and can include competitor scripts. Preserve current threshold semantics
(0.92) + index-reservation-on-pass; surface `maxSimilarity` + nearest title in the verdict.

**5. `compliance_check` upgrade.** Map output to GARM classes + YouTube advertiser-friendly categories
as an explicit rubric; LLM-as-judge with a *cross-family* judge model, binary per-criterion scoring,
evidence required per violation. Optionally call OpenAI Moderation (free, text) as a cheap first pass
and Hive (GARM + IP/copyright) for the paid, higher-assurance tier.

**6. Market-aware critic.** When `crewProfile.critic.competitorAnchors` is true, the critic tool pulls
real top-competitor titles/structures for the niche (already have competitor data in the originality
index) and judges the script *relative* to them — the single highest-leverage anti-theater move.

---

## TOP 3 MOVES

1. **Crew → `crewProfile` data on `ChannelProfile`, read by one generic Mastra tool via
   `requestContext`** (validate-before-LLM = keep `failLoud`). Kills N code paths; channels customise by
   editing data. Industry-standard pattern (CrewAI yaml / Mastra dynamic agents).
2. **Guard gates → typed fail-fast tools returning `{pass,score,violations,selfHealHint}`**, wired into
   a bounded Generator-Critic self-heal loop; compliance scored against a fixed GARM + YouTube rubric
   with a cross-family LLM judge calibrated to a gold set.
3. **Two-stage originality (MinHash-LSH → embedding ANN) + market-aware critic** (judge vs real top
   competitors, not in a vacuum) — catches both paraphrase and templating, and is the move that turns
   crew from theater into measurable lift.
