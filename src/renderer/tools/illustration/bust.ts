// The Layers tab's picture: a cel-shaded bust drawn from five flats (skin, hair, top, under-top and a
// background), and the three shading shapes the layers are painted through (shadow, light, rim). The
// shapes are fixed and drawn once as paths; their masks are read into plain arrays once per size, so the
// preview is only compositing. Drawn in a 520-unit square and scaled to the size asked for.
import { cssColor, type Oklch } from '../../../shared/color/index.ts';

export type PartId = 'skin' | 'hair' | 'top' | 'under' | 'bg';
/** the parts, back to front by their first shape; a pixel's `part` is an index into this */
export const PART_IDS: readonly PartId[] = ['skin', 'hair', 'top', 'under', 'bg'];

const U = 520;

// the masks are drawn white on black (only the red and the alpha are read back); the face is fixed ink
const WHITE = cssColor([1, 0, 0]);
const BLACK = cssColor([0, 0, 0]);
const INK: Oklch = [0.242, 0.0241, 10.18];
const MOUTH: Oklch = [0.5125, 0.1074, 23.02];
const NOSE: Oklch = [0.4044, 0.0821, 36.2];
const EDGE: Oklch = [0.1654, 0.0053, 67.45];

export type Bust = {
  size: number;
  /** how much of each pixel the shadow, light and rim shapes cover, 0..1 */
  shadow: Float32Array;
  light: Float32Array;
  rim: Float32Array;
  /** the part each pixel belongs to (an index into PART_IDS): the flat with the most coverage in it */
  part: Uint8Array;
  /** the flats, back to front, each part in its own colour (a CSS colour), the background filling the square */
  paint(ctx: CanvasRenderingContext2D, colour: (p: PartId) => string): void;
  /** how much of each pixel the parts cover together, edges smooth; read once for a set of parts */
  coverage(parts: PartId[]): Float32Array;
  /** the parts' outlines: dark under a dashed line in `colour` */
  outline(ctx: CanvasRenderingContext2D, parts: PartId[], colour: string): void;
  /** the face, in fixed ink: not part of any recipe */
  face(ctx: CanvasRenderingContext2D): void;
};

const built = new Map<number, Bust>();

/** the bust at `size` pixels square; built on first use and kept */
export function bustOf(size: number): Bust {
  let b = built.get(size);
  if (!b) built.set(size, (b = build(size)));
  return b;
}

function build(size: number): Bust {
  const k = size / U;
  const mk = () => {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const x = c.getContext('2d', { willReadFrequently: true })!;
    x.scale(k, k);
    return { c, x };
  };
  /** a canvas onto another, pixel for pixel (both are already scaled for their own drawing) */
  const blit = (to: CanvasRenderingContext2D, from: HTMLCanvasElement) => {
    to.save();
    to.setTransform(1, 0, 0, 1, 0, 0);
    to.drawImage(from, 0, 0);
    to.restore();
  };

  const P = {
    jacket: new Path2D('M 20 520 C 30 440 80 396 160 380 L 300 380 C 380 396 430 440 440 520 Z'),
    shirt: new Path2D('M 176 372 L 284 372 L 248 520 L 212 520 Z'),
    backHair: new Path2D('M 128 262 C 100 150 150 84 230 82 C 310 84 360 150 332 262 C 330 290 318 302 304 306 L 156 306 C 142 302 130 290 128 262 Z'),
    neck: new Path2D('M 202 290 L 258 290 L 268 372 L 230 424 L 192 372 Z'),
    earL: new Path2D(),
    earR: new Path2D(),
    face: new Path2D('M 152 205 C 152 140 195 120 230 120 C 265 120 308 140 308 205 C 308 255 275 305 230 310 C 185 305 152 255 152 205 Z'),
    fringe: new Path2D('M 150 218 C 138 130 190 98 232 98 C 288 98 326 140 310 218 C 302 184 288 164 266 150 C 236 178 192 196 150 218 Z'),
  };
  P.earL.ellipse(152, 216, 9, 17, 0, 0, Math.PI * 2);
  P.earR.ellipse(308, 216, 9, 17, 0, 0, Math.PI * 2);
  // back to front: [part, shape]
  const ORDER: [PartId, Path2D][] = [['top', P.jacket], ['under', P.shirt], ['hair', P.backHair], ['skin', P.neck], ['skin', P.earL], ['skin', P.earR], ['skin', P.face], ['hair', P.fringe]];
  const SILHOUETTE = [P.jacket, P.backHair, P.neck, P.earL, P.earR, P.face, P.fringe];
  const REGION = {} as Record<PartId, Path2D[]>;
  for (const [id, path] of ORDER) (REGION[id] ||= []).push(path);
  REGION.bg = [new Path2D('M 8 8 H 512 V 512 H 8 Z')];

  const fillAll = (c: CanvasRenderingContext2D, paths: Path2D[]) => {
    for (const p of paths) c.fill(p);
  };
  const paint = (c: CanvasRenderingContext2D, colour: (p: PartId) => string) => {
    c.fillStyle = colour('bg');
    c.fillRect(0, 0, U, U);
    for (const [id, path] of ORDER) {
      c.fillStyle = colour(id);
      c.fill(path);
    }
  };

  // one shape, drawn white on a clear canvas, clipped to a flat and optionally cut by a shifted copy of a shape
  const part = (target: CanvasRenderingContext2D, clipPaths: Path2D[], draw: (c: CanvasRenderingContext2D) => void) => {
    const t = mk();
    const c = t.x;
    c.save();
    const clip = new Path2D();
    for (const p of clipPaths) clip.addPath(p);
    c.clip(clip);
    c.fillStyle = WHITE;
    draw(c);
    // keep only what is not covered by shapes drawn later (the collar shadow stops at the neck, and so on)
    const last = Math.max(...clipPaths.map((p) => ORDER.findIndex((o) => o[1] === p)));
    c.globalCompositeOperation = 'destination-out';
    for (const [, later] of ORDER.slice(last + 1)) c.fill(later);
    c.restore();
    blit(target, t.c);
  };
  const cut = (c: CanvasRenderingContext2D, paths: Path2D[], dx: number, dy: number) => {
    c.save();
    c.globalCompositeOperation = 'destination-out';
    c.translate(dx, dy);
    fillAll(c, paths);
    c.restore();
  };
  const crescent = (target: CanvasRenderingContext2D, clipPaths: Path2D[], dx: number, dy: number) =>
    part(target, clipPaths, (c) => {
      c.fillRect(0, 0, U, U);
      cut(c, clipPaths, dx, dy);
    });
  // the shift is the shape's alone: the shapes drawn later are cut out where they really are
  const shifted = (target: CanvasRenderingContext2D, clipPaths: Path2D[], shapePaths: Path2D[], dx: number, dy: number) =>
    part(target, clipPaths, (c) => {
      c.save();
      c.translate(dx, dy);
      fillAll(c, shapePaths);
      c.restore();
    });
  const read = (canvas: HTMLCanvasElement) => {
    const d = canvas.getContext('2d')!.getImageData(0, 0, size, size).data;
    const a = new Float32Array(size * size);
    for (let p = 0; p < a.length; p++) a[p] = d[p * 4 + 3] / 255;
    return a;
  };

  // shadow: the cast shadow on the wall, then each flat's far side and what lies under things
  const sh = mk();
  const cast = mk();
  cast.x.fillStyle = WHITE;
  cast.x.save();
  cast.x.translate(68, 14);
  fillAll(cast.x, SILHOUETTE);
  cast.x.restore();
  cast.x.globalCompositeOperation = 'destination-out';
  fillAll(cast.x, SILHOUETTE);
  blit(sh.x, cast.c);
  shifted(sh.x, [P.face], [P.fringe], 10, 30); // hair on the forehead
  crescent(sh.x, [P.face], -34, -4); // far side of the face
  crescent(sh.x, [P.backHair], -36, 0); // far side of the hair
  crescent(sh.x, [P.fringe], -26, 0);
  shifted(sh.x, [P.neck], [P.face], 6, 34); // under the chin
  shifted(sh.x, [P.shirt], [P.neck], 0, 40); // under the collar
  shifted(sh.x, [P.jacket], [P.face], 26, 96); // the head's shadow on the shoulder
  part(sh.x, [P.jacket], (c) => c.fill(new Path2D('M 322 380 C 326 430 344 480 354 520 L 520 520 L 520 380 Z')));
  // light: the near, upper-left side of each
  const li = mk();
  crescent(li.x, [P.face], 30, 14);
  crescent(li.x, [P.neck], 22, 0);
  crescent(li.x, [P.jacket], 30, 16);
  crescent(li.x, [P.shirt], 12, 0);
  crescent(li.x, [P.backHair], 26, 10);
  part(li.x, [P.fringe], (c) => {
    c.strokeStyle = WHITE;
    c.lineWidth = 16;
    c.lineCap = 'round';
    c.stroke(new Path2D('M 166 176 C 162 140 190 112 226 108'));
  });
  // rim: a thin sliver along the far edge of the whole figure
  const ri = mk();
  ri.x.fillStyle = WHITE;
  fillAll(ri.x, SILHOUETTE);
  ri.x.globalCompositeOperation = 'destination-out';
  ri.x.save();
  ri.x.translate(-7, 0);
  fillAll(ri.x, SILHOUETTE);
  ri.x.restore();

  // which part each pixel is: the one with the most coverage in it, so smooth edges never turn into a third flat
  const part8 = new Uint8Array(size * size);
  const best = new Float32Array(size * size).fill(-1);
  PART_IDS.forEach((id, n) => {
    const m = mk();
    paint(m.x, (other) => (other === id ? WHITE : BLACK));
    const d = m.x.getImageData(0, 0, size, size).data;
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
    size,
    shadow: read(sh.c),
    light: read(li.c),
    rim: read(ri.c),
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
        paint(m.x, (id) => (parts.includes(id) ? WHITE : BLACK));
        const d = m.x.getImageData(0, 0, size, size).data;
        a = new Float32Array(size * size);
        for (let p = 0; p < a.length; p++) a[p] = d[p * 4] / 255;
        covers.set(key, a);
      }
      return a;
    },
    outline(ctx, parts, colour) {
      ctx.save();
      ctx.setTransform(k, 0, 0, k, 0, 0);
      ctx.beginPath();
      ctx.rect(0, 0, U, U - 5); // the jacket runs off the bottom: no outline along the canvas edge
      ctx.clip();
      ctx.lineJoin = 'round';
      for (const id of parts) {
        const shape = new Path2D();
        for (const p of REGION[id]) shape.addPath(p);
        ctx.setLineDash([]);
        ctx.globalAlpha = 0.75;
        ctx.strokeStyle = cssColor(EDGE);
        ctx.lineWidth = 7;
        ctx.stroke(shape);
        ctx.globalAlpha = 1;
        ctx.setLineDash([9, 6]);
        ctx.strokeStyle = colour;
        ctx.lineWidth = 3;
        ctx.stroke(shape);
      }
      ctx.restore();
    },
    face(ctx) {
      ctx.save();
      ctx.setTransform(k, 0, 0, k, 0, 0);
      ctx.fillStyle = cssColor(INK);
      for (const x of [203, 257]) {
        ctx.beginPath();
        ctx.ellipse(x, 226, 6, 8.5, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.strokeStyle = cssColor(MOUTH);
      ctx.lineWidth = 4;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(214, 274);
      ctx.quadraticCurveTo(230, 285, 246, 274);
      ctx.stroke();
      ctx.globalAlpha = 0.4;
      ctx.strokeStyle = cssColor(NOSE);
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(231, 238);
      ctx.quadraticCurveTo(225, 254, 234, 257);
      ctx.stroke();
      ctx.restore();
    },
  };
}
