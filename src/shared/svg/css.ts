// The CSS inside an SVG's <style>, walked rule by rule for namespacing and recolouring. Strings,
// parentheses and nested blocks are skipped over, so `content: "}"` can't end a rule early.

/** the first top-level character from `from` that `hit` accepts, or -1 */
function scan(s: string, from: number, hit: (c: string) => boolean): number {
  let quote = '';
  let nest = 0;
  for (let i = from; i < s.length; i++) {
    const c = s[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = '';
    } else if (c === '"' || c === "'") quote = c;
    else if (nest === 0 && hit(c)) return i;
    else if (c === '(' || c === '{') nest++;
    else if (c === ')' || c === '}') nest = Math.max(0, nest - 1);
  }
  return -1;
}

/** a selector list split into its selectors */
export function splitList(s: string): string[] {
  const out: string[] = [];
  for (let i = 0; ; ) {
    const at = scan(s, i, (c) => c === ',');
    out.push(s.slice(i, at < 0 ? undefined : at));
    if (at < 0) return out;
    i = at + 1;
  }
}

/**
 * The CSS rebuilt with every style rule replaced by what `rule` makes of its selector and body.
 * Rules inside @media, @supports, @container and @layer blocks count too; other at-rules
 * (@font-face, @keyframes) are kept as written. Comments go.
 */
export function mapRules(css: string, rule: (selector: string, body: string) => string): string {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, '');
  let out = '';
  for (let i = 0; i < src.length; ) {
    const stop = scan(src, i, (c) => c === '{' || c === ';');
    if (stop < 0) return out + src.slice(i);
    if (src[stop] === ';') {
      out += src.slice(i, stop + 1); // a statement: @charset, @namespace
      i = stop + 1;
      continue;
    }
    const end = scan(src, stop + 1, (c) => c === '}');
    const close = end < 0 ? src.length : end;
    const prelude = src.slice(i, stop);
    const head = prelude.trim();
    const body = src.slice(stop + 1, close);
    if (head.startsWith('@')) {
      out += `${prelude}{${/^@(media|supports|container|layer)\b/i.test(head) ? mapRules(body, rule) : body}}`;
    } else out += prelude.slice(0, prelude.indexOf(head)) + rule(head, body);
    i = close + 1;
  }
  return out;
}

/** `url(#id)` references moved to `#prefix-id` */
export const prefixUrls = (s: string, prefix: string): string => s.replace(/url\(\s*(['"]?)#/g, `url($1#${prefix}-`);
