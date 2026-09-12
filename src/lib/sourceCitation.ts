import { numericMentions } from './numericClaims';

/** Literal source identity, not verification that the named source made a claim. */
export function sourceCitationOccurs(citation: string, sentence: string): boolean {
  const normalize = (text: string) => text.normalize('NFKC')
    .replace(/\b(?:[A-Za-z]\.){2,}/g, (acronym) => acronym.replace(/\./g, ''))
    .replace(/&/g, ' and ').toLowerCase();
  const tokens = (text: string) => normalize(text).match(/[\p{L}\p{N}]+/gu) ?? [];
  // A bare organization can itself start with “Source”. Only the presentation
  // prefix with a colon is removable; internal words/numbers remain identity.
  const label = citation.normalize('NFKC').replace(/^\s*source\s*:\s*/i, '').trim();
  // A date may precede the institution in the narration but follow it on the
  // badge. Check complete date quantities separately; never invent a year.
  // Separate an explicitly formatted publication year, not every four-digit
  // token: “1000 Genomes Project” must not become merely “Genomes Project”.
  const datedLabel = label.match(/^(.*?)(?:,\s*(\d{4})|\s+\((\d{4})\))$/u);
  const dates = datedLabel ? numericMentions(datedLabel[2] ?? datedLabel[3]) : [];
  const spoken = new Set(numericMentions(sentence).map((mention) => mention.key));
  if (dates.some((date) => !spoken.has(date.key))) return false;
  const name = tokens(datedLabel?.[1] ?? label);
  if (name[0] === 'the') name.shift();
  if (!name.length || name.every((token) => /^(?:a|an|the|it|source|study|report|data|research)$/.test(token))) return false;
  const haystack = tokens(sentence);
  // Preserve order and word boundaries: World Bank is not "world of bankers".
  // Short names such as IMF, UN and G7 remain full tokens, never discarded.
  return haystack.some((_, start) => name.every((token, offset) => haystack[start + offset] === token));
}
