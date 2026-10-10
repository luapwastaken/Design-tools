// The Layers tab's picture: a box, a ball and a can on a table in front of a wall, drawn from five flats, and
// the three shading shapes the layers are painted through (shadow, light, rim). The light comes from the upper
// left. The shapes are fixed and drawn once as paths; their masks are read into plain arrays once per size, so
// the preview is only compositing. Drawn in a 360 by 270 unit rectangle and scaled to the width asked for.
import { cssColor, type Oklch } from '../../../shared/color/index.ts';

export type PartId = 'box' | 'ball' | 'can' | 'table' | 'wall';
/** the parts as the tab lists them; a pixel's `part` is an index into this */
export const PART_IDS: readonly PartId[] = ['box', 'ball', 'can', 'table', 'wall'];

const W = 360;
const H = 270;

// the masks are drawn white on black (only the red and the alpha are read back)
const WHITE = cssColor([1, 0, 0]);
const BLACK = cssColor([0, 0, 0]);
const EDGE: Oklch = [0.1654, 0.0053, 67.45];

export type StillLife = {
  width: number;
  height: number;
  /** how much of each pixel the shadow, light and rim shapes cover, 0..1 (the shadow includes what the objects cast on the table) */
  shadow: Float32Array;
  light: Float32Array;
  rim: Float32Array;
  /** the part each pixel belongs to (an index into PART_IDS): the flat with the most coverage in it */
  part: Uint8Array;
  /** the flats, back to front, each part in its own colour (a CSS colour) */
  paint(ctx: CanvasRenderingContext2D, colour: (p: PartId) => string): void;
  /** how much of each pixel the parts cover together, edges smooth; read once for a set of parts */
  coverage(parts: PartId[]): Float32Array;
  /** the parts' outlines: dark under a dashed line in `colour` */
  outline(ctx: CanvasRenderingContext2D, parts: PartId[], colour: string): void;
};

const built = new Map<number, StillLife>();

/** the still life `size` pixels wide; built on first use and kept */
export function stillLifeOf(size: number): StillLife {
  let s = built.get(size);
  if (!s) built.set(size, (s = build(size)));
  return s;
}

const rect = (x: number, y: number, w: number, h: number) => {
  const p = new Path2D();
  p.rect(x, y, w, h);
  return p;
};
const ellipse = (x: number, y: number, rx: number, ry: number) => {
  const p = new Path2D();
  p.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  return p;
};
const union = (...ps: Path2D[]) => {
  const p = new Path2D();
  for (const q of ps) p.addPath(q);
  return p;
};

type Shape = { part: PartId; path: Path2D };
type Drawn = (c: CanvasRenderingContext2D) => void;
/** an object: its outline, the shapes of its shadow and light, and what it casts on the table */
type Thing = { part: PartId; path: Path2D; shadow: Drawn; light: Drawn; cast: Path2D };

// white inside `path` where its copy moved by (dx, dy) is not: the side facing away from the move
const crescent = (c: CanvasRenderingContext2D, path: Path2D, dx: number, dy: number) => {
  c.save();
  c.clip(path);
  c.fillStyle = WHITE;
  c.fill(path);
  c.globalCompositeOperation = 'destination-out';
  c.translate(dx, dy);
  c.fill(path);
  c.restore();
};
const inside = (c: CanvasRenderingContext2D, clip: Path2D, path: Path2D) => {
  c.save();
  c.clip(clip);
  c.fillStyle = WHITE;
  c.fill(path);
  c.restore();
};
const cut = (c: CanvasRenderingContext2D, path: Path2D) => {
  c.save();
  c.globalCompositeOperation = 'destination-out';
  c.fill(path);
  c.restore();
};

function build(size: number): StillLife {
  const k = size / W;
  const height = Math.round(H * k);
  const mk = () => {
    const c = document.createElement('canvas');
    c.width = size;
    c.height = height;
    const x = c.getContext('2d', { willReadFrequently: true })!;
    x.scale(k, k);
    return x;
  };

  // the box: a front, a top (lit) and a right side (in shadow)
  const front = rect(40, 128, 80, 82);
  const top = new Path2D('M 40 128 L 120 128 L 146 109.8 L 66 109.8 Z');
  const side = new Path2D('M 120 128 L 146 109.8 L 146 191.8 L 120 210 Z');
  // the can: a body with its lit top ellipse
  const body = union(rect(255, 120, 60, 95), ellipse(285, 215, 30, 9));
  const lid = ellipse(285, 120, 30, 9);
  const ball = ellipse(205, 182, 38, 38);

  // back to front: the objects cut what they cover of the ones behind, in this order
  const things: Thing[] = [
    { part: 'box', path: union(front, top, side), shadow: (c) => inside(c, side, side), light: (c) => inside(c, top, top), cast: new Path2D('M 120 210 L 146 192 L 200 196 L 176 214 Z') },
    { part: 'ball', path: ball, shadow: (c) => crescent(c, ball, -38 * 0.42, -38 * 0.34), light: (c) => crescent(c, ball, 38 * 0.3, 38 * 0.26), cast: ellipse(246, 216, 38, 8) },
    {
      part: 'can',
      path: union(body, lid),
      shadow: (c) => {
        crescent(c, body, -18, 0);
        cut(c, lid);
      },
      light: (c) => {
        inside(c, lid, lid);
        crescent(c, body, 10, 0);
      },
      cast: ellipse(336, 214, 34, 8),
    },
  ];
  // the wall runs behind the table, which is drawn over it; the rectangles run past the edges so no outline lies along one
  const ORDER: Shape[] = [{ part: 'wall', path: rect(-10, -10, W + 20, H + 20) }, { part: 'table', path: rect(-10, 180, W + 20, H) }, ...things.map(({ part, path }) => ({ part, path }))];
  const REGION = Object.fromEntries(ORDER.map((s) => [s.part, s.path])) as Record<PartId, Path2D>;
  REGION.wall = rect(-10, -10, W + 20, 190);

  const paint = (c: CanvasRenderingContext2D, colour: (p: PartId) => string) => {
    for (const s of ORDER) {
      c.fillStyle = colour(s.part);
      c.fill(s.path);
    }
  };
  const read = (c: CanvasRenderingContext2D, channel: 0 | 3 = 3) => {
    const d = c.getImageData(0, 0, size, height).data;
    const a = new Float32Array(size * height);
    for (let p = 0; p < a.length; p++) a[p] = d[p * 4 + channel] / 255;
    return a;
  };
  // a mask of the objects: each one first cuts what it covers of the ones behind, then adds its own shape
  const objects = (draw: (c: CanvasRenderingContext2D, t: Thing) => void) => {
    const c = mk();
    for (const t of things) {
      cut(c, t.path);
      c.save();
      draw(c, t);
      c.restore();
    }
    return c;
  };

  // shadow: each object's far side, and what the objects cast on the table (the objects cut it where they stand)
  const sh = objects((c, t) => t.shadow(c));
  const cast = mk();
  cast.fillStyle = WHITE;
  for (const t of things) cast.fill(t.cast);
  for (const t of things) cut(cast, t.path);
  sh.save();
  sh.setTransform(1, 0, 0, 1, 0, 0);
  sh.drawImage(cast.canvas, 0, 0);
  sh.restore();
  // light: the near, upper-left side of each
  const li = objects((c, t) => t.light(c));
  // rim: a thin sliver along the far edge of each
  const ri = objects((c, t) => crescent(c, t.path, -5, 0));

  // which part each pixel is: the one with the most coverage in it, so smooth edges never turn into a third flat
  const part8 = new Uint8Array(size * height);
  const best = new Float32Array(size * height).fill(-1);
  PART_IDS.forEach((id, n) => {
    const m = mk();
    paint(m, (other) => (other === id ? WHITE : BLACK));
    const d = m.getImageData(0, 0, size, height).data;
    for (let p = 0; p < part8.length; p++) {
      if (d[p * 4] > best[p]) {
        best[p] = d[p * 4];
        part8[p] = n;
      }
    }
  });

  // the flats drawn in order, the chosen ones white and the rest black: edges stay smooth, and a flat's own shape is what it is on screen
  const covers = new Map<string, Float32Array>();
  return {
    width: size,
    height,
    shadow: read(sh),
    light: read(li),
    rim: read(ri),
    part: part8,
    paint: (ctx, colour) => {
      ctx.save();
      ctx.setTransform(k, 0, 0, k, 0, 0);
      paint(ctx, colour);
      ctx.restore();
    },
    coverage(parts) {
      const key = [...parts].sort().join();
      let a = covers.get(key);
      if (!a) {
        const m = mk();
        paint(m, (id) => (parts.includes(id) ? WHITE : BLACK));
        a = read(m, 0);
        covers.set(key, a);
      }
      return a;
    },
    outline(ctx, parts, colour) {
      ctx.save();
      ctx.setTransform(k, 0, 0, k, 0, 0);
      ctx.lineJoin = 'round';
      for (const id of parts) {
        ctx.setLineDash([]);
        ctx.globalAlpha = 0.75;
        ctx.strokeStyle = cssColor(EDGE);
        ctx.lineWidth = 4;
        ctx.stroke(REGION[id]);
        ctx.globalAlpha = 1;
        ctx.setLineDash([6, 4]);
        ctx.strokeStyle = colour;
        ctx.lineWidth = 2;
        ctx.stroke(REGION[id]);
      }
      ctx.restore();
    },
  };
}
