// A 24-megapixel TIFF takes one to two seconds to decompress: here, so the window keeps painting.
import { readTiff, TiffUnsupported } from './tiff.ts';

export type TiffReply = { bitmap: ImageBitmap } | { error: string; unsupported: boolean };

self.onmessage = async (e: MessageEvent<Blob>) => {
  try {
    const { width, height, data } = readTiff(await e.data.arrayBuffer());
    const bitmap = await createImageBitmap(new ImageData(data, width, height), { premultiplyAlpha: 'none' });
    self.postMessage({ bitmap } satisfies TiffReply, { transfer: [bitmap] });
  } catch (err) {
    self.postMessage({ error: err instanceof Error ? err.message : String(err), unsupported: err instanceof TiffUnsupported } satisfies TiffReply);
  }
};
