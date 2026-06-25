# Module config — onboarding + settings toggles (going-forward standard)

Every base module declares a `CustomizationSurface` (knobs/presets/capabilities). Those
become **operator-facing toggles** in two places — channel **onboarding** (before creation)
and channel **settings** (after) — persisted per channel and **wired live** into the pipeline.
No dead code: a toggle changes the rendered video.

## Data flow (captions = the worked example, already wired)
```
UI (onboarding/settings)        Convex                  Engine                       Pipeline
ModuleConfigPanel        →  channels.moduleConfig  →  buildChannelProfile      →  resolveAssembleParams
reads MODULE_REGISTRY        { [blockId]: {           (moduleConfig →             (knobs → AssembleParams)
renders knobs as toggles       preset?, ...knobs } }   moduleOverrides + preset)  →  planTimeline (captions:false
writes on change/create                                                              ⇒ drops caption overlays)
                                                                                  →  render: 0 captions ✅
```

## DONE this session (engine backbone — tested, tsc-clean)
- `src/engine/moduleRegistry.ts` — `MODULE_REGISTRY` (blockId → card+surface), `moduleSurface`, `configurableModules()`. ONE catalog the UI + Architect read.
- `captions` knob on `ASSEMBLY_SURFACE` (+ off in meditation/lofi presets).
- Live wiring: `resolveAssembleParams` → `AssembleParams.captions`; `planTimeline` drops `kind:"caption"` overlays when off. Proven by `__tests__/config.test.ts` (channel toggle → plan changes).
- `buildChannelProfile` already threads `moduleOverrides` → `moduleParams` → resolveX. The settings toggle writes there.

## TODO (the app-layer vertical — needs the Next app + Convex to verify)
1. **Convex** (`convex/schema.ts`): add `moduleConfig: v.optional(v.record(v.string(), v.any()))` to the `channels` table = `{ [blockId]: { preset?: string, ...knobValues } }`. Mutation `channels.setModuleConfig(channelId, blockId, config)` (validate against the surface via `validateKnobs` before write).
2. **Profile build** (server): where the run builds the ChannelProfile, pass `row.moduleConfig` → `buildChannelProfile({ ..., moduleOverrides: row.moduleConfig })` (+ lift any `preset` into the pipeline entry params). One line; closes the loop.
3. **UI — generic `<ModuleConfigPanel surface value onChange>`** (`src/components/`): renders each knob by type — enum→`<select>` (options from `knob.values`), boolean→toggle, number→slider (`knob.range`); a preset picker (`surface.presets`); shows `knob.describes`. Reads `configurableModules()`.
4. **Onboarding** (channel-create wizard): a "Pipeline style" step — pick a preset per module + flip toggles → write into the new channel's `moduleConfig`.
5. **Settings** (channel settings page): the same panel, editable, with a save mutation → "toggle off captions with a click".

## Going-forward standard (all modules)
Register a module in `MODULE_REGISTRY` → its knobs/presets **auto-appear** in onboarding + settings and **auto-wire** through `moduleConfig → moduleOverrides → resolveX`. Adding a module = a surface + a registry line; the UI + Architect generalize for free. The Architect later picks presets/knobs the SAME way the operator does (writing `moduleConfig`), so manual + automatic configuration share one path.
