// Pasted colour lists: one per line, or separated by commas outside parentheses (the v1 paste split
// `rgb(255, 128, 0)` into three junk items). Text around a colour is its name: "Ember: #e8643c".
// A JSON paste (a list, a tokens object, this tool's own export) is read for its name and colour pairs.
import { hexToOklch, parseCss, parseHex, toOklch, type Oklch } from '../color/index.ts';
import { wrapHue } from './space.ts';

export type Pasted = { colours: Oklch[]; names: (string | null)[]; rejected: string[] };

const FN = /\b(rgba?|hsla?|hwb|oklch|oklab|lab|lch|color)\(([^()]*)\)/gi;
const HASH_HEX = /#([0-9a-f]{3,8})\b/gi;
/** without "#", only 3 or 6 digits: 4-letter words (cafe, beef) would read as #RGBA */
const BARE_HEX = /^(?:(.*?)\s*[:=]\s*)?([0-9a-f]{3}|[0-9a-f]{6})$/i;
/** a CSS colour keyword (white, rebeccapurple), as the whole item or after "name:" */
const KEYWORD = /^(?:(.*?)\s*[:=]\s*)?([a-z]+)$/i;
const COMMENT = /\/\*.*?\*\/|(?:^|\s)\/\/.*$/g;
/** separators, brackets and wrapping left over once the colour is cut out of an item */
const PUNCT = /^[\s"'`:=;,\-*[\]{}()]+|[\s"'`:=;,\-*[\]{}()]+$/g;

export function parseColours(text: string): Pasted {
  const out: Pasted = { colours: [], names: [], rejected: [] };
  const seen = new Set<string>();
  const lines = jsonLines(text) ?? text.split(/\r?\n/).map((l) => l.replace(COMMENT, ''));
  for (const item of lines.flatMap(splitOutsideParens)) {
    const found = findColours(item);
    if (!found || found.some((f) => !f.oklch)) {
      out.rejected.push(item);
      continue;
    }
    const rest = found.reduce((s, f) => s.replace(f.text, ' '), item).replace(PUNCT, '').trim();
    for (const f of found) {
      const key = f.oklch!.map((v) => v.toFixed(4)).join(' ');
      if (seen.has(key)) continue; // "#abc, #aabbcc": one colour
      seen.add(key);
      out.colours.push(f.oklch!);
      // a list number ("1.") or a lone bracket isn't a name
      out.names.push(found.length === 1 && /\p{L}/u.test(rest) ? rest : null);
    }
  }
  return out;
}

/** a JSON paste as "name: colour" lines, keeping only strings that are colours; null when it isn't JSON */
function jsonLines(text: string): string[] | null {
  const t = text.trim();
  if (!/^[[{]/.test(t)) return null;
  let data: unknown;
  try {
    data = JSON.parse(t);
  } catch {
    return null;
  }
  const lines: string[] = [];
  const add = (colour: unknown, name: unknown) => {
    if (typeof colour === 'string' && findColours(colour)) lines.push(typeof name === 'string' && name ? `${name}: ${colour}` : colour);
  };
  const walk = (v: unknown, key: string): void => {
    if (Array.isArray(v)) return v.forEach((x) => walk(x, ''));
    if (!v || typeof v !== 'object') return add(v, key);
    const o = v as Record<string, unknown>;
    // a swatch object: this tool's JSON keeps full-precision OKLCH beside the hex
    const oklch = Array.isArray(o.oklch) && o.oklch.length === 3 && o.oklch.every(Number.isFinite) ? `oklch(${o.oklch.join(' ')})` : null;
    const colour = oklch ?? o.hex ?? o.value ?? o.color ?? o.colour;
    if (typeof colour === 'string') add(colour, o.name ?? key);
    else for (const [k, x] of Object.entries(o)) walk(x, k);
  };
  walk(data, '');
  return lines;
}

function splitOutsideParens(line: string): string[] {
  const items: string[] = [];
  let [depth, cur] = [0, ''];
  for (const ch of line) {
    depth += ch === '(' ? 1 : ch === ')' ? -1 : 0;
    if (ch !== ',' || depth > 0) cur += ch;
    else {
      items.push(cur);
      cur = '';
    }
  }
  items.push(cur);
  return items.map((s) => s.trim()).filter(Boolean);
}

/** the colours written in one item, each with its source text; null when there is none */
function findColours(item: string): { text: string; oklch: Oklch | null }[] | null {
  const found = [
    ...[...item.matchAll(FN)].map((m) => ({ at: m.index, text: m[0], oklch: fromFunction(m[1].toLowerCase(), m[2], m[0]) })),
    ...[...item.matchAll(HASH_HEX)].map((m) => ({ at: m.index, text: m[0], oklch: fromHex(m[1]) })),
  ].sort((a, b) => a.at - b.at);
  if (found.length) return found;
  // a bare hex or keyword only counts as the whole item (or after "name:"), so words like "Coffee bad" stay names
  const bare = BARE_HEX.exec(item);
  if (bare) return [{ text: bare[2], oklch: fromHex(bare[2]) }];
  const word = KEYWORD.exec(item);
  const named = word && parseCss(word[2]);
  return named ? [{ text: word[2], oklch: named }] : null;
}

/** 3, 4, 6 or 8 digits; the alpha digits of 4 and 8 are dropped (palettes are opaque) */
function fromHex(digits: string): Oklch | null {
  const hex = parseHex(digits.length === 4 || digits.length === 8 ? digits.slice(0, -digits.length / 4) : digits);
  return hex ? hexToOklch(hex) : null;
}

type Arg = { n: number; unit: string };

/** what 100% means for each argument; 'hue' takes an angle instead */
const PERCENT: Record<string, (number | 'hue')[]> = {
  rgb: [255, 255, 255],
  hsl: ['hue', 100, 100],
  oklch: [1, 0.4, 'hue'],
  oklab: [1, 0.4, 0.4],
  lab: [100, 125, 125],
};
const TO_DEG: Record<string, number> = { '': 1, deg: 1, rad: 180 / Math.PI, grad: 0.9, turn: 360 };

/**
 * CSS colour functions, legacy (commas) and modern (spaces, "/ alpha") syntax; alpha is ignored.
 * hwb(), lch() and color() (display-p3 and the rest) go through the colour module's CSS parser.
 */
function fromFunction(name: string, body: string, whole: string): Oklch | null {
  const fn = name === 'rgba' ? 'rgb' : name === 'hsla' ? 'hsl' : name;
  if (!PERCENT[fn]) return parseCss(whole);
  const args = body.trim().split(/\s*\/\s*/)[0].split(/[\s,]+/).filter(Boolean).map(arg);
  if (args.length < 3 || args.length > 4 || args.some((a) => !a)) return null;
  const [x, y, z] = (args as Arg[]).slice(0, 3).map((a, i) => value(a, PERCENT[fn][i]));
  if (![x, y, z].every(Number.isFinite)) return null;
  const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
  switch (fn) {
    case 'rgb':
      return toOklch({ mode: 'rgb', r: clamp01(x / 255), g: clamp01(y / 255), b: clamp01(z / 255) });
    case 'hsl':
      return toOklch({ mode: 'hsl', h: x, s: clamp01(y / 100), l: clamp01(z / 100) });
    case 'oklch':
      return [clamp01(x), Math.max(0, y), wrapHue(z)];
    case 'oklab':
      return toOklch({ mode: 'oklab', l: clamp01(x), a: y, b: z });
    default: // lab, D50 as in CSS
      return toOklch({ mode: 'lab', l: Math.min(100, Math.max(0, x)), a: y, b: z });
  }
}

function arg(s: string): Arg | null {
  if (s.toLowerCase() === 'none') return { n: 0, unit: '' };
  const m = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(%|deg|rad|grad|turn)?$/i.exec(s);
  return m ? { n: Number(m[1]), unit: (m[2] ?? '').toLowerCase() } : null;
}

/** NaN for a unit that doesn't belong there (a percentage hue, degrees of red) */
function value(a: Arg, percent: number | 'hue'): number {
  if (percent === 'hue') return a.n * (TO_DEG[a.unit] ?? NaN);
  return a.unit === '%' ? (a.n / 100) * percent : a.unit === '' ? a.n : NaN;
}
