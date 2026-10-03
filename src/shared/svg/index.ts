// SVG helpers the tools share (plan unit S): an SVG's size, fitting it to share a document with
// others, flattening its colours, reading them. String work with a small XML reader, no DOM, so it
// runs in main, the renderer and tests alike. Measuring the artwork needs a renderer:
// renderer/lib/svg-measure.
import { standalone } from './namespace.ts';
import { sizeOf, type ViewBox } from './size.ts';
import { parseSvg, serialize, setAttr } from './xml.ts';

export { namespace } from './namespace.ts';
export { recolour } from './recolour.ts';
export { svgColours } from './colours.ts';
export { parseSize, type SvgSize, type ViewBox } from './size.ts';

export const toDataUrl = (svg: string): string => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

/**
 * The SVG drawn at `width` × `height` px showing exactly `box` of its user space (the whole viewBox
 * by default), stretched if the proportions differ. For drawing through an <img> at a chosen size.
 */
export function framed(svg: string, width: number, height: number, box?: ViewBox): string {
  const root = parseSvg(svg);
  setAttr(root, 'viewBox', (box ?? sizeOf(root).viewBox).join(' '));
  setAttr(root, 'width', String(width));
  setAttr(root, 'height', String(height));
  setAttr(root, 'preserveAspectRatio', 'none');
  return serialize(standalone(root));
}

/**
 * The SVG with its drawing clipped to its viewBox, as a browser shows the file on its own. Placed
 * as a <symbol> or through <use>, what lies past the viewBox would show. `id` names the clip path
 * and must be free in the file.
 */
export function clipToView(svg: string, id: string): string {
  const root = parseSvg(svg);
  const [x, y, w, h] = sizeOf(root).viewBox;
  const box = { name: 'rect', attrs: [{ name: 'x', value: String(x) }, { name: 'y', value: String(y) }, { name: 'width', value: String(w) }, { name: 'height', value: String(h) }], children: [] };
  root.children = [
    { name: 'clipPath', attrs: [{ name: 'id', value: id }], children: [box] },
    { name: 'g', attrs: [{ name: 'clip-path', value: `url(#${id})` }], children: root.children },
  ];
  return serialize(root);
}
