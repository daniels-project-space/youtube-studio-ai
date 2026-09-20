import { getInfo as anton } from "@remotion/google-fonts/Anton";
import { getInfo as oswald } from "@remotion/google-fonts/Oswald";
import { getInfo as caveat } from "@remotion/google-fonts/Caveat";
import { getInfo as specialElite } from "@remotion/google-fonts/SpecialElite";
import { loadFontFromInfo } from "@remotion/google-fonts/from-info";
import { staticFile } from "remotion";
import manifest from "../../public/fonts/documotion/manifest.json";

type FontInfo = Parameters<typeof loadFontFromInfo>[0];

export const DOCU_FONT_SELECTIONS: { info: FontInfo; weights: string[]; subsets: string[] }[] = [
  { info: anton(), weights: ["400"], subsets: ["vietnamese", "latin-ext", "latin"] },
  { info: oswald(), weights: ["500", "600", "700"], subsets: ["latin"] },
  { info: caveat(), weights: ["600", "700"], subsets: ["latin"] },
  { info: specialElite(), weights: ["400"], subsets: ["latin"] },
];

export function localDocuFontInfo(
  info: FontInfo,
  weights: string[],
  subsets: string[],
): FontInfo {
  const normal = Object.fromEntries(weights.map((weight) => [weight,
    Object.fromEntries(subsets.map((subset) => {
      const source = info.fonts.normal?.[weight]?.[subset];
      const asset = manifest.assets.find((entry) => entry.source === source);
      if (!asset) throw new Error(`Unvendored DocuMotion font: ${info.fontFamily}/${weight}/${subset}`);
      return [subset, staticFile(`fonts/documotion/${asset.file}`)];
    })),
  ]));
  return { ...info, subsets, fonts: { normal } };
}

export function loadDocuFonts(): void {
  for (const { info, weights, subsets } of DOCU_FONT_SELECTIONS) {
    // Keep Remotion's native delayRender lifecycle and original unicode ranges.
    loadFontFromInfo(localDocuFontInfo(info, weights, subsets), "normal", { weights, subsets });
  }
}
