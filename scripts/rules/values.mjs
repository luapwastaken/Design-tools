// Value helpers shared by the CSS and TS checks: the character allowlist, colour literals and
// motion (brief §2 rules 1, 2 and 4).
import { colorsNamed } from 'culori';

/** Rule 1: the only non-ASCII characters UI strings may hold. The brief's `" " '` are the
 *  typographic quotes the UI uses: U+201C, U+201D and U+2019. */
export const ALLOWED_CHARS = new Set(['×', '·', '°', 'Δ', '≈', '–', '…', '“', '”', '’']);

export const codePoint = (ch) => `U+${ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`;

const HEX = /#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})(?![\w-])/i;
const FN = /(?<![\w-])(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix|light-dark)\(/gi;
const NAMED = Object.keys(colorsNamed);
const SYSTEM = ['canvas', 'canvastext', 'linktext', 'visitedtext', 'activetext', 'buttonface', 'buttontext',
  'buttonborder', 'field', 'fieldtext', 'highlight', 'highlighttext', 'selecteditem', 'selecteditemtext', 'mark',
  'marktext', 'graytext', 'accentcolor', 'accentcolortext'];
const NAMED_WORD = new RegExp(`(?<![\\w-])(?:${[...NAMED, ...SYSTEM].join('|')})(?![\\w-])`, 'i');
const NAMED_EXACT = new Set(NAMED);

/** A hex or colour function in any text, or null. `oklch()` passes only when allowed (tokens.css). */
export function colourFunction(text, allowOklch = false) {
  const hex = text.match(HEX);
  if (hex) return hex[0];
  for (const m of text.matchAll(FN)) if (!(allowOklch && m[1].toLowerCase() === 'oklch')) return `${m[1]}()`;
  return null;
}

/** Properties whose values are author names (keyframes, grid areas, fonts), which can collide with colour names. */
const NAME_VALUED = /^(animation(-name)?|font(-family)?|grid(-.*)?|container(-name)?|counter-.*|view-transition-name)$/;

/** A colour literal in a CSS declaration value, or null. Strings, url() and custom property names are skipped. */
export function cssColour(prop, value, allowOklch = false) {
  const v = value.replace(/(["'])(?:\\.|(?!\1).)*\1/g, '""').replace(/url\([^)]*\)/gi, '').replace(/--[\w-]+/g, '');
  return colourFunction(v, allowOklch) ?? (NAME_VALUED.test(prop) ? null : v.match(NAMED_WORD)?.[0] ?? null);
}

/** A whole TS string that is a named colour ('white'). Lowercase only, so UI words like "Black" pass. */
export const isNamedColour = (s) => NAMED_EXACT.has(s.trim());

// ── motion (rule 4) ──

export const MAX_MS = 120;
/** what transitions, @keyframes and WAAPI may move */
export const MOVE = new Set(['transform', 'translate', 'scale', 'rotate', 'clip-path']);
const EASING = /^(ease|ease-in|ease-out|ease-in-out|linear|step-start|step-end|(cubic-bezier|steps|linear)\(.*\))$/i;
const ANIM_WORDS = new Set(['normal', 'reverse', 'alternate', 'alternate-reverse', 'none', 'forwards', 'backwards',
  'both', 'running', 'paused', 'infinite']);

/** Splits at a separator outside parentheses: `a(1, 2), b` → ['a(1, 2)', 'b']. */
export function splitTop(s, sep) {
  const out = [];
  let depth = 0, cur = '';
  for (const ch of s) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (depth === 0 && (sep === ' ' ? /\s/.test(ch) : ch === sep)) {
      if (cur.trim()) out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** `var(--t-fast)` → its value from tokens.css; undefined when it can't be resolved. */
const resolve = (tok, vars) => (tok.startsWith('var(') ? vars[tok.match(/^var\(\s*(--[\w-]+)\s*\)$/)?.[1]] : tok);
const toMs = (t) => {
  const m = /^(-?\d*\.?\d+)(ms|s)$/i.exec(t);
  return m ? Number(m[1]) * (m[2].toLowerCase() === 's' ? 1000 : 1) : null;
};

/** Reads one comma item of a transition or animation shorthand. */
function readItem(item, vars) {
  const r = { times: [], words: [], idents: [], unknown: [] };
  for (const raw of splitTop(item, ' ')) {
    const t = resolve(raw, vars);
    if (t === undefined) r.unknown.push(raw);
    else if (toMs(t) !== null) r.times.push(toMs(t));
    else if (EASING.test(t) || /^\d*\.?\d+$/.test(t) || ANIM_WORDS.has(t.toLowerCase()) || t === 'allow-discrete') r.words.push(t.toLowerCase());
    else r.idents.push(t.toLowerCase());
  }
  return r;
}

/** Problems with a `transition` shorthand value. */
export function transitionProblems(value, vars) {
  if (value === 'none') return [];
  const out = [];
  for (const item of splitTop(value, ',')) {
    const r = readItem(item, vars);
    for (const u of r.unknown) out.push(`transition uses ${u}, which can't be resolved from tokens.css`);
    const prop = r.idents[0];
    if (!prop) out.push(`transition "${item}" has no property (a bare duration means all)`);
    else if (!MOVE.has(prop)) out.push(`transition on ${prop}; only ${[...MOVE].join(', ')} may move`);
    if (r.times[0] > MAX_MS) out.push(`transition "${item}" runs ${r.times[0]}ms (max ${MAX_MS}ms)`);
  }
  return out;
}

/** Problems with a list of durations (`transition-duration`, `animation-duration`). */
export function durationProblems(prop, value, vars) {
  return splitTop(value, ',').flatMap((raw) => {
    const t = resolve(raw, vars);
    const d = t === undefined ? null : toMs(t);
    if (d === null) return [`${prop} ${raw} can't be read as a duration`];
    return d > MAX_MS ? [`${prop} ${raw} is ${d}ms (max ${MAX_MS}ms)`] : [];
  });
}

