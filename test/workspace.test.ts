import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { isInside } from '../src/main/fsx.ts';
import { createWorkspace } from '../src/main/workspace.ts';
import type { WorkspaceState } from '../src/shared/types.ts';

const root = await mkdtemp(join(tmpdir(), 'dt-ws-'));
after(() => rm(root, { recursive: true, force: true }));
const ws = createWorkspace(root);
const state = (n: number): WorkspaceState => ({ toolId: 'dither', docVersion: 1, doc: { n } });
const stateFile = join(root, 'workspace', 'dither', 'state.json');
const assetsDir = join(root, 'workspace', 'dither', 'assets');
const hourAgo = () => new Date(Date.now() - 3_600_000);
const age = (hash: string, ext: string) => utimes(join(assetsDir, `${hash}.${ext}`), hourAgo(), hourAgo());

test('save then load round-trips, keeping the previous copy', async () => {
  assert.equal(await ws.load('dither'), null);
  await ws.save('dither', state(1));
  await ws.save('dither', state(2));
  assert.deepEqual(await ws.load('dither'), state(2));
  assert.deepEqual(JSON.parse(await readFile(join(root, 'workspace', 'dither', 'state.prev.json'), 'utf8')), state(1));
});

test('rapid saves land in order', async () => {
  await Promise.all([3, 4, 5, 6].map((n) => ws.save('dither', state(n))));
  assert.deepEqual(await ws.load('dither'), state(6));
});

test('a damaged state.json falls back to state.prev.json', async () => {
  await writeFile(stateFile, '{"toolId":');
  assert.deepEqual(await ws.load('dither'), state(5));
});

test('quarantine keeps the document and clears the state', async () => {
  const path = await ws.quarantine('dither', { broken: true });
  assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), { broken: true });
  assert.equal(await ws.load('dither'), null);
});

test('assets are stored once by hash and garbage-collected', async () => {
  const bytes = new TextEncoder().encode('pixels').buffer as ArrayBuffer;
  const a = await ws.putAsset('dither', bytes, '.PNG');
  const b = await ws.putAsset('dither', bytes, 'png');
  assert.equal(a.hash, b.hash);
  assert.equal(a.url, `dt://asset/dither/${a.hash}.png`);
  const c = await ws.putAsset('dither', new TextEncoder().encode('other').buffer as ArrayBuffer, 'jpg');
  assert.equal(await ws.gcAssets('dither', [c.hash]), 0, 'assets put in the last minute survive');
  await age(a.hash, 'png');
  assert.equal(await ws.gcAssets('dither', [c.hash]), 1);
  assert.deepEqual(await readdir(assetsDir), [`${c.hash}.jpg`]);
  assert.ok(ws.assetPath('dither', `${c.hash}.jpg`));
  assert.equal(ws.assetPath('dither', '../settings.json'), null);
});

test('gc leaves temp files and repeated puts alone', async () => {
  const bytes = new TextEncoder().encode('again').buffer as ArrayBuffer;
  const { hash } = await ws.putAsset('dither', bytes, 'png');
  await age(hash, 'png');
  await ws.putAsset('dither', bytes, 'png'); // the same image dropped again: fresh
  const tmp = join(assetsDir, `${'f'.repeat(64)}.png.1234abcd.tmp`); // a put still writing
  await writeFile(tmp, 'x');
  await utimes(tmp, hourAgo(), hourAgo());
  assert.equal(await ws.gcAssets('dither', []), 0);
  assert.ok((await readdir(assetsDir)).includes(`${hash}.png`));
  await rm(tmp);
});

test('tool ids and extensions cannot escape the workspace', async () => {
  await assert.rejects(ws.load('../x' as 'dither'), /Unknown tool/);
  await assert.rejects(ws.putAsset('dither', new ArrayBuffer(1), 'p/ng'), /Unsupported/);
});

test('presets round-trip; missing is empty', async () => {
  assert.deepEqual(await ws.presetsLoad('halftone'), []);
  await ws.presetsSave('halftone', [{ name: 'a' }]);
  assert.deepEqual(await ws.presetsLoad('halftone'), [{ name: 'a' }]);
});

test('isInside', () => {
  assert.ok(isInside('C:\\Lib', 'C:\\Lib\\a\\b.png'));
  assert.ok(isInside('C:\\Lib', 'c:\\lib\\..foo.png'));
  assert.ok(!isInside('C:\\Lib', 'C:\\Library\\x.png'));
  assert.ok(!isInside('C:\\Lib', 'C:\\Lib\\..\\x.png'));
  assert.ok(!isInside('C:\\Lib', 'D:\\Lib\\x.png'));
});
