/**
 * Exact numeric-presence floor shared by titles and data inserts, not
 * semantic/factual entailment.
 * Parse complete English quantities once: 10.2 is neither 102 nor 10, and
 * two million is not two. Keep decimal arithmetic as strings/BigInts, never
 * rounded chart values. Other locales' ambiguous notation stays literal.
 */
const SMALL = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
  'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const SCALES = new Map([['thousand', 3], ['million', 6], ['billion', 9], ['trillion', 12]]);
const SHORT_SCALES = new Map([['k', 3], ['m', 6], ['mm', 6], ['mn', 6], ['b', 9], ['bn', 9], ['t', 12], ['tn', 12]]);
interface Token { text: string; start: number; end: number }
interface Decimal { coefficient: bigint; places: number }
interface Parsed { value: Decimal; end: number }
export interface NumericMention {
  raw: string;
  /** Offsets in the NFKC-normalized input, for binding adjacent units. */
  start: number;
  end: number;
  /** Exact equality key; never compare floating-point plot values for evidence. */
  key: string;
  digit: boolean;
  /** Finite approximation for plot geometry only; null for literal-only forms. */
  plotValue: number | null;
}
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

export function numericMentions(input: string): NumericMention[] {
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
  const found: NumericMention[] = [];
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
      if (token && /^\d/.test(token.text)) found.push({
        raw: text.slice(tokens[start].start, token.end),
        start: tokens[start].start,
        end: token.end,
        key: `literal:${sign}:${token.text}`,
        digit: true,
        plotValue: null,
      });
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
    const plotValue = Number(value.coefficient) / (10 ** value.places);
    found.push({
      raw,
      start: tokens[start].start,
      end: tokens[i - 1]!.end,
      key: key(value),
      digit: /\d/.test(raw),
      plotValue: Number.isFinite(plotValue) ? plotValue : null,
    });
  }
  return found;
}

function explicitUnit(input: string, mention: NumericMention): string | undefined {
  const text = input.normalize('NFKC').toLowerCase().replace(/−/g, '-');
  const before = text.slice(Math.max(0, mention.start - 32), mention.start);
  const raw = text.slice(mention.start, mention.end);
  const after = text.slice(mention.end, mention.end + 40)
    .replace(/^\s*[-–]\s*/u, ' ')
    .trimStart();
  const currencyCode = /^(usd|cad|aud|nzd|sgd|hkd|cny|rmb|eur|gbp|jpy|inr|chf|mxn|brl|krw|zar)\b/u.exec(after)?.[1];
  if (currencyCode) return `currency:${currencyCode}`;
  const currencyName = /^(canadian dollars?|australian dollars?|new zealand dollars?|singapore dollars?|hong kong dollars?|chinese yuan|yuan|renminbi|indian rupees?|swiss francs?|mexican pesos?|brazilian reais?|south korean won)\b/u.exec(after)?.[1];
  if (currencyName) {
    if (currencyName.startsWith('canadian')) return 'currency:cad';
    if (currencyName.startsWith('australian')) return 'currency:aud';
    if (currencyName.startsWith('new zealand')) return 'currency:nzd';
    if (currencyName.startsWith('singapore')) return 'currency:sgd';
    if (currencyName.startsWith('hong kong')) return 'currency:hkd';
    if (currencyName === 'yuan' || currencyName.startsWith('chinese') || currencyName === 'renminbi') return 'currency:cny';
    if (currencyName.startsWith('indian')) return 'currency:inr';
    if (currencyName.startsWith('swiss')) return 'currency:chf';
    if (currencyName.startsWith('mexican')) return 'currency:mxn';
    if (currencyName.startsWith('brazilian')) return 'currency:brl';
    return 'currency:krw';
  }
  const prefixCode = /\b(usd|cad|aud|nzd|sgd|hkd|cny|rmb|eur|gbp|jpy|inr|chf|mxn|brl|krw|zar)\s*$/u.exec(before)?.[1];
  if (prefixCode) return `currency:${prefixCode}`;

  if (/[$]/u.test(raw) || /\$\s*$/u.test(before) || /\b(?:usd|us dollars?)\s*$/u.test(before)) return 'currency:usd';
  if (/€/u.test(raw) || /€\s*$/u.test(before) || /\b(?:eur|euros?)\s*$/u.test(before)) return 'currency:eur';
  if (/£/u.test(raw) || /£\s*$/u.test(before) || /\b(?:gbp|pounds? sterling)\s*$/u.test(before)) return 'currency:gbp';
  if (/¥/u.test(raw) || /¥\s*$/u.test(before) || /\b(?:jpy|yen)\s*$/u.test(before)) return 'currency:jpy';

  if (/^(?:percentage\s+points?|basis\s+points?|bps)\b/u.test(after)) {
    return /^(?:basis\s+points?|bps)\b/u.test(after) ? 'rate:basis-point' : 'rate:percentage-point';
  }
  if (/^%/u.test(after) || /^(?:percent(?:age)?|per\s+cent|pct)\b/u.test(after)) return 'rate:percent';
  if (/^(?:us\s+)?(?:dollars?|usd|bucks?)\b/u.test(after)) return 'currency:usd';
  if (/^(?:euros?|eur)\b/u.test(after)) return 'currency:eur';
  if (/^(?:pounds?|gbp)\b/u.test(after)) return 'currency:gbp';
  if (/^(?:yen|jpy)\b/u.test(after)) return 'currency:jpy';
  if (/^(?:years?|yrs?)\b/u.test(after)) return 'time:year';
  if (/^(?:months?|mos?)\b/u.test(after)) return 'time:month';
  if (/^(?:weeks?|wks?)\b/u.test(after)) return 'time:week';
  if (/^(?:days?)\b/u.test(after)) return 'time:day';
  if (/^(?:hours?|hrs?)\b/u.test(after)) return 'time:hour';
  if (/^(?:minutes?|mins?)\b/u.test(after)) return 'time:minute';
  if (/^(?:seconds?|secs?)\b/u.test(after)) return 'time:second';
  return undefined;
}

/** Explicit units must belong to the same exact numeric claim in source. */
export function unmatchedNumericUnits(rendered: string, source: string): string[] {
  const renderedMentions = numericMentions(rendered);
  if (!renderedMentions.length) return [];
  const sourceMentions = numericMentions(source);
  const resolvedUnit = (input: string, mentions: NumericMention[], index: number): string | undefined => {
    const mention = mentions[index]!;
    const direct = explicitUnit(input, mention);
    if (direct) return direct;
    const next = mentions[index + 1];
    if (!next || !explicitUnit(input, next)) return undefined;
    const between = input.normalize('NFKC').toLowerCase().replace(/−/g, '-').slice(mention.end, next.start);
    return /^\s+(?:and|or|to|through)\s+$/u.test(between) ? explicitUnit(input, next) : undefined;
  };
  return renderedMentions
    .filter((renderedMention, index) => {
      const unit = resolvedUnit(rendered, renderedMentions, index);
      return unit !== undefined && !sourceMentions.some((sourceMention, sourceIndex) =>
        sourceMention.key === renderedMention.key &&
        resolvedUnit(source, sourceMentions, sourceIndex) === unit,
      );
    })
    .map((mention) => mention.raw);
}

/** Explicit title units must belong to the same exact numeric claim in source. */
export function unmatchedTitleUnits(title: string, source: string): string[] {
  return unmatchedNumericUnits(title, source);
}

/** Compare complete numeric quantities; unit, causal and alias checks are separate. */
function unmatchedNumbers(claimed: readonly NumericMention[], source: string): NumericMention[] {
  if (!claimed.length) return [];
  const available = new Set(numericMentions(source).map((mention) => mention.key));
  return claimed.filter((mention) => !available.has(mention.key));
}

/** Cold-open grounding ignores idiomatic unitless "one" but checks explicit digits and quantities. */
export function unmatchedSpokenNumericClaims(text: string, source: string): string[] {
  const claimed = numericMentions(text).filter((mention) =>
    mention.digit || mention.key !== "1:0" || explicitUnit(text, mention) !== undefined,
  );
  return unmatchedNumbers(claimed, source).map((mention) => mention.raw);
}

/** Titles retain their calibrated digit-claim scope; opening prose checks spoken quantities too. */
export function unmatchedTitleNumbers(title: string, source: string): string[] {
  return unmatchedNumbers(numericMentions(title).filter((mention) => mention.digit), source)
    .map((mention) => mention.raw);
}
