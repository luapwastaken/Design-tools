// The design brief's hard rules (docs/rewrite/design-brief.md §2) as mechanical checks:
//   1  icons only through <Icon> (Phosphor is imported only in ui/Icon.tsx), non-ASCII in UI strings only from the allowlist, CSS content only ""
//   2  colour literals only in tokens.css (as oklch), both [data-theme] blocks define the same names,
//      and the main-process hex table (THEME_HEX) matches the tokens it stands for
//   4  motion only on transform / translate / scale / rotate / clip-path at 120ms or less, no
//      @keyframes, CSS animation or looping .animate() at all (nothing loops: no spinners), and a
//      reduced-motion rule that zeroes it all
//   6  no OS-drawn popups: title attributes, <select>, number and colour inputs, Menu.popup
// Rules 3 and 5 are behaviour, checked by review and the smoke run. Prints file:line for each
// violation and exits 1 if there are any. `npm run check:rules`; an argument checks another root
// (the test points it at a folder of planted violations).
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { toHex } from '../src/shared/color/index.ts';
import { checkCss, hasReducedMotion, parseCss, tokenBlockProblems } from './rules/css.mjs';
import { checkTs } from './rules/ts.mjs';
import { ALLOWED_CHARS, codePoint, colourFunction } from './rules/values.mjs';

const root = process.argv[2] ? resolve(process.argv[2]) : fileURLToPath(new URL('..', import.meta.url));
const TOKENS = 'src/renderer/styles/tokens.css';
const read = (rel) => readFileSync(join(root, rel), 'utf8');
const walk = (dir) => readdirSync(join(root, dir), { withFileTypes: true })
  .flatMap((e) => (e.isDirectory() ? walk(`${dir}/${e.name}`) : [`${dir}/${e.name}`]));

const violations = [];
const report = (file, list) => violations.push(...list.map((v) => ({ file, ...v })));

// tokens.css: its custom properties resolve var() durations and easings everywhere else
const tokenDecls = parseCss(read(TOKENS));
const vars = Object.fromEntries(tokenDecls.filter((d) => d.prop.startsWith('--')).map((d) => [d.prop, d.value]));
report(TOKENS, tokenBlockProblems(tokenDecls));

const allCss = [];
const themeHex = [];
const files = ['src/renderer', 'src/main', 'src/preload', 'src/shared'].filter((d) => existsSync(join(root, d))).flatMap(walk);
for (const file of files) {
  const text = read(file);
  if (file.endsWith('.css')) {
    const decls = file === TOKENS ? tokenDecls : parseCss(text);
    allCss.push(...decls);
    report(file, checkCss(decls, vars, file === TOKENS));
  } else if (/\.tsx?$/.test(file)) {
    // shared code only feeds UI strings (import reports, grades); its colour strings are the user's data
    const scope = { chars: true, colour: !file.startsWith('src/shared/'), ui: file.startsWith('src/renderer/'), main: file.startsWith('src/main/') };
    const r = checkTs(file, text, scope);
    report(file, r.out);
    themeHex.push(...r.themeHex.map((h) => ({ file, ...h })));
  } else if (file.endsWith('.html')) {
    text.split('\n').forEach((l, i) => {
      const colour = colourFunction(l);
      if (colour) report(file, [{ line: i + 1, rule: 2, msg: `colour literal ${colour} outside tokens.css` }]);
      if (/<select\b|\stitle=/i.test(l)) report(file, [{ line: i + 1, rule: 6, msg: 'title attribute or <select> draws an OS popup' }]);
      for (const ch of new Set(l)) if (ch > '\x7f' && !ALLOWED_CHARS.has(ch)) report(file, [{ line: i + 1, rule: 1, msg: `non-ASCII "${ch}" (${codePoint(ch)})` }]);
    });
  }
}

if (!hasReducedMotion(allCss)) {
  report('src/renderer/styles/base.css', [{ line: 1, rule: 4, msg: 'no prefers-reduced-motion rule sets every transition and animation duration to 0' }]);
}

// Brief §3.4: THEME_HEX holds page, ground and ink-2 of each theme as hex, generated from the tokens.
const TOKEN_OF = { page: '--page', ground: '--ground', ink2: '--ink-2' };
const themeValue = (theme, name) => tokenDecls.find((d) => d.prop === name && d.ctx.at(-1)?.includes(`"${theme}"`))?.value;
for (const h of themeHex) {
  const [theme, key] = h.path.split('.');
  const token = themeValue(theme, TOKEN_OF[key]);
  const nums = token?.match(/^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)$/)?.slice(1).map(Number);
  const want = nums && toHex(nums);
  if (want !== h.value.toLowerCase()) {
    report(h.file, [{ line: h.line, rule: 2, msg: `THEME_HEX.${h.path} is ${h.value} but ${TOKEN_OF[key] ?? key} (${theme}) in tokens.css gives ${want ?? 'no oklch value'}` }]);
  }
}

violations.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
for (const v of violations) console.log(`${v.file}:${v.line}  rule ${v.rule}  ${v.msg}`);
console.log(violations.length ? `\n${violations.length} hard-rule violation(s) (docs/rewrite/design-brief.md §2)` : `check-rules: ${files.length} files, no hard-rule violations`);
process.exitCode = violations.length ? 1 : 0;
