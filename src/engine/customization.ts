/**
 * CustomizationSurface — the shared contract that lets a module DECLARE its own
 * per-account knobs, presets and capabilities, so the Pipeline Architect (compose-
 * time) and the Director (runtime) configure it FROM DATA — guided by the module,
 * with zero module-specific code in the planner.
 *
 * Every base module's self-describing card (`*_MODULE`) carries one of these.
 */

export type KnobValue = string | number | boolean;
export type KnobValues = Record<string, KnobValue>;

export interface Knob {
  id: string;
  type: "enum" | "number" | "boolean" | "text";
  /** enum options (required when type === "enum"). */
  values?: readonly string[];
  /** [min,max] inclusive (number knobs). */
  range?: readonly [number, number];
  /** max characters (text knobs); omit for unbounded. */
  maxLength?: number;
  default: KnobValue;
  /** Human- + LLM-readable description of what it controls. */
  describes: string;
  /** Channel styles/intents this knob serves — tells the Architect WHEN to reach for it. */
  servesStyles: readonly string[];
}

export interface CustomizationSurface {
  /** What the module CAN do — the Architect matches these to a channel's needs. */
  capabilities: readonly string[];
  /** The typed per-account parameters the module exposes. */
  knobs: readonly Knob[];
  /** Named, style-targeted starting configs. The Architect picks one, then overrides. */
  presets: Readonly<Record<string, KnobValues>>;
}

/** Default value of every knob. */
export function knobDefaults(surface: CustomizationSurface): KnobValues {
  const out: KnobValues = {};
  for (const k of surface.knobs) out[k.id] = k.default;
  return out;
}

/** Validate ONE knob value; returns an error string or null. */
function checkKnob(k: Knob, v: KnobValue): string | null {
  if (k.type === "enum") {
    const values = k.values ?? [];
    if (values.length === 0 || new Set(values).size !== values.length) {
      return `${k.id}: enum values must be non-empty and unique`;
    }
    if (typeof v !== "string" || !values.includes(v)) {
      return `${k.id}: '${String(v)}' not in [${(k.values ?? []).join("|")}]`;
    }
  } else if (k.type === "number") {
    if (typeof v !== "number" || !Number.isFinite(v)) return `${k.id}: not a finite number`;
    if (k.range && (!Number.isFinite(k.range[0]) || !Number.isFinite(k.range[1]) || k.range[0] > k.range[1])) {
      return `${k.id}: invalid numeric range`;
    }
    if (k.range && (v < k.range[0] || v > k.range[1])) return `${k.id}: ${v} out of range [${k.range[0]},${k.range[1]}]`;
  } else if (k.type === "boolean") {
    if (typeof v !== "boolean") return `${k.id}: not a boolean`;
  } else if (k.type === "text") {
    if (typeof v !== "string") return `${k.id}: not a string`;
    if (k.maxLength != null && (!Number.isSafeInteger(k.maxLength) || k.maxLength < 0)) {
      return `${k.id}: invalid maximum length`;
    }
    if (k.maxLength != null && v.length > k.maxLength) return `${k.id}: exceeds ${k.maxLength} chars`;
  } else {
    return `${k.id}: unsupported knob type`;
  }
  return null;
}

/** Validate the module-authored catalog itself before accepting channel data. */
export function validateCustomizationSurface(surface: CustomizationSurface): string[] {
  const errors: string[] = [];
  if (!surface.capabilities.length || surface.capabilities.some((value) => !value.trim())) {
    errors.push("capabilities must contain non-empty descriptions");
  }
  const byId = new Map<string, Knob>();
  for (const knob of surface.knobs) {
    if (!knob.id.trim()) errors.push("knob id must not be empty");
    if (byId.has(knob.id)) errors.push(`duplicate knob '${knob.id}'`);
    byId.set(knob.id, knob);
    if (!knob.describes.trim()) errors.push(`${knob.id}: description must not be empty`);
    if (knob.servesStyles.some((style) => !style.trim())) errors.push(`${knob.id}: styles must not be empty strings`);
    const defaultError = checkKnob(knob, knob.default);
    if (defaultError) errors.push(`${knob.id}: invalid default (${defaultError})`);
  }
  for (const [presetName, preset] of Object.entries(surface.presets)) {
    if (!presetName.trim()) errors.push("preset name must not be empty");
    for (const [id, value] of Object.entries(preset)) {
      const knob = byId.get(id);
      if (!knob) errors.push(`preset '${presetName}' uses unknown knob '${id}'`);
      else {
        const valueError = checkKnob(knob, value);
        if (valueError) errors.push(`preset '${presetName}': ${valueError}`);
      }
    }
  }
  return errors;
}

/**
 * Validate a bag of knob values against a surface. Unknown keys and illegal values
 * are errors (fail loud). Returns the resolved values (defaults filled for omitted knobs).
 */
export function validateKnobs(surface: CustomizationSurface, values: KnobValues): { ok: boolean; values: KnobValues; errors: string[] } {
  const byId = new Map(surface.knobs.map((k) => [k.id, k] as const));
  const out = knobDefaults(surface);
  const errors = validateCustomizationSurface(surface);
  for (const [id, v] of Object.entries(values)) {
    const k = byId.get(id);
    if (!k) { errors.push(`unknown knob '${id}'`); continue; }
    const err = checkKnob(k, v);
    if (err) errors.push(err);
    else out[id] = v;
  }
  return { ok: errors.length === 0, values: out, errors };
}

/**
 * Resolve `preset + overrides → validated knob values`. This is what the Director
 * runs per module: pick the Architect's preset, layer the channel's overrides,
 * validate against the surface. Unknown preset / illegal value ⇒ fail loud.
 */
export function resolveKnobs(
  surface: CustomizationSurface,
  presetName?: string,
  overrides: KnobValues = {},
): { ok: boolean; values: KnobValues; errors: string[]; preset?: string } {
  if (presetName !== undefined && !Object.hasOwn(surface.presets, presetName)) {
    return { ok: false, values: knobDefaults(surface), errors: [`unknown preset '${presetName}'`], preset: presetName };
  }
  const preset = presetName === undefined ? {} : surface.presets[presetName];
  const r = validateKnobs(surface, { ...preset, ...overrides });
  return { ...r, preset: presetName };
}
