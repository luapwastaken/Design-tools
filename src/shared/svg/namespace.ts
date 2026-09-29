// namespace(): an SVG made fit to share one document with others (spec §10.3). Two Illustrator
// exports both say id="Layer_1", url(#linear-gradient) and .cls-1 { fill: … }; side by side the
// second one's rules and gradients win for both. Here every id and class takes the prefix and every
// reference follows. Style rules that name no class or id (`path { … }`) are scoped under the root,
// which carries the bare prefix as a class. Scripts, event handlers and javascript: links go, so the
// result can be inlined in the page. So do <foreignObject>s: one taints any canvas the SVG is drawn
// on, so measuring and PNG export would fail. Illustrator's "preserve editing" files hold one that
// only points at its private copy of the .ai file (<i:pgf>, often most of the file), which goes too.
import { mapRules, prefixUrls, splitList } from './css.ts';
import { getAttr, isEl, parseSvg, serialize, setAttr, textOf, walk, type El } from './xml.ts';

const PREFIX = /^[A-Za-z_][\w-]*$/;
const HREF = /(^|:)href$/;
const DROP = new Set(['script', 'foreignObject', 'i:pgf']);
const TOKEN = /([.#])(-?[_a-zA-Z][\w-]*)/g;

export function namespace(svg: string, prefix: string): string {
  if (!PREFIX.test(prefix)) throw new Error(`"${prefix}" can't start an SVG id.`);
  const root = parseSvg(svg);
  const p = (name: string) => `${prefix}-${name}`;
  for (const { el } of walk(root)) {
    el.children = el.children.filter((c) => !isEl(c) || !DROP.has(c.name));
    el.attrs = el.attrs.filter((a) => !/^on/i.test(a.name) && !(HREF.test(a.name) && /^\s*javascript:/i.test(a.value)));
    for (const a of el.attrs) {
      if (a.name === 'id') a.value = p(a.value);
      else if (a.name === 'class') a.value = a.value.split(/\s+/).filter(Boolean).map(p).join(' ');
      else if (HREF.test(a.name)) a.value = a.value.replace(/^\s*#/, `#${prefix}-`);
      else a.value = prefixUrls(a.value, prefix);
    }
    if (el.name === 'style') {
      const css = mapRules(
        textOf(el).replace(/@import\b[^;]*;?/gi, ''),
        (sel, body) => `${splitList(sel).map((s) => scope(s.trim(), prefix)).join(', ')} {${prefixUrls(body, prefix)}}`,
      );
      el.children = [el.children.some((c) => 'cdata' in c) ? { cdata: css } : { text: css }];
    }
  }
  setAttr(root, 'class', [prefix, getAttr(root, 'class')].filter(Boolean).join(' '));
  return serialize(standalone(root));
}

/** classes and ids take the prefix; a selector that names none only reaches this SVG under its root */
function scope(sel: string, prefix: string): string {
  // attribute selectors are left alone: [href="#a"] is text, not an id
  const out = sel.split(/(\[[^\]]*\])/).map((part, i) => (i % 2 ? part : part.replace(TOKEN, `$1${prefix}-$2`))).join('');
  // :not(.x) still matches every other element in the page, so it doesn't scope
  if (/[.#]-?[_a-zA-Z]/.test(out.replace(/:not\([^)]*\)/g, ''))) return out;
  const root = /^(?:svg|:root)(?![\w-])/.exec(out);
  return root ? `.${prefix}${out.slice(root[0].length)}` : `.${prefix} ${out}`;
}

/** namespace declarations a file needs on its own (a snippet pasted from a web page has none) */
export function standalone(root: El): El {
  if (getAttr(root, 'xmlns') === null) setAttr(root, 'xmlns', 'http://www.w3.org/2000/svg');
  const xlink = [...walk(root)].some(({ el }) => el.attrs.some((a) => a.name.startsWith('xlink:')));
  if (xlink && getAttr(root, 'xmlns:xlink') === null) setAttr(root, 'xmlns:xlink', 'http://www.w3.org/1999/xlink');
  return root;
}
