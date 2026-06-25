# Module Customization Standard — "the module guides the planner"

New requirement (locked) for every BASE module that appears in most pipelines (assembly,
director, thumbnail, script, narration, visuals, …): each must be **highly customizable
for all channel types/styles**, and — crucially — must **declare its own customization
surface + capabilities as data**, so the Pipeline Architect (auto-composer) and the
Director (runtime) are *guided by the module* rather than hardcoding per-channel logic.

## The contract addition: `CustomizationSurface`
Every module's self-describing card (`*_MODULE`) gains a `customization` field:

```
CustomizationSurface = {
  capabilities: string[]          // what the module CAN do — the Architect matches these to channel needs
  knobs: Knob[]                   // the typed per-account parameters it exposes
  presets: Record<string, KnobValues>  // named, style-targeted starting configs the Architect picks from
}
Knob = {
  id: string
  type: "enum" | "number" | "boolean"
  values?: string[]               // enum options
  range?: [number, number]        // number bounds (validated)
  default: string | number | boolean
  describes: string               // what it controls (human + LLM readable)
  servesStyles: string[]          // e.g. ["fast","energetic","shorts"] — tells the Architect WHEN to reach for it
}
```

Rules:
- **Validated**: knob values are range/enum-checked at the module boundary (a channel can't set an illegal value).
- **Preset + override**: the Architect picks a `preset` per channel-style; the channel/Director may override individual knobs. Final values flow via the `ChannelProfile.moduleOverrides[block]`.
- **Self-sufficient**: the Architect needs ONLY the surface (capabilities + knobs + presets + servesStyles) to configure the module — no module-specific code in the planner.
- **Same pattern for every base module**, so adding a module = adding a surface, and the Architect/Director generalize for free.

## Assembly — worked-out customization surface

**Capabilities:** beat- & narration-aware cutting · variable cut energy · chapter cards ·
intro/outro cards · music duck + LUFS loudness normalize · vertical/social reframe ·
J/L audio cuts · idempotent + heal-aware render.

**Knobs:**

| id | type | values / range | default | controls | serves styles |
|----|------|----------------|---------|----------|---------------|
| `aspect` | enum | 16:9 / 9:16 / 1:1 | 16:9 | output canvas | shorts, social |
| `cutEnergy` | enum | still / slow / steady / dynamic / frenetic | steady | pacing → maps to cuts/min → `bodySegSeconds` | meditation→still, doc→slow, essay→steady, hype→dynamic, shorts→frenetic |
| `introStyle` | enum | none / title_card / cold_open / logo_sting | title_card | opener treatment | branding, shorts→none/cold_open |
| `outroStyle` | enum | none / closing_card / subscribe_card | closing_card | ending treatment | retention, shorts→none |
| `chapterCards` | boolean | — | false | splice heading cards on chapter beats | long-form doc/essay |
| `musicDuckProfile` | enum | none / gentle / standard / aggressive | standard | how hard music ducks under voice | asmr/meditation→gentle/none, hype→aggressive |
| `targetLufs` | number | -23 … -12 | -14 | integrated loudness | platform/style (YouTube -14) |
| `transitions` | enum | hardcut / crossfade / dip_to_black | hardcut | between-shot transition | doc→crossfade, hype→hardcut |
| `reframe` | enum | none / center / subject_track | none | repurpose horizontal→vertical | shorts/social |
| `tailSec` | number | 0 … 8 | 3 | silent fade-out tail | shorts→1, ambient→6+ |

**Presets (Architect picks one as the base):**
- `documentary` — cutEnergy slow, chapterCards true, transitions crossfade, intro title_card, outro closing_card, duck standard, 16:9, lufs -14
- `essay` — cutEnergy steady, chapterCards false, intro title_card, outro closing_card, duck standard
- `hype` — cutEnergy dynamic, transitions hardcut, duck aggressive, intro cold_open
- `shorts` — aspect 9:16, cutEnergy frenetic, intro none, outro none, reframe subject_track, tailSec 1, chapterCards false
- `meditation` — cutEnergy still, transitions crossfade, duck gentle, tailSec 6, lufs -16
- `lofi` — single-loop (assembly minimal: no cuts/cards; duck none)

## How the Architect + Director use it
1. **Architect** (compose-time): reads each module's `capabilities` + `servesStyles`, matches the channel's niche/format, picks a `preset` per module + any overrides, freezes them into `ChannelProfile.pipeline[block].params` / `moduleOverrides`.
2. **Director** (runtime): for each module, resolves `preset + overrides → knob values` (validated against the surface) and calls the module. No bespoke code — the surface is the interface.
3. **Module** (`planTimeline`): maps validated knob values → behavior (e.g. `cutEnergy → cuts/min → bodySegSeconds`; `musicDuckProfile → duck levels`).

## Implementation (Assembly, next)
1. Add `CustomizationSurface` type (shared, `src/engine/customization.ts`) + `validateKnobs`.
2. Extend `ASSEMBLY_MODULE` with `customization` (the table above) + `ASSEMBLE_PRESETS`.
3. `resolveAssembleParams(profile)` → read `preset` + overrides from the profile, map knobs → `AssembleParams` (cutEnergy→cuts/min→cadence, duckProfile→introVol/bodyVol, etc.). Keep god-block defaults as the `essay`-ish baseline (parity).
4. Tests: every preset validates; cutEnergy→cadence mapping; illegal knob rejected; override beats preset.
5. Then resume overlay burn-in (gap A).
