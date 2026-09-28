import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp, open, readdir, readFile, rename, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { safeName, uniqueName } from '../src/main/library/names.ts';
import { type IdCache, scanLibrary } from '../src/main/library/scan.ts';
import { LibraryService } from '../src/main/library/service.ts';
import type { LibraryIndex, LoadedItem, PalettePayload } from '../src/shared/types.ts';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function until(ok: () => boolean, ms = 3000): Promise<void> {
  for (const end = Date.now() + ms; !ok(); await sleep(20)) if (Date.now() > end) throw new Error('timed out');
}

const palette = (id: string, notes = ''): PalettePayload => ({
  kind: 'palette',
  id,
  version: 1,
  swatches: [{ id: 's1', name: 'Ink', role: null, oklch: [0.3, 0.05, 250], type: 'process' }],
  notes,
});

function paletteOf(item: LoadedItem): PalettePayload {
  if (item.kind !== 'palette') throw new Error(`expected a palette, got ${item.kind}`);
  return item.payload;
}

const ids = (index: LibraryIndex) => index.collections.flatMap((c) => c.items.map((i) => i.id));
const json = (v: unknown) => JSON.stringify(v);

let root = '';
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'dt-library-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true, maxRetries: 10 });
});

function harness(dir = root, trashItem = async (path: string) => rm(path)) {
  const changes: LibraryIndex[] = [];
  const trashed: string[] = [];
  const logged: string[] = [];
  const lib = new LibraryService(
    dir,
    { trashItem: async (p) => (trashed.push(p), trashItem(p)), now: Date.now, log: (m, d) => logged.push(`${m}\n${d}`), rootPollMs: 40 },
    (index) => changes.push(index),
  );
  return { lib, changes, trashed, logged };
}

describe('names', () => {
  test('forbidden characters become "-"', () => {
    assert.equal(safeName('a<b>c:d"e/f\\g|h?i*j'), 'a-b-c-d-e-f-g-h-i-j');
    assert.equal(safeName('tab\there'), 'tab-here');
  });

  test('trailing dots and spaces go, and leading dots (the scan hides dotfiles)', () => {
    assert.equal(safeName('Notes. . '), 'Notes');
    assert.equal(safeName('..hidden'), 'hidden');
    assert.equal(safeName(' keeps a leading space'), ' keeps a leading space');
  });

  test('reserved device names get a suffix', () => {
    assert.equal(safeName('CON'), 'CON_');
    assert.equal(safeName('nul'), 'nul_');
    assert.equal(safeName('lpt9'), 'lpt9_');
    assert.equal(safeName('com1.txt'), 'com1_.txt');
    assert.equal(safeName('Console'), 'Console');
    assert.equal(safeName('Aux cable'), 'Aux cable');
  });

  test('empty becomes Untitled', () => {
    assert.equal(safeName(''), 'Untitled');
    assert.equal(safeName('   '), 'Untitled');
    assert.equal(safeName('...'), 'Untitled');
  });

  test('names are at most 120 characters, and a whole path stays under 260', async () => {
    assert.equal(safeName('L'.repeat(240)), 'L'.repeat(120));
    assert.equal(safeName(`${'a'.repeat(119)}. b`), 'a'.repeat(119), 'no trailing dot or space after the cut');
    assert.equal(safeName('\u{1F600}'.repeat(70)).length, 120, 'never half a character');
    const deep = join(root, 'd'.repeat(150));
    const name = await uniqueName(deep, 'L'.repeat(120), '.palette.json');
    assert.ok(join(deep, `${name} 99.palette.json`).length <= 259, `${join(deep, name).length}`);
  });

  test('uniqueName ignores case and counts up', async () => {
    await writeFile(join(root, 'Blue.palette.json'), '{}');
    await writeFile(join(root, 'blue 2.PALETTE.JSON'), '{}');
    assert.equal(await uniqueName(root, 'BLUE', '.palette.json'), 'BLUE 3');
    assert.equal(await uniqueName(root, 'Blue', '.logo.json'), 'Blue');
    assert.equal(await uniqueName(join(root, 'nope'), 'Blue', '.palette.json'), 'Blue');
  });
});

describe('scan', () => {
  // a fixed whole-second mtime, so a rewrite can put the exact stamp back
  const mtime = new Date('2026-01-02T03:04:05Z');

  async function tree() {
    const put = async (rel: string, text = '') => {
      await mkdir(join(root, rel, '..'), { recursive: true });
      await writeFile(join(root, rel), text);
      await utimes(join(root, rel), mtime, mtime);
    };
    await put('loose.png');
    await put('notes.txt');
    await put('Monolith/.collection.json', '{ "locked": true }');
    await put('Monolith/Core.palette.json', '{"kind":"palette","id":"p-core"}');
    await put('Monolith/Mark.logo.json', '{"kind":"logo","id":"l-mark"}');
    await put('Monolith/Stars.pattern.json', '{"kind":"pattern"}');
    await put('Monolith/bracket.svg', '<svg/>');
    await put('Monolith/Etch scan 04.TIF');
    await put('Monolith/chalk.ase');
    await put('Monolith/readme.txt');
    await put('Monolith/Old/deep.png');
    await put('Monolith/desktop.ini');
    await put('Monolith/.Core.palette.json.1a2b3c4d.tmp');
    await put('Scratch/.collection.json', '{ "locked": true }');
    await put('Scratch/sunset.gpl');
    await put('Scratch/Sunset.palette.json', '{"kind":"palette","id":"p-sunset"}');
    await put('.git/config');
  }

  test('collections, kinds, ids, locks, not imported and ignored', async () => {
    await tree();
    const index = await scanLibrary(root, new Map());
    assert.equal(index.ok, true);
    assert.deepEqual(index.collections.map((c) => c.name), ['', 'Monolith', 'Scratch']);

    const [top, mono, scratch] = index.collections;
    assert.deepEqual(top.items.map((i) => [i.id, i.kind, i.name, i.ext]), [['path:loose.png', 'image', 'loose', 'png']]);
    assert.equal(top.ignored, 1);

    assert.equal(mono.locked, true);
    assert.deepEqual(
      mono.items.map((i) => [i.name, i.kind, i.id, i.locked]),
      [
        ['bracket', 'svg', 'path:Monolith/bracket.svg', true],
        ['Core', 'palette', 'p-core', true],
        ['Etch scan 04', 'image', 'path:Monolith/Etch scan 04.TIF', true],
        ['Mark', 'logo', 'l-mark', true],
        ['Stars', 'pattern', 'path:Monolith/Stars.pattern.json', true],
      ],
    );
    assert.equal(mono.items[2].ext, 'tif');
    assert.deepEqual(mono.notImported.map((f) => f.name), ['chalk.ase']);
    assert.equal(mono.ignored, 2, 'readme.txt and the Old folder; not its contents, desktop.ini or temp files');

    assert.equal(scratch.locked, false, 'Scratch is never locked');
    assert.deepEqual(scratch.notImported, [], 'sunset.gpl already has its palette');
  });

  test('doc ids are read once per stamp', async () => {
    await tree();
    const cache: IdCache = new Map();
    await scanLibrary(root, cache);
    const core = join(root, 'Monolith', 'Core.palette.json');
    await writeFile(core, '{"kind":"palette","id":"p-ZZZZ"}'); // same size
    await utimes(core, mtime, mtime);
    const again = await scanLibrary(root, cache);
    assert.ok(ids(again).includes('p-core'), 'unchanged stamp: not read again');
    assert.ok(ids(await scanLibrary(root, new Map())).includes('p-ZZZZ'));
  });

  test('a copied file keeps its twin from sharing an id', async () => {
    await tree();
    await copyFile(join(root, 'Monolith', 'Core.palette.json'), join(root, 'Monolith', 'Core - Copy.palette.json'));
    const mono = (await scanLibrary(root, new Map())).collections[1];
    assert.deepEqual(
      mono.items.filter((i) => i.kind === 'palette').map((i) => i.id),
      ['p-core', 'path:Monolith/Core - Copy.palette.json'],
    );
  });

  test('a contested id stays with the file that held it, else the older file, wherever the copy sorts', async () => {
    await tree();
    const original = join(root, 'Monolith', 'Core.palette.json');
    const copy = join(root, 'Archive', 'Core.palette.json'); // Archive sorts before Monolith
    await sleep(20);
    await mkdir(join(root, 'Archive'));
    await copyFile(original, copy); // a copy is born now, and keeps the original's mtime and size
    const where = (index: LibraryIndex) => index.collections.flatMap((c) => c.items).find((i) => i.id === 'p-core')?.path;

    assert.equal(where(await scanLibrary(root, new Map())), original, 'first scan: the older file');
    assert.equal(where(await scanLibrary(root, new Map(), { holders: new Map([['p-core', copy]]) })), copy, 'the last holder');
  });

  test('"path:" ids are never read from a file', async () => {
    await mkdir(join(root, 'Scratch'));
    await writeFile(join(root, 'Scratch', 'Old.palette.json'), '{"kind":"palette"}');
    await writeFile(join(root, 'Scratch', 'New.palette.json'), '{"kind":"palette","id":"path:Scratch/Old.palette.json"}');
    assert.deepEqual(ids(await scanLibrary(root, new Map())), ['path:Scratch/New.palette.json', 'path:Scratch/Old.palette.json']);
  });

  test('a missing root says so', async () => {
    const index = await scanLibrary(join(root, 'nope'), new Map());
    assert.equal(index.ok, false);
    assert.match(index.error ?? '', /missing/);
  });
});

describe('LibraryService', () => {
  test('create, read and write round trip', async () => {
    const { lib } = harness();
    const a = await lib.create('Scratch', 'Untitled palette', palette('p1'));
    assert.deepEqual([a.ref.id, a.ref.name, a.ref.collection, a.ref.kind], ['p1', 'Untitled palette', 'Scratch', 'palette']);
    assert.deepEqual(paletteOf(await lib.read('p1')), palette('p1'));

    const b = await lib.create('Scratch', 'untitled PALETTE', palette('p1'));
    assert.equal(b.ref.name, 'untitled PALETTE 2', 'names collide without regard to case');
    assert.notEqual(b.ref.id, 'p1', 'a taken id is replaced');

    const w = await lib.write('p1', palette('p1', 'edited'), a.stamp);
    assert.ok(w.ok);
    assert.equal(paletteOf(await lib.read('p1')).notes, 'edited');
    assert.deepEqual(await lib.stat('p1'), w.stamp);
    assert.deepEqual(
      (await readdir(join(root, 'Scratch'))).sort(),
      ['Untitled palette.palette.json', 'untitled PALETTE 2.palette.json'].sort(),
      'no temp files left behind',
    );
  });

  test('write refuses when changed outside or missing, and writes nothing', async () => {
    const { lib } = harness();
    const { ref, stamp } = await lib.create('Scratch', 'P', palette('p1'));
    await writeFile(ref.path, json(palette('p1', 'from elsewhere')));

    const r = await lib.write('p1', palette('p1', 'mine'), stamp);
    assert.ok(!r.ok && r.reason === 'changed-outside' && r.stamp);
    assert.match(await readFile(ref.path, 'utf8'), /from elsewhere/);

    await rm(ref.path);
    assert.deepEqual(await lib.write('p1', palette('p1'), r.stamp), { ok: false, reason: 'missing' });
    assert.deepEqual(await lib.write('nope', palette('nope'), null), { ok: false, reason: 'missing' });
  });

  test('its own writes do not trigger rescans; outside edits do', async () => {
    const { lib, changes } = harness();
    await lib.start();
    try {
      const { ref, stamp } = await lib.create('Scratch', 'P', palette('p1'));
      await sleep(600); // the create's change and any watcher echo
      changes.length = 0;
      let rescans = 0;
      const refresh = lib['refresh'].bind(lib);
      lib['refresh'] = (collections?: string[]) => (rescans++, refresh(collections));

      let last = stamp;
      for (const notes of ['a', 'bb', 'ccc', 'dddd', 'eeeee']) {
        const w = await lib.write('p1', palette('p1', notes), last);
        if (!w.ok) throw new Error(`write failed: ${w.reason}`);
        last = w.stamp;
      }
      await sleep(700);
      assert.equal(rescans, 0, 'every watcher event of our own writes is recognised');
      assert.equal(changes.length, 0);

      await writeFile(ref.path, json(palette('p1', 'edited in another program')));
      await until(() => changes.length > 0);
      assert.ok(rescans > 0);
      const item = changes.at(-1)!.collections.flatMap((c) => c.items).find((i) => i.id === 'p1')!;
      assert.notDeepEqual({ mtimeMs: item.mtimeMs, size: item.size }, last);
    } finally {
      lib.stop();
    }
  });

  test('the watcher sees files added in Explorer', async () => {
    const { lib, changes } = harness();
    await lib.start();
    try {
      await mkdir(join(root, 'Dropped'));
      await writeFile(join(root, 'Dropped', 'shot.png'), 'png');
      await until(() => ids(changes.at(-1) ?? { root, ok: true, collections: [] }).includes('path:Dropped/shot.png'));
    } finally {
      lib.stop();
    }
  });

  test('hide, unhide and trash', async () => {
    const { lib, trashed } = harness();
    const { ref } = await lib.create('Scratch', 'P', palette('p1'));
    await lib.hide('p1');
    assert.ok(!ids(await lib.index()).includes('p1'));
    await lib.unhide('p1');
    assert.ok(ids(await lib.index()).includes('p1'));

    await lib.hide('p1');
    await lib.trash('p1');
    assert.deepEqual(trashed, [ref.path]);
    assert.equal(existsSync(ref.path), false);
    assert.ok(!ids(await lib.index()).includes('p1'));
    assert.equal(lib.pathOf('p1'), null);
  });

  test('a trash the Recycle Bin refuses brings the item back', async () => {
    const { lib } = harness(root, async () => {
      throw new Error('in use');
    });
    await lib.create('Scratch', 'P', palette('p1'));
    await lib.hide('p1');
    await assert.rejects(lib.trash('p1'), /in use/);
    assert.ok(ids(await lib.index()).includes('p1'));
  });

  test('rename and move keep doc ids; image ids follow the path', async () => {
    const { lib } = harness();
    await lib.create('Scratch', 'P', palette('p1'));
    await lib.create('Scratch', 'Q', palette('q1'));

    const renamed = await lib.rename('p1', 'q');
    assert.deepEqual([renamed.id, renamed.name], ['p1', 'q 2']);
    const cased = await lib.rename('p1', 'Q 2');
    assert.deepEqual([cased.id, cased.name], ['p1', 'Q 2'], 'a change of case only');
    assert.ok((await readdir(join(root, 'Scratch'))).includes('Q 2.palette.json'));

    await lib.collectionCreate('Monolith');
    const moved = await lib.move('p1', 'Monolith');
    assert.deepEqual([moved.id, moved.collection, moved.name], ['p1', 'Monolith', 'Q 2']);
    assert.equal(lib.pathOf('p1'), join(root, 'Monolith', 'Q 2.palette.json'));
    assert.equal(paletteOf(await lib.read('p1')).id, 'p1');

    const img = await lib.createImage('Scratch', 'shot', 'png', new Uint8Array([1, 2, 3]).buffer);
    assert.equal(img.id, 'path:Scratch/shot.png');
    const img2 = await lib.rename(img.id, 'still');
    assert.equal(img2.id, 'path:Scratch/still.png');
    const img3 = await lib.move(img.id, 'Monolith');
    assert.equal(img3.id, 'path:Monolith/still.png', 'the old id still reaches the item');
    assert.equal(lib.pathOf(img.id), img3.path);
  });

  test('a pending delete survives a collection rename', async () => {
    const { lib, trashed } = harness();
    await lib.collectionCreate('Shots');
    const img = await lib.createImage('Shots', 'shot', 'png', new Uint8Array([1]).buffer);
    await lib.hide(img.id);
    await lib.collectionRename('Shots', 'Stills');
    assert.deepEqual(ids(await lib.index()), [], 'still hidden under its new path');
    await lib.trash(img.id);
    assert.deepEqual(trashed, [join(root, 'Stills', 'shot.png')]);
  });

  test('a doc with no id gets one on its first write, and its copies are told apart', async () => {
    const { lib } = harness();
    await mkdir(join(root, 'Scratch'));
    const path = join(root, 'Scratch', 'Hand.palette.json');
    await writeFile(path, json({ kind: 'palette', version: 1, swatches: [], notes: '' }));
    const [item] = (await lib.index()).collections.flatMap((c) => c.items);
    assert.equal(item.id, 'path:Scratch/Hand.palette.json');

    const w = await lib.write(item.id, palette(item.id, 'saved'), await lib.stat(item.id));
    if (!w.ok) throw new Error(`write failed: ${w.reason}`);
    assert.doesNotMatch(w.ref.id, /^path:/);
    assert.equal(JSON.parse(await readFile(path, 'utf8')).id, w.ref.id);
    assert.deepEqual(ids(await lib.index()), [w.ref.id]);
    assert.ok((await lib.write(item.id, palette(item.id, 'again'), w.stamp)).ok, 'the old id still reaches it');

    await copyFile(path, join(root, 'Scratch', 'Hand - Copy.palette.json'));
    await lib.rescanAll();
    assert.deepEqual(ids(await lib.index()), [w.ref.id, 'path:Scratch/Hand - Copy.palette.json']);
  });

  test("a copy made in Explorer never takes the original's id, wherever it lands", async () => {
    const { lib, changes } = harness();
    await lib.start();
    try {
      await lib.collectionCreate('Monolith');
      const { ref, stamp } = await lib.create('Monolith', 'Core', palette('p-core'));
      await mkdir(join(root, 'Archive')); // sorts before Monolith
      await copyFile(ref.path, join(root, 'Archive', 'Core.palette.json'));
      await copyFile(ref.path, join(root, 'Core.palette.json')); // the Library root comes first of all
      await until(() => ids(changes.at(-1) ?? { root, ok: true, collections: [] }).includes('path:Core.palette.json'));
      await lib.rescanAll(); // window focus
      assert.equal(lib.pathOf('p-core'), ref.path);

      const w = await lib.write('p-core', palette('p-core', 'mine'), stamp);
      assert.ok(w.ok && w.ref.path === ref.path);
      assert.equal(JSON.parse(await readFile(ref.path, 'utf8')).notes, 'mine');
      assert.equal(JSON.parse(await readFile(join(root, 'Archive', 'Core.palette.json'), 'utf8')).notes, '');
    } finally {
      lib.stop();
    }
  });

  test('a write called during a collection rename waits for it and lands at the new path', async () => {
    const { lib } = harness();
    await lib.collectionCreate('A');
    const { stamp } = await lib.create('A', 'P', palette('p1'));
    const other = await lib.create('A', 'Q', palette('q1'));
    // an open file in the folder holds the rename up (Windows), so the write is called mid-rename
    const held = await open(other.ref.path, 'r');
    const release = sleep(300).then(() => held.close());
    const renaming = lib.collectionRename('A', 'B');
    await sleep(50);
    const w = await lib.write('p1', palette('p1', 'mine'), stamp);
    await Promise.all([renaming, release]);
    assert.ok(w.ok, w.ok ? '' : w.reason);
    assert.equal(w.ref.path, join(root, 'B', 'P.palette.json'));
    assert.equal(paletteOf(await lib.read('p1')).notes, 'mine');
  });

  test('a write retries while Windows holds the file, and one that never gets through leaves it intact', {
    skip: process.platform !== 'win32' && 'needs Windows file sharing rules',
  }, async () => {
    const { lib } = harness();
    const { ref, stamp } = await lib.create('Scratch', 'P', palette('p1'));

    let held = await open(ref.path, 'r'); // a preview or antivirus scan: the rename over it fails with EPERM
    const release = sleep(300).then(() => held.close());
    const w = await lib.write('p1', palette('p1', 'after a wait'), stamp);
    await release;
    if (!w.ok) throw new Error(`write failed: ${w.reason}`);
    assert.equal(paletteOf(await lib.read('p1')).notes, 'after a wait');

    const before = await readFile(ref.path, 'utf8');
    held = await open(ref.path, 'r');
    try {
      const r = await lib.write('p1', palette('p1', 'never lands'), w.stamp);
      assert.equal(r.ok ? 'ok' : r.reason, 'error');
      // spec §11: plain words for the status bar, naming the file and not our temp file; Node's text is logged
      assert.equal(!r.ok && r.reason === 'error' && r.message, 'P.palette.json is open in another program, or the folder is read-only.');
    } finally {
      await held.close();
    }
    assert.equal(await readFile(ref.path, 'utf8'), before);
    assert.deepEqual(await readdir(join(root, 'Scratch')), ['P.palette.json'], 'no temp file left');
  });

  test('an unreadable rewrite of a doc keeps its id, so it reads as changed, not gone', async () => {
    const { lib } = harness();
    const { ref, stamp } = await lib.create('Scratch', 'Night', palette('p1'));
    await writeFile(ref.path, '{ this is not json'); // a sync or an editor half way through its save
    await lib.rescanAll();
    assert.ok(ids(await lib.index()).includes('p1'));
    await assert.rejects(lib.read('p1'), (e: Error) => e.message === "Night isn't a readable palette.");
    const r = await lib.write('p1', palette('p1', 'mine'), stamp);
    assert.equal(r.ok ? 'ok' : r.reason, 'changed-outside');
    assert.equal(await readFile(ref.path, 'utf8'), '{ this is not json');
  });

  test('a rename that types the extension keeps one', async () => {
    const { lib } = harness();
    const img = await lib.createImage('Scratch', 'fx shot', 'png', new Uint8Array([1]).buffer);
    assert.equal((await lib.rename(img.id, 'fx shot.PNG')).name, 'fx shot');
    assert.equal((await lib.rename(img.id, 'glow.png')).name, 'glow');
    await lib.create('Scratch', 'Night', palette('p1'));
    assert.equal((await lib.rename('p1', 'Day.palette.json')).name, 'Day');
  });

  test('with the whole Library folder gone, a write fails (to be tried again) instead of reading as missing', async () => {
    const libRoot = join(root, 'Library');
    await mkdir(libRoot);
    const { lib } = harness(libRoot);
    const { stamp } = await lib.create('Scratch', 'P', palette('p1'));
    await rename(libRoot, join(root, 'Library away'));
    const r = await lib.write('p1', palette('p1', 'mine'), stamp);
    assert.deepEqual(r, { ok: false, reason: 'error', message: 'The Library folder is missing.' });
    await rename(join(root, 'Library away'), libRoot);
    await lib.rescanAll();
    assert.ok((await lib.write('p1', palette('p1', 'mine'), stamp)).ok, 'once it is back, Try again writes');
  });

  test('the Library folder renamed away and back, or deleted and restored, is noticed without focus', async () => {
    const libRoot = join(root, 'Library');
    await mkdir(join(libRoot, 'Brand'), { recursive: true });
    const { lib, changes } = harness(libRoot);
    await lib.start();
    try {
      const last = () => changes.at(-1);
      await rename(libRoot, join(root, 'Library away')); // fs.watch reports nothing for this on Windows
      await until(() => last()?.ok === false);
      await rename(join(root, 'Library away'), libRoot);
      await until(() => last()?.ok === true && last()!.collections.some((c) => c.name === 'Brand'));
      await rm(libRoot, { recursive: true, force: true, maxRetries: 10 });
      await until(() => last()?.ok === false);
      await mkdir(join(libRoot, 'Restored'), { recursive: true });
      await until(() => last()?.ok === true && last()!.collections.some((c) => c.name === 'Restored'));
      // and the watcher runs on the folder that came back
      await writeFile(join(libRoot, 'Restored', 'new.svg'), '<svg/>');
      await until(() => !!last()?.collections.find((c) => c.name === 'Restored')?.items.length);
    } finally {
      lib.stop();
    }
  });

  test('duplicate makes "<name> copy" with a fresh id', async () => {
    const { lib } = harness();
    await lib.create('Scratch', 'P', palette('p1'));
    const d1 = await lib.duplicate('p1');
    const d2 = await lib.duplicate('p1');
    assert.deepEqual([d1.name, d2.name], ['P copy', 'P copy 2']);
    assert.notEqual(d1.id, 'p1');
    assert.deepEqual(paletteOf(await lib.read(d1.id)).swatches, palette('p1').swatches);

    const img = await lib.createImage('Scratch', 'shot', 'png', new Uint8Array([1]).buffer);
    assert.equal((await lib.duplicate(img.id)).name, 'shot copy');
  });

  test('collections: create, rename, lock (which blocks nothing here), Scratch rules', async (t) => {
    const { lib } = harness();
    await lib.start(); // renaming a folder under a live recursive watch is the Windows case that bites
    t.after(() => lib.stop());
    assert.equal((await lib.collectionCreate('Mono:lith')).name, 'Mono-lith');
    assert.equal((await lib.collectionCreate('mono-LITH')).name, 'mono-LITH 2');
    await lib.create('Mono-lith', 'P', palette('p1'));

    const locked = await lib.collectionSetLocked('Mono-lith', true);
    assert.equal(locked.locked, true);
    assert.equal(locked.items[0].locked, true);
    assert.ok((await lib.write('p1', palette('p1', 'still writes'), null)).ok);

    const renamed = await lib.collectionRename('Mono-lith', 'Monolith');
    assert.deepEqual([renamed.name, renamed.locked, renamed.items[0].id], ['Monolith', true, 'p1']);
    assert.equal(lib.pathOf('p1'), join(root, 'Monolith', 'P.palette.json'));

    const unlocked = await lib.collectionSetLocked('monolith', false);
    assert.equal(unlocked.locked, false);
    assert.equal(existsSync(join(root, 'Monolith', '.collection.json')), false);

    await assert.rejects(lib.collectionSetLocked('Scratch', true), /Scratch/);
    await assert.rejects(lib.collectionRename('scratch', 'Other'), /Scratch/);
    await assert.rejects(lib.collectionRename('', 'Other'), /root/);
    await assert.rejects(lib.create('../escape', 'P', palette('p2')), /collection name/);
  });

  test('a missing root is reported and never recreated', async () => {
    const missing = join(root, 'Library');
    const { lib } = harness(missing);
    assert.equal((await lib.index()).ok, false);
    await assert.rejects(lib.create('Monolith', 'P', palette('p1')), /missing/);
    await assert.rejects(lib.createImage('Scratch', 'shot', 'png', new Uint8Array([1]).buffer), /missing/);
    await assert.rejects(lib.collectionCreate('Monolith'), /missing/);
    await assert.rejects(lib.import([join(root, 'x.png')], 'Scratch'), /missing/);
    assert.equal(existsSync(missing), false);
  });

  test('an existing root gets Scratch on start and on setRoot; a missing one stays missing', async () => {
    const names = (index: LibraryIndex) => index.collections.map((c) => c.name);
    await mkdir(join(root, 'Brand'));
    const { lib } = harness();
    assert.deepEqual(names(await lib.index()), ['Brand', 'Scratch']);

    const other = join(root, 'Brand');
    await lib.setRoot(other);
    assert.deepEqual(names(await lib.index()), ['Scratch']);
    assert.ok(existsSync(join(other, 'Scratch')));

    const gone = join(root, 'Gone');
    await lib.setRoot(gone);
    assert.equal((await lib.index()).ok, false);
    assert.equal(existsSync(gone), false);
  });

  test('collection create makes Scratch too', async () => {
    const { lib } = harness();
    await lib.collectionCreate('Monolith');
    assert.deepEqual((await readdir(root)).sort(), ['Monolith', 'Scratch']);
  });

  test('import copies images and SVGs and says why the rest failed', async () => {
    const { lib } = harness();
    const src = join(root, '..', `dt-import-${randomUUID().slice(0, 8)}`);
    await mkdir(src);
    try {
      await writeFile(join(src, 'photo.JPG'), 'jpg');
      await writeFile(join(src, 'mark.svg'), '<svg/>');
      await writeFile(join(src, 'notes.txt'), 'hi');
      await writeFile(join(src, 'fake.psd'), '8BPS');
      const r = await lib.import(
        [join(src, 'photo.JPG'), join(src, 'mark.svg'), join(src, 'notes.txt'), join(src, 'gone.png'), join(src, 'fake.psd')],
        'Imports',
      );
      assert.deepEqual(r.made.map((i) => [i.name, i.kind, i.ext, i.collection]), [
        ['photo', 'image', 'jpg', 'Imports'],
        ['mark', 'svg', 'svg', 'Imports'],
      ]);
      // spec §10.3: a plain sentence for each file
      assert.deepEqual(r.failed, [
        { name: 'notes.txt', reason: "TXT files aren't supported. The Library takes ASE, ACO and GPL palettes, images and SVGs." },
        { name: 'gone.png', reason: "The file isn't there any more." },
        { name: 'fake.psd', reason: "PSD files aren't supported. Export a PNG or TIFF." },
      ]);
      assert.deepEqual(r.warnings, []);
    } finally {
      await rm(src, { recursive: true, force: true });
    }
  });

  const reader = new URL('../src/shared/color/palette-readers.ts', import.meta.url);
  const ase = new URL('./fixtures/chalk_palette.ase', import.meta.url);
  const noReader = !existsSync(reader) || !existsSync(ase) ? 'palette reader or .ase fixture not there yet' : false;

  test('import turns an .ase into a palette', { skip: noReader }, async () => {
    const { lib } = harness();
    const r = await lib.import([fileURLToPath(ase)], 'Scratch');
    assert.deepEqual(r.failed, []);
    assert.equal(r.made[0].kind, 'palette');
    assert.ok(paletteOf(await lib.read(r.made[0].id)).swatches.length > 0);
  });

  test('an import passes on what the palette reader noticed (spec §6.3)', { skip: noReader }, async () => {
    const { lib } = harness();
    const src = join(root, '..', `dt-import-${randomUUID().slice(0, 8)}`);
    await mkdir(src);
    try {
      // Aseprite writes RGBA GIMP palettes; a fully transparent entry is an empty slot
      await writeFile(join(src, 'slots.gpl'), 'GIMP Palette\nChannels: RGBA\n#\n255 0 0 255 Red\n0 0 0 0 Empty\n');
      const r = await lib.import([join(src, 'slots.gpl')], 'Scratch');
      assert.deepEqual(r.failed, []);
      assert.equal(r.warnings.length, 1);
      assert.equal(r.warnings[0].name, r.made[0].name);
      assert.match(r.warnings[0].messages.join(' '), /transparent/);
    } finally {
      await rm(src, { recursive: true, force: true });
    }
  });

  test('an .ase in a collection is listed as not imported until it is', { skip: noReader }, async () => {
    const { lib } = harness();
    await mkdir(join(root, 'Chalk'));
    await copyFile(ase, join(root, 'Chalk', 'chalk.ase'));
    const listed = (await lib.index()).collections.find((c) => c.name === 'Chalk')!;
    assert.deepEqual(listed.notImported.map((f) => f.name), ['chalk.ase']);

    const r = await lib.import([listed.notImported[0].path], 'Chalk');
    assert.equal(r.made[0].name, 'chalk');
    assert.deepEqual((await lib.index()).collections.find((c) => c.name === 'Chalk')!.notImported, []);
  });
});
