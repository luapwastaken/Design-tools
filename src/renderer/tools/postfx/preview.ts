// The preview (plan unit V): the source frame on the GPU, the stack run over it (effects/stack.ts,
// the same passes every export runs), and both sides of the divider handed to the canvas as bitmaps.
// Paused, a change of settings reruns the stack on the frame already there; playing, media.ts hands
// each frame as it is presented and the stack runs on it at once. At most one render a display frame.
import type { Texture } from '../../lib/gpu/index.ts';
import { createStore } from '../common/store.ts';
import { timeline, type PostFxDoc, type Source } from './doc.ts';
import { Stack } from './effects/stack.ts';
import { openMedia, type Media, type Shown as Presented } from './media.ts';
import { playhead } from './view-state.ts';

/** what the canvas draws: the frame before and after the stack, at the preview's scale of the source */
export type Shown = { source: string; frame: number; before: ImageBitmap | null; after: ImageBitmap | null; scale: number; ms: number };

export const shown = createStore<Shown | null>(null);

/** a still this big or smaller previews at full resolution; a larger one is scaled to fit (the canvas readout says so) */
const PREVIEW_PX = 4096 * 4096;

export const previewScale = (s: Pick<Source, 'w' | 'h'>, maxSide: number): number => Math.min(1, Math.sqrt(PREVIEW_PX / (s.w * s.h)), maxSide / Math.max(s.w, s.h));

type Want = { d: PostFxDoc; frame: number };

/**
 * One while the tool shows. `show` asks for a frame of a document: the newest ask wins, and a frame
 * being read holds the one on screen. `play` hands the clock to media.ts until `pause`.
 */
export class Preview {
  // made before this preview's own restore listener, so it forgets its textures first (effects/stack.ts)
  readonly #stack = new Stack('postfx preview');
  #src: Texture | null = null;
  #media: { asset: string; media: Promise<Media> } | null = null;
  /** the source frame on the GPU, which it is, and its scale of the source */
  #at: { asset: string; frame: number; scale: number } | null = null;
  #before: ImageBitmap | null = null;
  #want: Want | null = null;
  #raf = 0;
  #reading = 0;
  #stop: (() => void) | null = null;
  #released = false;
  onError: (message: string | null) => void = () => {};
  onBusy: (busy: boolean) => void = () => {};

  constructor() {
    this.#stack.g.onRestore(() => {
      this.#src = null;
      this.#at = null;
      if (this.#want && !this.#stop) this.show(this.#want.d, this.#want.frame);
    });
  }

  #mediaFor(s: Source): Promise<Media> {
    if (this.#media?.asset === s.asset) return this.#media.media;
    this.#closeMedia();
    const media = openMedia(s);
    media.catch(() => {}); // said where it is awaited
    this.#media = { asset: s.asset, media };
    return media;
  }

  #closeMedia() {
    this.#stop?.();
    this.#stop = null;
    void this.#media?.media.then((m) => m.close(), () => {});
    this.#media = null;
  }

  /** frame `frame` of `d`, on the next display frame */
  show(d: PostFxDoc, frame: number): void {
    if (this.#released) return;
    this.#want = { d, frame };
    if (this.#stop) return; // playing: the next presented frame takes the new settings
    if (!this.#raf) this.#raf = requestAnimationFrame(() => void this.#pump());
  }

  async #pump(): Promise<void> {
    this.#raf = 0;
    const want = this.#want;
    const s = want?.d.source;
    if (!want || !s) return;
    // a still's every frame is the still: moving effects change, the source doesn't
    const frame = s.kind === 'image' ? 0 : want.frame;
    if (this.#at?.asset === s.asset && this.#at.frame === frame) return this.#render(want.frame);
    const mine = ++this.#reading;
    this.onBusy(true);
    try {
      const media = await this.#mediaFor(s);
      let img = await media.frame(frame);
      const k = s.kind === 'image' ? previewScale(s, this.#stack.g.maxSize) : 1;
      if (k < 1) {
        const small = await createImageBitmap(img, { resizeWidth: Math.max(1, Math.round(s.w * k)), resizeHeight: Math.max(1, Math.round(s.h * k)), resizeQuality: 'high', premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
        img.close();
        img = small;
      }
      if (mine !== this.#reading || this.#released || this.#stop) return void img.close();
      this.#upload(s, frame, img);
      img.close();
      this.#render(this.#want?.frame ?? want.frame);
    } catch (e) {
      if (mine === this.#reading && !this.#released) this.#fail(e);
    } finally {
      if (mine === this.#reading) this.onBusy(false);
    }
  }

  #upload(s: Source, frame: number, img: Presented) {
    const w = img instanceof HTMLVideoElement ? img.videoWidth : img.width;
    if (this.#src) this.#src.upload(img);
    else this.#src = this.#stack.g.texture(img, 'rgba16f');
    this.#at = { asset: s.asset, frame, scale: w / s.w };
    this.#before?.close();
    this.#before = null;
  }

  /** the stack over the frame on the GPU, as the document asks now; `frame` is the timeline's (a still's loop frame) */
  #render(frame: number) {
    const d = this.#want?.d;
    const s = d?.source;
    if (!d || !s || !this.#src || !this.#at || this.#at.asset !== s.asset) return;
    const t = timeline(d);
    const t0 = performance.now();
    try {
      const out = this.#stack.render(this.#src, d.stack, { t: t.count > 1 ? t.phase(frame) : 0, frame: s.kind === 'video' ? frame : null, scale: this.#at.scale });
      // one pixel read waits for the GPU, so the readout is the render's own time, not only its sending
      this.#stack.g.read(out, { x: 0, y: 0, w: 1, h: 1 });
      const ms = performance.now() - t0;
      this.#before ??= this.#stack.g.bitmap(this.#src);
      const after = this.#stack.g.bitmap(out);
      const prev = shown.get();
      shown.set({ source: s.asset, frame, before: this.#before, after, scale: this.#at.scale, ms });
      if (prev?.after && prev.after !== after) prev.after.close();
      this.onError(null);
    } catch (e) {
      this.#fail(e);
    }
  }

  #fail(e: unknown) {
    this.onError(e instanceof Error ? e.message : String(e));
  }

  /** plays from `from` until pause(): a clip's or a GIF's frames as they come, a still's loop by the clock */
  play(d: PostFxDoc, from: number): void {
    if (this.#released || this.#stop || !d.source) return;
    const s = d.source;
    this.#want = { d, frame: from };
    let stop: (() => void) | null = null;
    let cancelled = false;
    const mine = () => {
      cancelled = true;
      stop?.();
    };
    this.#stop = mine;
    this.#mediaFor(s).then(
      (media) => {
        if (cancelled) return;
        stop = media.play({
          from,
          timing: timeline(d),
          show: (i, img) => {
            // a frame that comes after this play was stopped belongs to no one
            if (this.#stop !== mine) return;
            // a still is on the GPU already (it shows paused before it plays); a GIF's or a clip's every frame comes in
            if (s.kind !== 'image') this.#upload(s, i, img);
            this.#render(i);
            playhead.set({ frame: i, playing: true });
          },
          failed: (e) => {
            if (this.#stop !== mine) return;
            this.pause();
            this.#fail(e);
          },
        });
      },
      (e) => {
        this.pause();
        this.#fail(e);
      },
    );
  }

  pause(): void {
    this.#stop?.();
    this.#stop = null;
    // a clip's frame on the GPU may be past the one the pause holds: read that one again
    if (this.#want?.d.source?.kind !== 'image') this.#at = null;
    const p = playhead.get();
    if (p.playing) playhead.set({ ...p, playing: false });
  }

  get playing(): boolean {
    return !!this.#stop;
  }

  /** a hidden tool frees the GPU, the decoder and the bitmaps (foundation spec §4) */
  release(): void {
    this.#released = true;
    cancelAnimationFrame(this.#raf);
    this.pause();
    this.#closeMedia();
    this.#before?.close();
    const last = shown.get();
    shown.set(null);
    last?.after?.close();
    this.#stack.release();
  }
}
