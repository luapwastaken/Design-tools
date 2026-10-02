// dt:// serves Library files and workspace assets to the renderer (spec §6.2), and nothing else:
//   dt://item/<encodeURIComponent(id)>   the item's file
//   dt://thumb/<id>?s=256                a PNG thumbnail for TIFFs (Windows' cache), else the file
//   dt://asset/<tool>/<sha256>.<ext>     a workspace asset
// The query is ignored except `s`, so the renderer can add ?v=<mtime> to bust Chromium's cache.
// Windows makes an uncached thumbnail synchronously on main's UI thread (65-650ms per image, freezing
// IPC and the window), so only formats Chromium can't decode go that way; the renderer shrinks the rest.
import { nativeImage, net, protocol } from 'electron';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname } from 'node:path';
import { Readable } from 'node:stream';
import { pathToFileURL } from 'node:url';
import { isInside } from './fsx.ts';
import { errorText, log } from './log.ts';

/** before app ready */
export function registerDtScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: 'dt', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } },
  ]);
}

export type DtSources = {
  libraryRoot(): string;
  itemPath(id: string): string | null;
  assetPath(tool: string, name: string): string | null;
};

const SHELL_THUMBS = new Set(['tif', 'tiff']);
const VIDEO_TYPES: Record<string, string> = { mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', mkv: 'video/x-matroska' };

/**
 * A byte range of the file, as a <video> asks for it: net.fetch of a file: URL ignores the Range
 * header, and a video that can't be read in ranges can't seek, so Post FX couldn't step its frames.
 * Null for anything but one plain range (the whole file is served instead).
 */
async function ranged(path: string, header: string): Promise<Response | null> {
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (!m[1] && !m[2])) return null;
  const size = (await stat(path)).size;
  const start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2])); // "-500" is the last 500 bytes
  const end = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
  if (start > end) return new Response(null, { status: 416, headers: { 'content-range': `bytes */${size}` } });
  return new Response(Readable.toWeb(createReadStream(path, { start, end })) as ReadableStream, {
    status: 206,
    headers: {
      'content-type': VIDEO_TYPES[extname(path).slice(1).toLowerCase()] ?? 'application/octet-stream',
      'content-length': String(end - start + 1),
      'content-range': `bytes ${start}-${end}/${size}`,
    },
  });
}

export function handleDt(src: DtSources): void {
  const resolve = (url: URL): string | null => {
    const parts = url.pathname.slice(1).split('/').map(decodeURIComponent);
    if ((url.host === 'item' || url.host === 'thumb') && parts.length === 1) {
      const path = src.itemPath(parts[0]);
      return path && isInside(src.libraryRoot(), path) ? path : null;
    }
    if (url.host === 'asset' && parts.length === 2) return src.assetPath(parts[0], parts[1]);
    return null;
  };

  protocol.handle('dt', async (req) => {
    const url = new URL(req.url);
    let path: string | null = null;
    try {
      path = resolve(url);
    } catch {
      // malformed escape in the url
    }
    if (!path) return new Response('Not found', { status: 404 });

    if (url.host === 'thumb' && SHELL_THUMBS.has(extname(path).slice(1).toLowerCase())) {
      const s = Math.min(1024, Math.max(16, Number(url.searchParams.get('s')) || 256));
      try {
        const thumb = await nativeImage.createThumbnailFromPath(path, { width: s, height: s });
        return cors(new Response(new Uint8Array(thumb.toPNG()), { headers: { 'content-type': 'image/png' } }));
      } catch {
        // no shell thumbnail for this file: serve the file itself
      }
    }
    try {
      const range = req.headers.get('range');
      const part = range ? await ranged(path, range) : null;
      if (part) return cors(part);
      return cors(await net.fetch(pathToFileURL(path).toString()));
    } catch (e) {
      log('info', `dt:// could not read ${path}`, errorText(e));
      return new Response('Not found', { status: 404 });
    }
  });
}

/** the renderer (http://localhost in dev, file:// built) reads pixels from these, so they must not taint canvases */
function cors(res: Response): Response {
  const headers = new Headers(res.headers);
  headers.set('access-control-allow-origin', '*');
  headers.set('accept-ranges', 'bytes');
  return new Response(res.body, { status: res.status, headers });
}
