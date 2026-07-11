/**
 * comfyWorkflow — convert a ComfyUI **UI-format** workflow (the `nodes[]` + `links[]`
 * JSON you export/drag into the ComfyUI canvas) into the **API/prompt format**
 * (`{ [nodeId]: { class_type, inputs } }`) that the comfyui-api `/prompt` endpoint
 * (and ComfyUI's own `/prompt`) require.
 *
 * ComfyUI does this conversion in the browser (`graphToPrompt`); headless we
 * replicate it from the live server's `/object_info` (authoritative input
 * names/order per node). Used to turn the official LTX-2.3 example workflows into
 * a substitutable template for the salad-ltx provider.
 */

export interface ObjectInfoEntry {
  input?: {
    required?: Record<string, unknown>;
    optional?: Record<string, unknown>;
  };
}
export type ObjectInfo = Record<string, ObjectInfoEntry>;

interface UiNode {
  id: number;
  type: string;
  mode?: number; // 2 = muted, 4 = bypassed
  inputs?: Array<{ name: string; link: number | null; type?: string }>;
  outputs?: Array<{ name: string; links?: number[] | null }>;
  widgets_values?: unknown[];
  title?: string;
}
// link tuple: [linkId, srcNodeId, srcSlot, dstNodeId, dstSlot, type]
type UiLink = [number, number, number, number, number, string];
export interface UiWorkflow {
  nodes: UiNode[];
  links: UiLink[];
}

export interface ApiNode {
  class_type: string;
  inputs: Record<string, unknown>;
  _meta?: { title?: string };
}
export type ApiPrompt = Record<string, ApiNode>;

const SKIP_TYPES = new Set([
  "Note", "MarkdownNote", "Reroute", "PrimitiveNode",
  "PrimitiveString", "PrimitiveInt", "PrimitiveFloat", "PrimitiveBoolean",
]);
const SOCKET_TYPES = new Set([
  "MODEL", "LATENT", "IMAGE", "MASK", "VAE", "CLIP", "CONDITIONING", "AUDIO",
  "CONTROL_NET", "SIGMAS", "SAMPLER", "GUIDER", "NOISE", "LATENT_UPSCALE_MODEL",
  "UPSCALE_MODEL", "VIDEO",
]);

/** A widget input consumes an extra widgets_values entry for control_after_generate. */
function hasControlAfterGenerate(name: string, spec: unknown): boolean {
  if (name === "seed" || name === "noise_seed") return true;
  if (Array.isArray(spec) && spec[1] && typeof spec[1] === "object") {
    return Boolean((spec[1] as Record<string, unknown>).control_after_generate);
  }
  return false;
}

function isWidgetInput(spec: unknown): boolean {
  const t = Array.isArray(spec) ? spec[0] : spec;
  if (Array.isArray(t)) return true; // COMBO (dropdown) → widget
  return typeof t === "string" && ["INT", "FLOAT", "STRING", "BOOLEAN", "COMBO"].includes(t);
}

/**
 * Convert. `objectInfo` maps class_type → its input schema (from GET /object_info).
 * Nodes whose class_type is missing from objectInfo keep only their link inputs
 * (widgets can't be mapped without the schema) — surfaced via the returned `warnings`.
 */
export function uiToApi(ui: UiWorkflow, objectInfo: ObjectInfo): { prompt: ApiPrompt; warnings: string[] } {
  const warnings: string[] = [];
  const nodeById = new Map<number, UiNode>();
  for (const n of ui.nodes) nodeById.set(n.id, n);

  const linkById = new Map<number, { src: number; slot: number }>();
  for (const l of ui.links || []) {
    if (Array.isArray(l) && l.length >= 4) linkById.set(l[0], { src: l[1], slot: l[2] });
  }

  // Resolve a link source through Reroute/Primitive passthrough nodes.
  const resolveSource = (nodeId: number, slot: number): [string, number] => {
    let node = nodeById.get(nodeId);
    let guard = 0;
    while (node && (node.type === "Reroute" || node.type.startsWith("Primitive")) && guard++ < 16) {
      const inLink = node.inputs?.[0]?.link;
      if (inLink == null) break;
      const up = linkById.get(inLink);
      if (!up) break;
      node = nodeById.get(up.src);
      nodeId = up.src;
      slot = up.slot;
    }
    return [String(nodeId), slot];
  };

  const prompt: ApiPrompt = {};
  for (const n of ui.nodes) {
    if (SKIP_TYPES.has(n.type)) continue;
    if (n.mode === 2 || n.mode === 4) continue; // muted / bypassed

    const inputs: Record<string, unknown> = {};
    const linked = new Set<string>();
    for (const inp of n.inputs || []) {
      if (inp.link != null && linkById.has(inp.link)) {
        const { src, slot } = linkById.get(inp.link)!;
        inputs[inp.name] = resolveSource(src, slot);
        linked.add(inp.name);
      }
    }

    const info = objectInfo[n.type];
    const wv = n.widgets_values;
    if (info && Array.isArray(wv)) {
      const order = [
        ...Object.entries(info.input?.required || {}),
        ...Object.entries(info.input?.optional || {}),
      ];
      let wi = 0;
      for (const [name, spec] of order) {
        if (linked.has(name)) continue;
        const t = Array.isArray(spec) ? spec[0] : spec;
        // pure socket input with no widget → provided by a link (or optional/absent)
        if (typeof t === "string" && SOCKET_TYPES.has(t)) continue;
        if (!isWidgetInput(spec)) continue;
        if (wi >= wv.length) break;
        inputs[name] = wv[wi++];
        if (hasControlAfterGenerate(name, spec) && wi < wv.length && typeof wv[wi] === "string") {
          wi++; // consume control_after_generate ("fixed"/"randomize"/…)
        }
      }
    } else if (Array.isArray(wv) && wv.length) {
      warnings.push(`no /object_info for "${n.type}" (node ${n.id}) — ${wv.length} widget values unmapped`);
    }

    prompt[String(n.id)] = { class_type: n.type, inputs, _meta: { title: n.title || n.type } };
  }
  return { prompt, warnings };
}
