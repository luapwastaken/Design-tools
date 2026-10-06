// What the Export row's Copy button puts on the clipboard (SVG from Pattern and Logo, PNG from the
// image tools) and how a write that is refused falls back. Electron 44's clipboard has one call,
// `clipboard.write([ClipboardItem])`, which commits every format of an item together; a format Windows
// has no standard slot for goes in by its registered name (`electron application/osclipboard`).
//   SVG   `text/plain`: the markup, which Figma and Illustrator (CC 2020 on) paste as vector artwork
//         "image/svg+xml": the registered format Inkscape and Illustrator's own "include SVG code" copy use
//   PNG   "PNG": the registered format, the alpha channel exact (browsers, Illustrator and most editors)
//         `image/png`: the bitmap form, for programs that read only bitmaps; Photoshop takes this one
//         (it reads CF_DIBV5 first, with alpha, but may fringe soft edges)
//   TEXT  `text/plain`: a colour code from the picker's Copy as (the one format every program reads)
// Programs differ in which they take first, so each kind carries both, in one atomic write.

/** what Copy sends main: the SVG's markup, a PNG's bytes, or plain text */
export type Copying = { kind: 'svg'; data: string } | { kind: 'png'; data: ArrayBuffer } | { kind: 'text'; data: string };

/** the formats of one write: a string is written as UTF-8, bytes as they are */
export type Entries = Record<string, string | Uint8Array>;
export type Write = (entries: Entries) => Promise<void>;

/** Electron's key for a raw OS clipboard format, by its registered name */
const osFormat = (name: string) => `electron application/osclipboard;format="${name}"`;
export const SVG_FORMAT = osFormat('image/svg+xml');
export const PNG_FORMAT = osFormat('PNG');

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** The writes to try, best first: every format, then the one any program reads, in case the full set is refused. */
export function entriesFor(what: Copying): Entries[] {
  if (what.kind === 'text') return [{ 'text/plain': String(what.data) }];
  if (what.kind === 'svg') {
    if (typeof what.data !== 'string' || !/<svg[\s>]/i.test(what.data)) throw new Error('That is not SVG markup.');
    return [{ 'text/plain': what.data, [SVG_FORMAT]: what.data }, { 'text/plain': what.data }];
  }
  const png = new Uint8Array(what.data);
  if (png.length < PNG_SIGNATURE.length || PNG_SIGNATURE.some((b, i) => png[i] !== b)) throw new Error('That is not a PNG.');
  return [{ [PNG_FORMAT]: png, 'image/png': png }, { 'image/png': png }];
}

/** Writes with the first set the clipboard takes; `failed` hears each refusal (main logs it). */
export async function copyWith(write: Write, what: Copying, failed?: (e: unknown) => void): Promise<void> {
  for (const entries of entriesFor(what)) {
    try {
      return await write(entries);
    } catch (e) {
      failed?.(e);
    }
  }
  throw new Error("the clipboard wouldn't take it. Details are in the log.");
}
