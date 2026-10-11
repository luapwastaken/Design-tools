// Pasted colour lists: one per line, or separated by commas outside parentheses (the v1 paste split
// `rgb(255, 128, 0)` into three junk items). Text around a colour is its name: "Ember: #e8643c".
// A JSON paste (a list, a tokens object, this tool's own export) is read for its name and colour pairs.
import { deltaE, hexToOklch, parseCss, parseHex, toOklch, type Oklch } from '../color/index.ts';
import { wrapHue } from './space.ts';
import { TOKENS_NAMESPACE } from './writers.ts';

/** `names`: what the text called each (null: nothing); `notes`: what was dropped on the way ("Alpha is ignored") */
export type Pasted = { colours: Oklch[]; names: (string | null)[]; rejected: string[]; notes: string[] };

const FN = /\b(rgba?|hsla?|hwb|oklch|oklab|lab|lch|color)\(([^()]*)\)/gi;
const HASH_HEX = /#([0-9a-f]{3,8})\b/gi;
/** without "#", only 3 or 6 digits: 4-letter words (cafe, beef) would read as #RGBA */
const BARE_HEX = /^(?:(.*?)\s*[:=]\s*)?((?:0x)?(?:[0-9a-f]{3}|[0-9a-f]{6}))$/i;
/** a CSS colour keyword (white, rebeccapurple), as the whole item or after "name:" */
const KEYWORD = /^(?:(.*?)\s*[:=]\s*)?([a-z]+)$/i;
const COMMENT = /\/\*.*?\*\/|(?:^|\s)\/\/.*$/g;
/** separators, brackets and wrapping left over once the colour is cut out of an item */
const PUNCT = /^[\s"'`:=;,\-*[\]{}()]+|[\s"'`:=;,\-*[\]{}()]+$/g;

const NUM = String.raw`[+-]?(?:\d+\.?\d*|\.\d+)`;
/** three or four bare numbers, optionally in brackets: "255 136 0", "[1, 0.5333, 0, 1]" */
const NUMBERS = new RegExp(String.raw`^(\[)?\s*(${NUM})(?:\s*,\s*|\s+)(${NUM})(?:\s*,\s*|\s+)(${NUM})(?:(?:\s*,\s*|\s+)(${NUM}))?\s*\]?$`);
/** a hex or a function with an alpha that is dropped */
const ALPHA_NOTE = 'Alpha is ignored';
const ALPHA = /#(?:[0-9a-f]{4}|[0-9a-f]{8})\b|\b(?:rgba|hsla)\(|\/\s*[\d.]+%?\s*\)/i;

/**
 * Colours as plain numbers. Any above 1, or whole numbers: RGB 0-255 (Photoshop, Krita, Cinema 4D).
 * Fractions up to 1 (or only 0s and 1s): in brackets sRGB 0-1 (an After Effects array, 4th is alpha), else this tool's own
 * "Linear RGB 0-1" copy. Null when it isn't numbers, or they fit neither.
 */
function fromNumbers(item: string): { oklch: Oklch; alpha: boolean } | null {
  const m = NUMBERS.exec(item.trim());
  if (!m) return null;
  const v = [Number(m[2]), Number(m[3]), Number(m[4])];
  const alpha = m[5] !== undefined;
  const unit = v.every((x) => x >= 0 && x <= 1) && (v.some((x) => !Number.isInteger(x)) || v.includes(1));
  if (unit) return { oklch: toOklch({ mode: m[1] ? 'rgb' : 'lrgb', r: v[0], g: v[1], b: v[2] }), alpha };
  if (v.some((x) => !Number.isInteger(x) || x < 0 || x > 255)) return null;
  return { oklch: toOklch({ mode: 'rgb', r: v[0] / 255, g: v[1] / 255, b: v[2] / 255 }), alpha };
}

/** "color-primary", "--brand-primary" and the like: the prefix that says it is a colour is not part of the name */
const cleanName = (n: string): string => n.replace(/^colou?r[-_.]+(?=\S)/i, '');

export function parseColours(text: string): Pasted {
  const out: Pasted = { colours: [], names: [], rejected: [], notes: [] };
  const lines = jsonLines(text) ?? withoutDerived(text, out).split(/\r?\n/).map((l) => l.replace(COMMENT, ''));
  const items: string[] = [];
  const add = (oklch: Oklch, name: string | null) => {
    // the same colour written two ways (0-1 floats are not exact bytes) is one colour: closer than one 8-bit step
    const at = out.colours.findIndex((c) => deltaE(c, oklch) < 0.5);
    if (at >= 0) {
      out.names[at] ??= name; // "#abc, Ember: #aabbcc": one colour, and it keeps the name
      return;
    }
    out.colours.push(oklch);
    out.names.push(name);
  };
  for (const line of lines) {
    const parts = splitOutsideParens(line);
    // numbers alone are one colour (0-255, or 0-1): "250, 250, 250" is a grey, not three 3-digit hexes
    const numbers = fromNumbers(line);
    if (numbers) {
      if (numbers.alpha && !out.notes.includes(ALPHA_NOTE)) out.notes.push(ALPHA_NOTE);
      add(numbers.oklch, null);
    } else if (parts.length > 1 && parts.every((p) => /^\d{1,3}$/.test(p))) out.rejected.push(line.trim());
    else items.push(...parts);
  }
  for (const item of items) {
    const found = findColours(item);
    if (!found || found.some((f) => !f.oklch)) {
      out.rejected.push(item);
      continue;
    }
    let rest = found.reduce((s, f) => s.replace(f.text, ' '), item).replace(PUNCT, '').trim();
    // a token written out ("accent": { "$value": "#e8643c" }) is called by its key
    if (rest.includes('$value')) rest = rest.split(/["']?\s*:/)[0].replace(PUNCT, '');
    if (ALPHA.test(item) && !out.notes.includes(ALPHA_NOTE)) out.notes.push(ALPHA_NOTE);
    // a list number ("1.") or a lone bracket isn't a name
    for (const f of found) add(f.oklch!, found.length === 1 && /\p{L}/u.test(rest) ? cleanName(rest) : null);
  }
  return out;
}

/** custom properties this app's own CSS adds beside the real colours: a colour's -hex twin, and --on-primary and the like */
const DERIVED = /--(?:[\w-]*-hex|(?:color-)?on-[\w-]*)\s*:[^;\n}]*;?/g;

/** a rule's opening and closing line (`:root {`, `@theme {`, `}`) */
const BLOCK_LINE = /^\s*(?:[:@.#\w-]+(?:\s+\w+)?\s*)?\{\s*$|^\s*\}\s*$/gm;

/**
 * The text without the helpers this app's own CSS adds, so pasting the export back brings in the
 * palette and not its -hex twins; a stylesheet's braces are not colours either.
 */
function withoutDerived(text: string, out: Pasted): string {
  if (!/--[\w-]+\s*:/.test(text)) return text;
  const kept = text.replace(DERIVED, '');
  if (kept !== text) out.notes.push('Skipped the -hex and --on-… values, which are worked out from the colours');
  return kept.replace(BLOCK_LINE, '');
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
    // a design-tokens file this app wrote keeps the same under $extensions
    const mine = isObjectOf(o.$extensions) && isObjectOf(o.$extensions[TOKENS_NAMESPACE]) ? o.$extensions[TOKENS_NAMESPACE] : null;
    const oklch = [o, mine].map((x) => (x && Array.isArray(x.oklch) && x.oklch.length === 3 && x.oklch.every(Number.isFinite) ? `oklch(${x.oklch.join(' ')})` : null)).find(Boolean);
    const colour = oklch ?? (isObjectOf(o.$value) ? dtcgValue(o.$value) : null) ?? o.hex ?? o.$value ?? o.value ?? o.color ?? o.colour;
    if (typeof colour === 'string') add(colour, mine?.name ?? o.name ?? key);
    // $type, $description and $extensions describe a token; they are not tokens
    else for (const [k, x] of Object.entries(o)) if (!k.startsWith('$')) walk(x, k);
  };
  // a bare array of three or four numbers (an After Effects colour) is one colour, read as it is
  if (Array.isArray(data) && data.length >= 3 && data.length <= 4 && data.every((x) => typeof x === 'number')) return [`[${data.join(', ')}]`];
  walk(data, '');
  return lines;
}

const isObjectOf = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** a design-tokens colour value ({ colorSpace, components, hex }): its hex, else the components written as CSS */
function dtcgValue(v: Record<string, unknown>): string | null {
  if (typeof v.hex === 'string') return v.hex;
  const c = Array.isArray(v.components) ? v.components.map((x) => (x === 'none' ? 0 : x)) : [];
  if (c.length !== 3 || !c.every(Number.isFinite)) return null;
  switch (v.colorSpace) {
    case 'oklch':
    case 'oklab':
      return `${v.colorSpace}(${c.join(' ')})`;
    case 'srgb':
    case 'display-p3':
      return `color(${v.colorSpace} ${c.join(' ')})`;
    default:
      return null;
  }
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
  if (bare) return [{ text: bare[2], oklch: fromHex(bare[2].replace(/^0x/i, '')) }];
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
