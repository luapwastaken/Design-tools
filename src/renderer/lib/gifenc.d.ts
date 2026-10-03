// gifenc ships no types. Its ESM build is imported by path: Node reads the package's CommonJS main
// without named exports.
declare module 'gifenc/dist/gifenc.esm.js' {
  type Pixels = Uint8Array | Uint8ClampedArray;
  type Format = 'rgb565' | 'rgb444' | 'rgba4444';
  export type Palette = number[][];
  export type FrameOptions = {
    palette?: Palette;
    delay?: number;
    transparent?: boolean;
    transparentIndex?: number;
    repeat?: number;
    colorDepth?: number;
    dispose?: number;
  };
  export function GIFEncoder(opt?: { initialCapacity?: number; auto?: boolean }): {
    writeFrame(index: Uint8Array, width: number, height: number, opts?: FrameOptions): void;
    finish(): void;
    bytes(): Uint8Array;
  };
  export function quantize(rgba: Pixels, maxColors: number, opts?: { format?: Format; oneBitAlpha?: boolean | number; clearAlpha?: boolean }): Palette;
  export function applyPalette(rgba: Pixels, palette: Palette, format?: Format): Uint8Array;
}
