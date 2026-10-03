// The coverage meters: each plate's mean and peak, and the most ink any one spot of the sheet
// carries (the total a printer limits, 0..1 per ink, so 4 inks run to 4). Pass the plates that
// print: hidden inks don't.

export function stats(plates: Float32Array[]): { mean: number; peak: number }[] {
  return plates.map((plate) => {
    let [sum, peak] = [0, 0];
    for (let p = 0; p < plate.length; p++) {
      sum += plate[p];
      if (plate[p] > peak) peak = plate[p];
    }
    return { mean: plate.length ? sum / plate.length : 0, peak };
  });
}

/**
 * What knocked-out plates print: each ink where no later printing ink covers it, pixel by pixel
 * p·Π(1 − p_later), the model the separation fits (the inks' screens are independent). `prints`
 * says which inks print; a hidden one clears nothing but is measured all the same. The most ink,
 * read in `block` squares as totalInk does, never passes 1.
 */
export function knockedOut(plates: Float32Array[], prints: boolean[], w: number, block = 1): { stats: { mean: number; peak: number }[]; maxInk: number } {
  const n = plates.length;
  const len = plates[0]?.length ?? 0;
  const h = w ? len / w : 0;
  const b = Math.max(1, block);
  const bw = Math.ceil(w / b);
  const blocks = new Float64Array(bw * Math.ceil(h / b));
  const area = new Float64Array(blocks.length);
  const sums = new Float64Array(n);
  const peaks = new Float64Array(n);
  for (let p = 0; p < len; p++) {
    let free = 1;
    let total = 0;
    for (let i = n - 1; i >= 0; i--) {
      const v = plates[i][p] * free;
      sums[i] += v;
      if (v > peaks[i]) peaks[i] = v;
      if (prints[i]) {
        total += v;
        free *= 1 - plates[i][p];
      }
    }
    const at = Math.floor(p / w / b) * bw + Math.floor((p % w) / b);
    blocks[at] += total;
    area[at]++;
  }
  let maxInk = 0;
  for (let k = 0; k < blocks.length; k++) if (area[k]) maxInk = Math.max(maxInk, blocks[k] / area[k]);
  return { stats: Array.from(sums, (s, i) => ({ mean: len ? s / len : 0, peak: peaks[i] })), maxInk };
}

/**
 * `w` wide plates read in `block` × `block` squares (default: pixel by pixel), so plates of
 * different resolutions give one number for the same print.
 */
export function totalInk(plates: Float32Array[], w = 0, block = 1): number {
  const n = plates[0]?.length ?? 0;
  if (block <= 1 || !w) {
    let most = 0;
    for (let p = 0; p < n; p++) {
      let sum = 0;
      for (const plate of plates) sum += plate[p];
      if (sum > most) most = sum;
    }
    return most;
  }
  const h = n / w;
  let most = 0;
  for (let y0 = 0; y0 < h; y0 += block) {
    for (let x0 = 0; x0 < w; x0 += block) {
      const [x1, y1] = [Math.min(w, x0 + block), Math.min(h, y0 + block)];
      let sum = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) for (const plate of plates) sum += plate[y * w + x];
      most = Math.max(most, sum / ((x1 - x0) * (y1 - y0)));
    }
  }
  return most;
}
