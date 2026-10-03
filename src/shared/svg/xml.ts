// A small XML reader and writer for SVG markup, without the DOM (shared code runs in node tests too).
// Values stay as written (entities undecoded) so nothing is re-escaped wrongly on the way out, except
// the entities a DOCTYPE declares: old Illustrator "Save As SVG" files put their namespaces there
// (xmlns:i="&ns_ai;"), and the markup must stand on its own once the DOCTYPE is gone.

export type Attr = { name: string; value: string };
export type El = { name: string; attrs: Attr[]; children: XmlNode[] };
export type XmlNode = El | { text: string } | { cdata: string };

export const isEl = (n: XmlNode): n is El => 'name' in n;
export const getAttr = (el: El, name: string): string | null => el.attrs.find((a) => a.name === name)?.value ?? null;

export function setAttr(el: El, name: string, value: string): void {
  const a = el.attrs.find((x) => x.name === name);
  if (a) a.value = value;
  else el.attrs.push({ name, value });
}

/** why parseSvg refused: the markup is damaged, or well-formed but not SVG (tools say it with the file's name) */
export class SvgError extends Error {
  reason: 'damaged' | 'not-svg';
  constructor(reason: 'damaged' | 'not-svg') {
    super(reason === 'damaged' ? "The SVG couldn't be read." : "That isn't an SVG.");
    this.reason = reason;
  }
}

const NAME = /[^\s/>=]+/y;
const ATTR = /\s*([^\s/>=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/y;
const ENTITY = /<!ENTITY\s+([^\s%]+)\s+(?:"([^"]*)"|'([^']*)')\s*>/g;

/** the root <svg> element; throws a plain sentence when the markup isn't well-formed SVG */
export function parseSvg(src: string): El {
  const doc: El = { name: '', attrs: [], children: [] };
  const stack = [doc];
  let entities: Map<string, string> | null = null;
  const expand = (s: string) => (entities && s.includes('&') ? s.replace(/&([^\s&;#]+);/g, (m, n: string) => entities!.get(n) ?? m) : s);
  const upTo = (end: string, from: number) => {
    const at = src.indexOf(end, from);
    if (at < 0) throw new SvgError('damaged');
    return at;
  };

  let i = 0;
  while (i < src.length) {
    const lt = src.indexOf('<', i);
    const top = stack[stack.length - 1];
    if (lt !== i) {
      const text = src.slice(i, lt < 0 ? undefined : lt);
      if (stack.length > 1) top.children.push({ text: expand(text) });
      else if (text.trim()) throw new SvgError('damaged'); // trim() takes a BOM too
      if (lt < 0) break;
      i = lt;
    }
    if (src.startsWith('<!--', i)) i = upTo('-->', i + 4) + 3;
    else if (src.startsWith('<![CDATA[', i)) {
      const end = upTo(']]>', i + 9);
      top.children.push({ cdata: src.slice(i + 9, end) });
      i = end + 3;
    } else if (src.startsWith('<?', i)) i = upTo('?>', i + 2) + 2;
    else if (src.startsWith('<!', i)) {
      // a DOCTYPE, maybe with an internal subset in [ ] holding entity declarations
      const open = src.indexOf('[', i);
      const gt = upTo('>', i);
      const subsetEnd = open >= 0 && open < gt ? upTo(']', open) : -1;
      const end = subsetEnd >= 0 ? upTo('>', subsetEnd) : gt;
      if (subsetEnd >= 0) {
        entities = new Map();
        for (const m of src.slice(open, subsetEnd).matchAll(ENTITY)) entities.set(m[1], m[2] ?? m[3]);
      }
      i = end + 1;
    } else if (src.startsWith('</', i)) {
      const end = upTo('>', i);
      if (stack.length < 2 || src.slice(i + 2, end).trim() !== top.name) throw new SvgError('damaged');
      stack.pop();
      i = end + 1;
    } else {
      NAME.lastIndex = i + 1;
      const name = NAME.exec(src)?.[0];
      if (!name) throw new SvgError('damaged');
      const el: El = { name, attrs: [], children: [] };
      let j = NAME.lastIndex;
      for (let m; (ATTR.lastIndex = j), (m = ATTR.exec(src)); j = ATTR.lastIndex) {
        el.attrs.push({ name: m[1], value: expand(m[2] ?? m[3]) });
      }
      while (/\s/.test(src[j] ?? '')) j++;
      const selfClosing = src.startsWith('/>', j);
      if (!selfClosing && src[j] !== '>') throw new SvgError('damaged');
      if (stack.length === 1 && doc.children.length) throw new SvgError('damaged'); // a second root
      top.children.push(el);
      if (!selfClosing) stack.push(el);
      i = j + (selfClosing ? 2 : 1);
    }
  }
  const root = doc.children[0];
  if (stack.length > 1 || !root || !isEl(root)) throw new SvgError('damaged');
  if (root.name !== 'svg') throw new SvgError('not-svg');
  return root;
}

const escAttr = (v: string) => v.replace(/</g, '&lt;').replace(/"/g, '&quot;');

export function serialize(n: XmlNode): string {
  if ('text' in n) return n.text;
  if ('cdata' in n) return `<![CDATA[${n.cdata}]]>`;
  const attrs = n.attrs.map((a) => ` ${a.name}="${escAttr(a.value)}"`).join('');
  return n.children.length ? `<${n.name}${attrs}>${n.children.map(serialize).join('')}</${n.name}>` : `<${n.name}${attrs}/>`;
}

/** every element under `el` (itself included), parents before children; `inside` names the ancestors */
export function* walk(el: El, inside: string[] = []): Generator<{ el: El; inside: string[] }> {
  yield { el, inside };
  for (const c of el.children) if (isEl(c)) yield* walk(c, [...inside, el.name]);
}

/** the text of a <style> element, text and CDATA alike */
export const textOf = (el: El): string => el.children.map((c) => ('text' in c ? c.text : 'cdata' in c ? c.cdata : '')).join('');
