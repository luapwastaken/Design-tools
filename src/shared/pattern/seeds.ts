const rotl = (x: number, r: number) => (x << r) | (x >>> (32 - r));

/**
 * A 0..1 number fixed by (seed, col, row, salt) alone, so a cell keeps its draws when the column
 * count, the gap or any other cell changes (v1 drew from one stream, so every edit reshuffled the
 * whole pattern). Salts keep one cell's draws apart. MurmurHash3's 32-bit mix over the four words.
 */
export function cellRandom(seed: number, col: number, row: number, salt: number): number {
  let h = 0x2545f491;
  for (const word of [seed, col, row, salt]) {
    h ^= Math.imul(rotl(Math.imul(word | 0, 0xcc9e2d51), 15), 0x1b873593);
    h = (Math.imul(rotl(h, 13), 5) + 0xe6546b64) | 0;
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** a string as a 32-bit word (FNV-1a), to key a draw to a shape by its id */
export function hashOf(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return h | 0;
}
