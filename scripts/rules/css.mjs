// CSS checks: `content:`, colour literals, motion and the token blocks (brief §2 rules 1, 2, 4).
import { MOVE, cssColour, durationProblems, transitionProblems } from './values.mjs';

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
