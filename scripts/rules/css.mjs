// CSS checks: `content:`, colour literals, motion, edge stripes and the token blocks (brief §2 rules 1, 2, 4, 7).
import { MOVE, cssColour, durationProblems, splitTop, transitionProblems } from './values.mjs';

/**
 * Every declaration in a stylesheet as { prop, value, line, ctx }, where ctx lists the enclosing
 * selectors and at-rules outermost first. Comments are blanked first so line numbers hold.
 */
export function parseCss(text) {
  text = text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  const lineAt = (i) => text.slice(0, i).split('\n').length;
  const decls = [];
  const stack = [];
  let start = 0, depth = 0, quote = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = '';
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (depth === 0 && (ch === '{' || ch === '}' || ch === ';')) {
      const seg = text.slice(start, i).trim();
      if (ch === '{') stack.push(seg.replace(/\s+/g, ' '));
      else if (seg && !seg.startsWith('@') && seg.includes(':')) {
        const c = seg.indexOf(':');
        const prop = seg.slice(0, c).trim();
        decls.push({
          prop: prop.startsWith('--') ? prop : prop.toLowerCase(),
          value: seg.slice(c + 1).replace(/!important\s*$/i, '').trim(),
          line: lineAt(start + text.slice(start, i).search(/\S/)),
          ctx: [...stack],
        });
      }
      if (ch === '}') stack.pop();
      start = i + 1;
    }
  }
  return decls;
}

const inKeyframes = (d) => d.ctx.some((c) => /^@(-webkit-)?keyframes\b/i.test(c));
const keyframesName = (d) => d.ctx.find((c) => /^@(-webkit-)?keyframes\b/i.test(c)).split(/\s+/)[1];

/**
 * Violations in one stylesheet. `vars` holds tokens.css custom properties for resolving durations;
 * `isTokens` switches the colour rule to "oklch() only" for tokens.css.
 */
export function checkCss(decls, vars, isTokens) {
  const out = [];
  const add = (d, rule, msg) => out.push({ line: d.line, rule, msg });
  const keyframed = new Set();

  for (const d of decls) {
    const { prop, value } = d;
    if (prop === 'content' && value !== '""' && value !== "''") add(d, 1, `content: ${value}; only "" is allowed`);
    if (/material symbols/i.test(value)) add(d, 1, 'the icon font outside the Icon component; render icons with <Icon>');

    const colour = cssColour(prop, value, isTokens);
    if (colour) add(d, 2, isTokens ? `${colour} in tokens.css; tokens are always oklch()` : `colour literal ${colour}; use a var(--token) from tokens.css`);

    // Nothing loops or runs by itself, anywhere (brief §8): a floating layer moves by a transition on transform
    if (inKeyframes(d) && !keyframed.has(keyframesName(d))) {
      keyframed.add(keyframesName(d));
      add(d, 4, `@keyframes ${keyframesName(d)}: no keyframe animation is allowed (brief §8); use a transition on transform`);
    }
    if (/^animation(-iteration-count)?$/.test(prop) && /\binfinite\b/i.test(value)) add(d, 4, `${prop} loops forever; nothing in the chrome loops (brief §8)`);
    else if ((prop === 'animation' || prop === 'animation-name') && !/^none$/i.test(value)) add(d, 4, `${prop}: no CSS animation is allowed (brief §8); use a transition on transform`);
    if (prop === 'transition') for (const m of transitionProblems(value, vars)) add(d, 4, m);
    if (prop === 'transition-property') {
      for (const p of value.split(',').map((s) => s.trim().toLowerCase())) if (p !== 'none' && !MOVE.has(p)) add(d, 4, `transition-property names ${p}; only ${[...MOVE].join(', ')} may move`);
    }
    if (prop === 'transition-duration' || prop === 'animation-duration') for (const m of durationProblems(prop, value, vars)) add(d, 4, m);
    if (prop === 'scroll-behavior' && value === 'smooth') add(d, 4, 'smooth scrolling animates the view');
    if (prop === 'view-transition-name') add(d, 4, 'view transitions are not allowed');
  }
  out.push(...edgeStripeProblems(decls));
  return out;
}

const LEN = /^(-?\d*\.?\d+)(px)?$/i;
const ACCENT = /var\(--(signal|agent|danger|ok|cross)(?![\w])[\w-]*\)/;
const SIDE = /^border-(top|right|bottom|left|block|inline)(-start|-end)?(-width|-color)?$/;
// positions and keyboard focus are not states: drop lines, insert markers, the focus bar
const POSITION_MARKS = /\[data-(insert|drop)|:focus-visible|\.(before|after)\b/;

/**
 * Rule 7: nothing marks a state (selected, active, proposed, failing) with a coloured bar on one
 * edge of a box; the state is a background change. Catches offset-only shadows of 2px or in an
 * accent, one-sided borders of 2px or in an accent, and absolutely placed ::before/::after bars of
 * 2-4px along an edge. Neutral 1px dividers, full rings and position marks pass.
 */
export function edgeStripeProblems(decls) {
  const out = [];
  const add = (d, msg) => out.push({ line: d.line, rule: 7, msg });
  const rules = new Map();
  for (const d of decls) {
    const sel = d.ctx.at(-1) ?? '';
    if (sel.startsWith('@') || d.prop.startsWith('--')) continue;
    if (d.prop === 'box-shadow') for (const layer of splitTop(d.value, ',')) {
      const n = splitTop(layer.replace(/^inset\s+|\s+inset$/i, ''), ' ').filter((x) => LEN.test(x)).map(parseFloat);
      const [x = 0, y = 0, blur = 0, spread = 0] = n;
      if (n.length >= 2 && !blur && !spread && (x === 0) !== (y === 0) && (Math.abs(x || y) >= 2 || ACCENT.test(layer)))
        add(d, `box-shadow ${layer.trim()} draws a stripe on one edge; mark the state with a background change`);
    }
    if (SIDE.test(d.prop)) {
      const w = splitTop(d.value, ' ').find((x) => LEN.test(x));
      if ((w && parseFloat(w) >= 2) || ACCENT.test(d.value)) add(d, `${d.prop}: ${d.value} is a stripe on one edge; mark the state with a background change`);
    }
    const key = d.ctx.join('|');
    (rules.get(key) ?? rules.set(key, []).get(key)).push(d);
  }
  for (const ds of rules.values()) {
    const sel = ds[0].ctx.at(-1) ?? '';
    if (!/::?(before|after)\b/.test(sel) || POSITION_MARKS.test(sel)) continue;
    const get = (p) => ds.find((d) => d.prop === p)?.value;
    if (get('position') !== 'absolute' || !(get('background') ?? get('background-color'))) continue;
    const px = (v) => (v && LEN.test(v) ? parseFloat(v) : null);
    const thin = (v) => px(v) !== null && px(v) >= 2 && px(v) <= 4;
    const both = (a, b) => get(a) !== undefined && get(b) !== undefined;
    const tall = both('top', 'bottom') || /^(100%|calc)/.test(get('height') ?? '');
    const wide = both('left', 'right') || /^(100%|calc)/.test(get('width') ?? '');
    if ((thin(get('width')) && tall) || (thin(get('height')) && wide)) add(ds[0], `${sel} is a bar on one edge; mark the state with a background change`);
  }
  return out;
}

const REDUCED = /prefers-reduced-motion\s*:\s*reduce/i;
const ZERO = /^0(m?s)?$/i;

/** `*, *::before, *::after` in any spelling: pseudo-elements move too (the Toggle knob is an ::after). */
const everything = (sel) => {
  const parts = new Set(sel.split(',').map((s) => s.trim().replace(/^\*(?=:)/, '').replace(/^:+/, '')));
  return ['*', 'before', 'after'].every((p) => parts.has(p));
};

/** True when some stylesheet zeroes every transition and animation under prefers-reduced-motion. */
export function hasReducedMotion(decls) {
  const all = decls.filter((d) => d.ctx.some((c) => REDUCED.test(c)) && everything(d.ctx.at(-1)));
  const zero = (p) => all.some((d) => d.prop === p && ZERO.test(d.value));
  return zero('transition-duration') && (zero('animation-duration') || all.some((d) => d.prop === 'animation' && d.value === 'none'));
}

/** Rule 2: the dark and light token blocks define exactly the same names. */
export function tokenBlockProblems(decls) {
  const names = (theme) => {
    const re = new RegExp(`\\[data-theme=["']?${theme}["']?\\]`);
    return new Map(decls.filter((d) => d.prop.startsWith('--') && re.test(d.ctx.at(-1) ?? '')).map((d) => [d.prop, d.line]));
  };
  const dark = names('dark'), light = names('light');
  const out = [];
  if (!dark.size || !light.size) out.push({ line: 1, rule: 2, msg: `the ${dark.size ? 'light' : 'dark'} [data-theme] block is missing or empty` });
  for (const [a, b, an, bn] of [[dark, light, 'dark', 'light'], [light, dark, 'light', 'dark']]) {
    for (const [name, line] of a) if (!b.has(name)) out.push({ line, rule: 2, msg: `${name} is in the ${an} block but not the ${bn} block` });
  }
  return out;
}
