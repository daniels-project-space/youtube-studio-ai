/**
 * Exact numeric-presence floor for titles, not semantic/factual entailment.
 * Parse complete English quantities once: 10.2 is neither 102 nor 10, and
 * two million is not two. Keep decimal arithmetic as strings/BigInts, never
 * rounded chart values. Other locales' ambiguous notation stays literal.
 */
const SMALL = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
  'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const SCALES = new Map([['thousand', 3], ['million', 6], ['billion', 9], ['trillion', 12]]);
const SHORT_SCALES = new Map([['k', 3], ['m', 6], ['b', 9], ['bn', 9], ['tn', 12]]);
interface Token { text: string; start: number; end: number }
interface Decimal { coefficient: bigint; places: number }
interface Parsed { value: Decimal; end: number }
interface Mention { raw: string; key: string; digit: boolean }
const pow10 = (power: number) => BigInt(10) ** BigInt(power);
const integer = (value: number): Decimal => ({ coefficient: BigInt(value), places: 0 });

function key(value: Decimal): string {
  if (value.coefficient === BigInt(0)) return '0:0';
  const digits = value.coefficient.toString();
  const trailingZeros = digits.length - digits.replace(/0+$/, '').length;
  const trim = Math.min(value.places, trailingZeros);
  return `${trim ? digits.slice(0, -trim) : digits}:${value.places - trim}`;
}
function add(a: Decimal, b: Decimal): Decimal {
  if (a.coefficient === BigInt(0)) return b;
  if (b.coefficient === BigInt(0)) return a;
  const places = Math.max(a.places, b.places);
  return { coefficient: a.coefficient * pow10(places - a.places) + b.coefficient * pow10(places - b.places), places };
}
function scale(value: Decimal, power: number): Decimal {
  return power >= value.places
    ? { coefficient: value.coefficient * pow10(power - value.places), places: 0 }
    : { coefficient: value.coefficient, places: value.places - power };
}

function mentions(input: string): Mention[] {
  const text = input.normalize('NFKC').toLowerCase().replace(/−/g, '-');
  const tokens: Token[] = [...text.matchAll(/\d+(?:[.,:/]\d+)*|\.\d+|[\p{L}]+|[^\s]/gu)]
    .map((match) => ({ text: match[0], start: match.index!, end: match.index! + match[0].length }));
  const at = (i: number) => tokens[i]?.text;
  const small = (i: number): { value: number; end: number } | undefined => {
    const unit = SMALL.indexOf(at(i));
    if (unit >= 0) return { value: unit, end: i + 1 };
    const tens = TENS.indexOf(at(i));
    if (tens < 0) return;
    let end = i + 1;
    if (at(end) === '-') end++;
    const tail = SMALL.indexOf(at(end));
    return tail > 0 && tail < 10
      ? { value: (tens + 2) * 10 + tail, end: end + 1 }
      : { value: (tens + 2) * 10, end: i + 1 };
  };
  function atom(i: number): Parsed | undefined {
    const token = at(i);
    if (!token) return;
    // Unambiguous English digit notation only. Do not reinterpret 10,2 as 102.
    if (/^(?:(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?|\.\d+)$/.test(token)) {
      const [whole, fraction = ''] = token.replace(/,/g, '').split('.');
      return { value: { coefficient: BigInt(whole + fraction), places: fraction.length }, end: i + 1 };
    }
    let part = small(i);
    if (token === 'a' && (at(i + 1) === 'hundred' || SCALES.has(at(i + 1)))) part = { value: 1, end: i + 1 };
    if (token === 'hundred') part = { value: 100, end: i + 1 };
    if (!part && token !== 'point') return;
    let whole = part?.value ?? 0, end = part?.end ?? i;
    if (at(end) === 'hundred') {
      whole *= 100;
      end++;
      const tail = small(at(end) === 'and' ? end + 1 : end);
      if (tail) { whole += tail.value; end = tail.end; }
    } else if (part && whole > 0 && whole < 100) {
      // Year/group readings: nineteen-seventeen, four seventy-six, twenty oh five.
      const next = at(end) === '-' ? end + 1 : end;
      const tail = small(next);
      if (tail && tail.value >= 10) { whole = whole * 100 + tail.value; end = tail.end; }
      else if (at(next) === 'oh' && SMALL.indexOf(at(next + 1)) >= 0 && SMALL.indexOf(at(next + 1)) < 10) {
        whole = whole * 100 + SMALL.indexOf(at(next + 1)); end = next + 2;
      }
    }
    let value = integer(whole);
    if (at(end) === 'point') {
      let digits = '', cursor = end + 1;
      while (SMALL.indexOf(at(cursor)) >= 0 && SMALL.indexOf(at(cursor)) < 10) {
        digits += SMALL.indexOf(at(cursor)); cursor++;
      }
      if (!digits) return; // Not a decimal, e.g. “the point of sale”.
      value = { coefficient: BigInt(String(whole) + digits), places: digits.length };
      end = cursor;
    }
    return { value, end };
  }
  const found: Mention[] = [];
  for (let i = 0; i < tokens.length;) {
    const start = i;
    let sign = 1;
    if (at(i) === 'minus' || at(i) === 'negative' || (at(i) === '-' &&
      (i === 0 || tokens[i - 1].end < tokens[i].start || !/^[\p{L}\p{N}]/u.test(tokens[i - 1].text)))) { sign = -1; i++; }
    else if (at(i) === '+' || at(i) === 'plus' || at(i) === 'positive') i++;
    if (i > start && /^\p{Sc}$/u.test(at(i) ?? '')) i++;
    const first = i;
    // WW1, LTX2, H3 and similar identifiers are not scalar
    // quantities. Their alias/identity truth belongs to the full-source judge.
    const token = tokens[i];
    if (token && /^\d/.test(token.text) &&
      ((token.start > 0 && /\p{L}/u.test(text[token.start - 1])) ||
       (/\p{L}/u.test(text[token.end] ?? '') && !SHORT_SCALES.has(at(i + 1)) && !SCALES.has(at(i + 1)) && !/^(?:st|nd|rd|th)$/.test(at(i + 1) ?? '')))) {
      i++; continue;
    }
    let part = atom(i);
    if (!part) {
      // Ambiguous digit notation can only match the exact same complete token.
      if (token && /^\d/.test(token.text)) found.push({ raw: text.slice(tokens[start].start, token.end), key: `literal:${sign}:${token.text}`, digit: true });
      i = first + 1; continue;
    }
    let value = integer(0), lastPower = Infinity;
    while (part) {
      i = part.end;
      const power = SCALES.get(at(i)) ?? (/\d/.test(text.slice(tokens[first].start, tokens[i - 1].end)) ? SHORT_SCALES.get(at(i)) : undefined);
      if (power === undefined || power >= lastPower) { value = add(value, part.value); break; }
      value = add(value, scale(part.value, power)); lastPower = power; i++;
      const next = atom(at(i) === 'and' ? i + 1 : i);
      const nextPower = next ? SCALES.get(at(next.end)) : undefined;
      // Consume compound quantities, not the following independent count.
      if (!next || (nextPower !== undefined && nextPower >= lastPower) ||
        (nextPower === undefined && next.value.coefficient >= pow10(lastPower) * pow10(next.value.places))) break;
      part = next;
    }
    if (/^(?:st|nd|rd|th)$/.test(at(i) ?? '') && tokens[i - 1].end === tokens[i].start) i++;
    value.coefficient *= BigInt(sign);
    const raw = text.slice(tokens[start].start, tokens[i - 1].end);
    found.push({ raw, key: key(value), digit: /\d/.test(raw) });
  }
  return found;
}

/** Compare complete quantities; leave units, causal claims and aliases to the judge. */
export function unmatchedTitleNumbers(title: string, source: string): string[] {
  const claimed = mentions(title).filter((mention) => mention.digit);
  if (!claimed.length) return [];
  const available = new Set(mentions(source).map((mention) => mention.key));
  return claimed.filter((mention) => !available.has(mention.key)).map((mention) => mention.raw);
}
