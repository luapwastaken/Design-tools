// An image sequence as a source: files opened as the frames of one animation (Dither and Post FX
// take them the same way). The frames are copied into the tool's workspace in name order, and each is
// read again only when asked for, so a long sequence is never in memory whole.
import type { ToolId } from '../../../shared/types.ts';
import { decodeFrames, naturalOrder } from '../../lib/frames.ts';
import { decodeImage } from '../../lib/load.ts';
import { extOf, fetchBlob, putAsset } from './take.ts';

/** a sequence's rate until it is changed: film's */
export const SEQUENCE_FPS = 24;

export type Sequence = { assets: string[]; name: string; w: number; h: number; count: number };

/** files as the frames of one animation, in the order Explorer sorts them by name; rejects with a plain sentence */
export async function putSequence(tool: ToolId, files: File[]): Promise<Sequence> {
  const f = await decodeFrames(files);
  const { name, w, h, count } = f;
  f.close();
  const assets: string[] = [];
  for (const file of naturalOrder(files)) assets.push(await putAsset(tool, file, extOf(file, file.name)));
  return { assets, name, w, h, count };
}

/** frame `i` of a sequence's files, all the size of the first (yours to close) */
export async function sequenceFrame(assets: readonly string[], name: string, w: number, h: number, i: number): Promise<ImageBitmap> {
  const label = `${name} frame ${i + 1}`;
  const b = await decodeImage(await fetchBlob(assets[i], label), label);
  const { width, height } = b;
  if (width === w && height === h) return b;
  b.close();
  throw new Error(`${label} is ${width} × ${height} px, but the first frame is ${w} × ${h} px. Every frame of a sequence has to be the same size.`);
}
