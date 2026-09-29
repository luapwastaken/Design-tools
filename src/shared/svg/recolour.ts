// recolour(): every painted fill and stroke flattened to one colour ("Colour from palette"). What
// doesn't paint stays as it is, so fill="none" outlines stay outlines. Masks and clip paths keep
// their own paint: a mask's colour is how much shows through, not what shows.
import { mapRules, splitList } from './css.ts';
import { getAttr, isEl, parseSvg, serialize, setAttr, textOf, walk, type El } from './xml.ts';

const KEEP = /^(none|transparent|inherit|unset|context-fill|context-stroke)?$/i;
const DECL = /(^|[;{\s])(fill|stroke)(\s*:)([^;}!]*)/gi;
const TOKEN = /[.#]-?[_a-zA-Z][\w-]*/g;
const OWN_PAINT = new Set(['mask', 'clipPath']);
/** what a mask inherits when nothing above it says: the SVG defaults */
const DEFAULT = { fill: 'black', stroke: 'none' } as const;

/** `css` is any CSS paint: a colour, or currentColor to take each <use>'s `color` */
export function recolour(svg: string, css: string): string {
  const root = parseSvg(svg);
  const paint = (v: string) => (KEEP.test(v.trim()) ? v : v.replace(v.trim(), () => css));
  const decls = (s: string) => s.replace(DECL, (_, a: string, prop: string, colon: string, v: string) => a + prop + colon + paint(v));

  // style rules that only reach mask and clip-path content are left as they are
  const masked = new Set<string>();
  const shown = new Set<string>();
  for (const { el, inside } of walk(root)) {
    const set = OWN_PAINT.has(el.name) || inside.some((n) => OWN_PAINT.has(n)) ? masked : shown;
    for (const c of (getAttr(el, 'class') ?? '').split(/\s+/)) if (c) set.add(`.${c}`);
    const id = getAttr(el, 'id');
    if (id) set.add(`#${id}`);
  }
  const onlyMasked = (sel: string) => (sel.match(TOKEN) ?? []).some((t) => masked.has(t) && !shown.has(t));

  const visit = (el: El, above: Record<'fill' | 'stroke', string>) => {
    const own = { fill: getAttr(el, 'fill') ?? above.fill, stroke: getAttr(el, 'stroke') ?? above.stroke };
    if (OWN_PAINT.has(el.name)) {
      // its content inherits from here, so pin what it inherited before the rest changed
      for (const k of ['fill', 'stroke'] as const) if (getAttr(el, k) === null) setAttr(el, k, above[k]);
      return;
    }
    for (const a of el.attrs) {
      if (a.name === 'fill' || a.name === 'stroke') a.value = paint(a.value);
      else if (a.name === 'style') a.value = decls(a.value);
    }
    if (el.name === 'style') {
      const css = mapRules(textOf(el), (sel, body) => {
        const list = splitList(sel).map((s) => s.trim());
        const keep = list.filter(onlyMasked);
        const change = list.filter((s) => !onlyMasked(s));
        return [change.length && `${change.join(', ')} {${decls(body)}}`, keep.length && `${keep.join(', ')} {${body}}`].filter(Boolean).join('\n');
      });
      el.children = [el.children.some((c) => 'cdata' in c) ? { cdata: css } : { text: css }];
    }
    for (const c of el.children) if (isEl(c)) visit(c, own);
  };
  visit(root, DEFAULT);
  // shapes that name no fill draw black; the root passes the colour down to them
  if (getAttr(root, 'fill') === null) setAttr(root, 'fill', css);
  return serialize(root);
}
