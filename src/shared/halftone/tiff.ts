// Separation plates as TIFF: uncompressed, one strip, greyscale 8-bit or bilevel, with the print
// resolution in the file so a RIP or a Riso master places it at size. `grey` is the plate as an
// image: 0 where ink prints (black), 255 where the paper shows. Bilevel prints below 128.

const SHORT = 3;
const LONG = 4;
const RATIONAL = 5;

export function writeTiff(grey: Uint8Array, w: number, h: number, dpi: number, bits: 8 | 1): Uint8Array {
  const rowBytes = bits === 8 ? w : Math.ceil(w / 8);
  const dataBytes = rowBytes * h;
  // dpi as a fraction, to the thousandth
  const [num, den] = Number.isInteger(dpi) ? [dpi, 1] : [Math.round(dpi * 1000), 1000];
  const tags: [number, number, number][] = [
    [256, LONG, w], // ImageWidth
    [257, LONG, h], // ImageLength
    [258, SHORT, bits], // BitsPerSample
    [259, SHORT, 1], // Compression: none
    [262, SHORT, 1], // PhotometricInterpretation: BlackIsZero
    [273, LONG, 0], // StripOffsets, set below
    [277, SHORT, 1], // SamplesPerPixel
    [278, LONG, h], // RowsPerStrip
    [279, LONG, dataBytes], // StripByteCounts
    [282, RATIONAL, 0], // XResolution, set below
    [283, RATIONAL, 0], // YResolution
    [296, SHORT, 2], // ResolutionUnit: inch
  ];
  const ifdAt = 8;
  const rationalAt = ifdAt + 2 + tags.length * 12 + 4;
  const dataAt = rationalAt + 16;
  const out = new Uint8Array(dataAt + dataBytes);
  const view = new DataView(out.buffer);
  view.setUint16(0, 0x4949); // "II", little-endian
  view.setUint16(2, 42, true);
  view.setUint32(4, ifdAt, true);
  view.setUint16(ifdAt, tags.length, true);
  tags.forEach(([tag, type, value], i) => {
    const at = ifdAt + 2 + i * 12;
    view.setUint16(at, tag, true);
    view.setUint16(at + 2, type, true);
    view.setUint32(at + 4, 1, true);
    if (tag === 273) view.setUint32(at + 8, dataAt, true);
    else if (type === RATIONAL) view.setUint32(at + 8, rationalAt + (tag === 283 ? 8 : 0), true);
    else if (type === SHORT) view.setUint16(at + 8, value, true);
    else view.setUint32(at + 8, value, true);
  });
  // the next-IFD offset stays 0: one image
  for (const at of [rationalAt, rationalAt + 8]) {
    view.setUint32(at, num, true);
    view.setUint32(at + 4, den, true);
  }
  if (bits === 8) out.set(grey.subarray(0, w * h), dataAt);
  else {
    // BlackIsZero: a set bit is paper; rows start on a byte
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) if (grey[y * w + x] >= 128) out[dataAt + y * rowBytes + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  return out;
}
