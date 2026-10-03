// The painting as a workspace asset per Library item: loaded when the item changes (or when the
// engine first starts), saved a second after the last change. A document with no item yet keeps
// its painting in memory and saves it under the item its first commit makes, and one that moves to
// another item (a fork, a rename) keeps the painting on screen and saves it there.
import { useEffect, useRef, useState, type RefObject } from 'react';
import { shell } from '../../shell/core/index.ts';
import { toast } from '../../ui/index.ts';
import type { PaintEngine } from './paint/index.ts';

const TOOL = 'illustration';
const SAVE_MS = 1000;
/** a save that comes due mid-stroke waits for the lift */
const RETRY_MS = 300;

type Paintings = {
  /** item id → its painting, a workspace asset url (dt://asset/illustration/<sha256>.png) */
  paintings: Record<string, string>;
  onPaintings(next: Record<string, string>): void;
};

const why = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** every save writes a new file: the ones no palette points at any more go (the service keeps anything
 *  under a minute old, and whatever a quarantined workspace refers to) */
const collect = (paintings: Record<string, string>) => {
  const keep = Object.values(paintings).flatMap((url) => /[0-9a-f]{64}/.exec(url) ?? []);
  void window.api.invoke('workspace.gcAssets', TOOL, keep).catch(() => {});
};

export function usePainting(engine: PaintEngine | null, itemId: string | null, props: RefObject<Paintings>) {
  const eng = useRef(engine);
  eng.current = engine;
  const owner = useRef<string | null | undefined>(undefined);
  /** a relink the shell announced: the item id about to change, and to what */
  const carried = useRef<{ from: string; to: string } | null>(null);
  const unsaved = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  /** saves run one after another, so a quit waits for one already under way and an older one never lands last */
  const saving = useRef<Promise<void>>(Promise.resolve());
  const [loading, setLoading] = useState(false);

  const store = async (id: string, png: Promise<Blob | null>) => {
    let url: string | null = null;
    try {
      const blob = await png;
      if (blob) url = (await window.api.invoke('workspace.putAsset', TOOL, await blob.arrayBuffer(), 'png')).url;
    } catch (e) {
      if (owner.current === id) unsaved.current = true;
      toast.show({ kind: 'error', message: `The painting couldn't be saved: ${why(e)}` });
      return;
    }
    const { paintings, onPaintings } = props.current;
    if (!url && !(id in paintings)) return;
    const { [id]: _, ...rest } = paintings;
    const next = url ? { ...rest, [id]: url } : rest;
    onPaintings(next);
    collect(next);
  };

  const write = (id: string | null): Promise<void> => {
    const e = eng.current;
    if (!id || !e || !unsaved.current) return saving.current;
    unsaved.current = false;
    // taken now: the painting may change (another item) while this waits and encodes
    const png = e.snapshot();
    png.catch(() => {});
    return (saving.current = saving.current.then(() => store(id, png)));
  };

  const trySave = () => {
    if (eng.current?.stroking) timer.current = setTimeout(trySave, RETRY_MS);
    else void write(owner.current ?? null);
  };

  /** the item's painting onto the paper (blank paper when it has none); history starts again */
  const open = async (id: string | null) => {
    const e = eng.current;
    if (!e) return;
    const url = id ? props.current.paintings[id] : undefined;
    setLoading(true);
    try {
      let blob: Blob | null = null;
      if (url) {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`status ${res.status}`);
        blob = await res.blob();
      }
      if (owner.current === id) await e.load(blob);
    } catch (err) {
      if (owner.current === id) {
        toast.show({ kind: 'error', message: `This palette's painting couldn't be read, so the canvas starts blank. (${why(err)})` });
        await e.load(null).catch(() => {});
      }
    } finally {
      if (owner.current === id) setLoading(false);
    }
  };

  useEffect(
    () =>
      shell.onRelink(TOOL, (from, to) => {
        if (owner.current === from) carried.current = { from, to };
      }),
    [],
  );

  useEffect(() => {
    const prev = owner.current;
    if (prev === itemId) return;
    owner.current = itemId;
    clearTimeout(timer.current);
    // the document just got its item, or moved to another (a fork, a rename): the painting on
    // screen is its painting, saved under the new id
    const moved = !!prev && carried.current?.from === prev && carried.current.to === itemId;
    carried.current = null;
    if (moved || (prev === null && itemId && !props.current.paintings[itemId])) {
      if (moved && eng.current && !eng.current.state.blank) unsaved.current = true;
      if (unsaved.current) trySave();
      return;
    }
    void write(prev ?? null);
    void open(itemId);
  }, [itemId]);

  // the engine starts the first time Paint shows, on blank paper: a saved painting goes onto it
  useEffect(() => {
    const id = owner.current ?? null;
    if (engine && id && props.current.paintings[id]) void open(id);
  }, [engine]);

  useEffect(() => {
    collect(props.current.paintings);
    // a quit inside the save's delay keeps the last strokes
    const off = shell.beforeClose(() => {
      clearTimeout(timer.current);
      return write(owner.current ?? null);
    });
    return () => {
      off();
      clearTimeout(timer.current);
      void write(owner.current ?? null);
    };
  }, []);

  return {
    loading,
    /** a stroke, an undo or a clear changed the painting */
    soon() {
      unsaved.current = true;
      clearTimeout(timer.current);
      timer.current = setTimeout(trySave, SAVE_MS);
    },
  };
}
