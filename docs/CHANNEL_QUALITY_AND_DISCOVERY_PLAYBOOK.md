# Channel Quality and Discovery Playbook

This is a design reference for reusable production modules. It is not a list
of formats to clone, a promise of search volume, or authorization to publish.
Every channel remains subject to its lane policy, source/rights checks, visual
review, and private-first release gate.

## Reference patterns

| Lane | Useful public reference | Transferable mechanic | Must not be copied |
| --- | --- | --- | --- |
| Visual STEM | [Kurzgesagt](https://www.youtube.com/watch?v=isdLel273rQ), [TED-Ed](https://www.youtube.com/watch?v=2W85Dwxx218), [Domain of Science](https://www.youtube.com/watch?v=ZihywtixUYo) | One question, one legible visual model, causal re-anchoring, bounded conclusion | Art style, characters, scripts, or claimed facts without sources |
| Children’s learning | [TED-Ed](https://www.youtube.com/@TEDEd), [Pinkfong / Baby Shark Kids’ Songs & Stories](https://www.youtube.com/@pinkfong) | One explicit objective, participatory repetition, clear action cues, and a recall moment | Songs, characters, melody, visuals, packaging, or any unsupported instructional claim |
| Atlas / history | [Atlas Pro](https://www.youtube.com/watch?v=V0o_7T3d3mw) | Artifact → observation → implication → map/timeline proof | Decorative map motion presented as evidence |
| Systems / geography | [Wendover Productions](https://www.youtube.com/@Wendoverproductions) | One systems question, legible constraints through maps or diagrams, and a causal consequence | Topics, scripts, maps, visual identity, sourcing, narration, or packaging |
| Language | [Dreaming Spanish](https://www.youtube.com/watch?v=FD3cN1rUOYo), [Easy Spanish](https://www.youtube.com/watch?v=SCS1dJ35lig), [English with Lucy](https://www.youtube.com/watch?v=oUD2gUmdzeI) | One communicative objective, comprehensible audio, context, repetition, pause for retrieval | Fake interviews, falsely documentary speakers, or unsupervised pronunciation claims |
| Original fiction | [Dead Sound](https://www.youtube.com/watch?v=mVLrBJYGxk4), [DUST](https://www.youtube.com/watch?v=rv8kOzRZK8g) | Stable visual language, staged wide/close contrast, sound-led atmosphere | Existing stories, recognizable IP, or synthetic realism passed off as filmed acting |
| Product tutorials | [Notion Training](https://www.youtube.com/watch?v=aA7si7AmPkY), [Figma Beginners](https://www.youtube.com/watch?v=dXQ7IHkTiMM) | Outcome promise → authentic UI proof → concrete result | Invented UI, stale feature claims, or unauthenticated product access |
| Casefile / investigation | [Fern](https://www.youtube.com/watch?v=wkVygetgeRY), [Fascinating Horror](https://www.youtube.com/watch?v=EPaBRegvkuQ) | Evidence-led hook, source object, causal timeline, explicit uncertainty | Active allegations, graphic detail, unsupported reconstructions, or how-to wrongdoing |
| Ambient / sleep | [Soothing Relaxation](https://www.youtube.com/@SoothingRelaxation) | Functional audio continuity and unobtrusive visual support for the listening use case | Music, visual identity, titles, or a recognizable channel treatment |
| Vertical factual Shorts | [Zack D. Films](https://www.youtube.com/@zackdfilms) | Immediate one-idea promise, visual consequence, and compact payoff | Topics, scripts, voice, 3D style, sensationalism, graphic material, or unsupported factual claims |
| Interactive trivia | [BRIGHT SIDE](https://www.youtube.com/@BRIGHTSIDEOFFICIAL) | One legible prompt, fair participation window, and unambiguous reveal | Questions, wording, answer sets, visual branding, clickbait, or unsupported facts |

Reference pacing is lane-specific. A visual-change sample from one format is a
benchmark for that format only—not a universal instruction to cut faster.

Reference standards transfer mechanics, not media. A source-bound quality
contract must name the public reference URL, the no-copy boundary, and the
evidence that can actually be checked (for example a reviewer-confirmed causal
beat sheet, claim → source → shot coverage, audio evidence, thumbnail evidence,
and originality evidence). It must never report an automatic visual comparison
unless such a comparator was separately implemented and its receipt is present.

## Auditable reference calibration

Reference channels are **calibration sources**, never a style-transfer target or
a proxy for expected views. A quality claim must distinguish three stages:

1. **Pre-release mechanics.** The frozen channel contract transfers only a
   bounded, observable rule—such as purposeful visual changes, a legible
   explanatory model, or a stable original visual language. Production visual
   QA receives those rules as typed criteria and retains frame-backed reviewer
   receipts. Whiteboard and illustrated explainers currently require both
   purposeful change and a legible visual model; motion-comic/fiction routes
   require story-led staging and stable visual language when their reference
   contract applies.
2. **Release evidence.** The final master must separately prove its audio,
   sources, originality, thumbnail/package, and visual-review requirements. A
   passing reference criterion never substitutes for those independent rails.
3. **Post-release learning.** Only a released video’s own YouTube Analytics can
   establish audience response. The audience-retention report defines the
   first-30-second intro metric and identifies top moments, spikes, and dips;
   it is used to propose a bounded next-episode experiment, never to rewrite a
   sealed episode or assert that a reference channel's audience will transfer.
   See [YouTube's retention guidance](https://support.google.com/youtube/answer/9314415?hl=en)
   and [Engagement analytics](https://support.google.com/youtube/answer/9313698?hl=en-0).

This keeps the system ambitious without making false promises: the measurable
result is a well-reviewed, original master; viewer retention is an observed
outcome that can improve the next program decision.

## Reusable module map

```text
Evidence / rights / canon packet ─┬─ Casefile documentary
                                  ├─ Atlas and visual STEM
                                  └─ Original fiction

Episode Graph → Scene Manifest ──┬─ Deterministic Scene Compiler
                                  ├─ Novita cinematic adapter
                                  └─ Future map/timeline renderer

Learning Contract ───────────────┬─ Supervised children’s learning
                                  ├─ Future language micro-courses
                                  └─ Future visual STEM lessons
```

Implemented now:

- `Case Packet` and cited evidence grammar, with rights, sensitivity, and
  reconstruction checks.
- `Episode Graph → Scene Manifest`, which locks story causality and continuity
  before a renderer can operate.
- `Learning Contract`, which locks an existing objective, source-backed
  demonstration beats, recap, retrieval practice, and human review.
- `Scene Compiler`, a local deterministic 16:9 visual lane.

Deliberately not enabled yet:

- Product tutorial channels require a real browser-proof capture module with
  authorized product access, version pinning, and stale-tutorial regression.
- Language channels require native-language and phoneme/caption review before
  a creator can claim instructional quality.
- Fiction needs a completed canon/rights/voice-bible workflow before it can be
  offered as an automatic channel family.

## Discovery package rule

Use one primary viewer query and one visible promise per episode. Candidate
clusters to validate in the channel’s YouTube Studio Research tab:

| Lane | Candidate cluster | Package proof |
| --- | --- | --- |
| Visual STEM | `how does [phenomenon] work`, `[topic] explained visually`, `map of [field]` | Exact question, one visual model, sourced bounded answer |
| Atlas | `[place] geography`, `why is [region] [outcome]`, `[year] map explained` | Dated artifact/map and causal chapters |
| Language | `learn [language] beginner`, `[language] comprehensible input`, `[scenario] [language]` | Language, level, skill, situation, audible pronunciation |
| Original fiction | `animated short film [genre]`, `sci-fi audio drama`, `[genre] story` | Original-world promise, content note, credits, series context |
| Product tutorial | `[product] tutorial for beginners`, `how to [outcome] in [product]` | Authentic current UI, version/date, prerequisites, chapters |

YouTube says Search considers how well the title, description, and video match
the query and viewer response; tags are primarily for misspellings rather than
a discovery shortcut. See [YouTube Search and discovery](https://support.google.com/youtube/answer/141805?hl=en) and [video tags guidance](https://support.google.com/youtube/answer/57404?hl=en-uk).

## Release-quality checks

1. The opening delivers the thumbnail/title promise quickly and honestly.
2. Every visual change either proves, clarifies, or emotionally advances the
   spoken point; decorative novelty is a defect.
3. Narration is intelligible, correctly paced for the lane, and mixed ahead of
   music. Audio clarity takes precedence over dramatic underscore.
4. Sources, rights, claims, continuity, and disclosures are traceable to the
   locked episode artifacts.
5. Actual rendered footage is sampled across the complete runtime and reviewed
   for framing, overlays, empty/duplicate frames, visual continuity, and
   matching aspect ratio before a draft can be accepted.
6. Repetitive or mass-produced variants fail the originality bar. YouTube’s
   [monetization policy](https://support.google.com/youtube/answer/1311392?hl=en)
   is a minimum platform constraint, not the creative standard.
