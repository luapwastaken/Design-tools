// TIFF reading (Halftone spec §3): utif2 finds the pages and decompresses them (LZW, deflate,
// PackBits, JPEG, predictors, big-endian 16-bit turned little-endian), and the samples are read here,
// because its own toRGBA8 drops grey alpha and takes any fourth channel for alpha. It still covers
// what this doesn't (palette, CMYK, 1-bit, float).
import UTIF, { type IFD } from 'utif2';

export type Rgba = { width: number; height: number; data: Uint8ClampedArray<ArrayBuffer> };

/** a TIFF this can't read, with the rest of a plain sentence after the file's name */
export class TiffUnsupported extends Error {}

const tag = (ifd: IFD, n: number): number[] | undefined => ifd[`t${n}`] as number[] | undefined;
const area = (ifd: IFD) => (tag(ifd, 256)?.[0] ?? 0) * (tag(ifd, 257)?.[0] ?? 0);

/** The largest page (a file may lead with a reduced thumbnail) as straight RGBA at full resolution. Throws on anything unreadable. */
export function readTiff(buf: ArrayBuffer): Rgba {
  const ifds = UTIF.decode(buf);
  const ifd = ifds.filter((i) => area(i) > 0).sort((a, b) => area(b) - area(a))[0];
  if (!ifd) throw new Error('no image in the TIFF');
  // channels stored one after another: utif2 would read garbage
  if (tag(ifd, 284)?.[0] === 2 && (tag(ifd, 277)?.[0] ?? 1) > 1) throw new TiffUnsupported('keeps its colour channels apart (Pixel order: Per channel). Save it again with Interleaved.');
  UTIF.decodeImage(buf, ifd);
  const { width, height } = ifd;
  if (!ifd.data || !width || !height) throw new Error('no pixels in the TIFF');
  const data = new Uint8ClampedArray(width * height * 4);
  if (!samples(ifd, data)) data.set(UTIF.toRGBA8(ifd).subarray(0, data.length));
  return { width, height, data };
}

/** grey or RGB, 8 or 16 bits, interleaved, with or without alpha; false leaves the rest to utif2 */
function samples(ifd: IFD, out: Uint8ClampedArray): boolean {
  const photometric = tag(ifd, 262)?.[0] ?? 1;
  const bits = tag(ifd, 258)?.[0] ?? 1;
  const format = tag(ifd, 339)?.[0] ?? 1;
  if (photometric > 2 || (bits !== 8 && bits !== 16) || format !== 1) return false;
  const colours = photometric === 2 ? 3 : 1;
  const spp = tag(ifd, 277)?.[0] ?? colours;
  const extra = tag(ifd, 338)?.[0];
  // ExtraSamples 0 is some other channel (a saved selection), not transparency; no tag at all is taken as alpha, as other readers do
  const alpha = spp > colours && extra !== 0 ? colours : -1;
  const premultiplied = alpha >= 0 && extra === 1;
  const invert = photometric === 0;
  const d = ifd.data;
  // utif2 leaves 16-bit samples little-endian; the top byte, rounded, is the 8-bit value
  const at = bits === 8 ? (i: number) => d[i] : (i: number) => Math.min(255, ((d[2 * i + 1] << 8) | d[2 * i]) / 257 + 0.5) | 0;
  const n = out.length / 4;
  for (let p = 0, s = 0; p < n; p++, s += spp) {
    const a = alpha >= 0 ? at(s + alpha) : 255;
    const k = premultiplied && a > 0 ? 255 / a : 1;
    for (let c = 0; c < 3; c++) {
      const v = at(s + (colours === 3 ? c : 0));
      out[4 * p + c] = (invert ? 255 - v : v) * k;
    }
    out[4 * p + 3] = a;
  }
  return true;
}
