// dt:// serves Library files and workspace assets to the renderer (spec §6.2), and nothing else:
//   dt://item/<encodeURIComponent(id)>   the item's file
//   dt://thumb/<id>?s=256                a PNG thumbnail for TIFFs (Windows' cache), else the file
//   dt://asset/<tool>/<sha256>.<ext>     a workspace asset
// The query is ignored except `s`, so the renderer can add ?v=<mtime> to bust Chromium's cache.
// Windows makes an uncached thumbnail synchronously on main's UI thread (65-650ms per image, freezing
// IPC and the window), so only formats Chromium can't decode go that way; the renderer shrinks the rest.
import { nativeImage, net, protocol } from 'electron';
import { extname } from 'node:path';
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
  return new Response(res.body, { status: res.status, headers });
}
