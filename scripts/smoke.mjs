// `npm run smoke` after the build (spec §12): the full smoke pass (--smoke) in a new temp folder,
// then a relaunch on that folder (--smoke-quiet) that restores and quits with no input. Checks the
// files each pass leaves, prints PASS or FAIL and exits non-zero on any failure. The folder is
// deleted on a pass and kept on a failure.
import { spawn } from 'node:child_process';
import { existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import electron from 'electron';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE; // set, electron.exe would run as plain Node

let failed = 0;
function check(name, ok, detail) {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || detail === undefined ? '' : ` :: ${detail}`}`);
  if (!ok) failed++;
  return ok;
}

/** run the built app; its [smoke] lines go to stdout, everything else only on a failure */
function launch(args) {
  return new Promise((resolve) => {
    const child = spawn(electron, ['.', ...args], { cwd: repo, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('close', (code) => {
      process.stdout.write(out);
      if (code !== 0 && err) process.stdout.write(`--- stderr ---\n${err}\n`);
      resolve({ code, out });
    });
  });
}

/** every file under `dir` → mtime */
function mtimes(dir) {
  if (!existsSync(dir)) return new Map();
  const files = readdirSync(dir, { recursive: true }).map((f) => join(dir, f));
  return new Map(files.filter((f) => statSync(f).isFile()).map((f) => [f, statSync(f).mtimeMs]));
}

function changed(before, after) {
  const keys = new Set([...before.keys(), ...after.keys()]);
  return [...keys].filter((k) => before.get(k) !== after.get(k));
}

console.log('pass 1: --smoke');
const one = await launch(['--smoke']);
const dir = /\[smoke\] folder (.+)/.exec(one.out)?.[1]?.trim();
check('pass 1 exits 0', one.code === 0, `exit code ${one.code}`);
if (!check('pass 1 names its folder', dir && existsSync(dir))) process.exit(1);
// pass 1 quits with a task still running: "Quit anyway?" is answered without a dialog (no test run
// shows one, since a modal would take the foreground), and the quit goes ahead
check('a quit with a task running asks "Quit anyway?" and goes ahead', /\[smoke\] quit anyway: quit/.test(one.out));

const exports = join(dir, 'exports');
const exported = ['smoke export.png', join('dev-palette', 'one.txt'), join('dev-palette', 'two.txt')];
check('the exports are on disk', exported.every((f) => existsSync(join(exports, f))), exported.filter((f) => !existsSync(join(exports, f))).join(', '));
const trash = existsSync(join(dir, 'trash')) ? readdirSync(join(dir, 'trash')) : [];
check('the deleted palette is in the trash', trash.some((f) => f.endsWith(' Untitled palette.palette.json')), trash.join(', '));
check('the delete pending at the quit is in the trash', trash.some((f) => f.endsWith(' Dev image.png')), trash.join(', '));

const watched = [join(dir, 'Library'), join(dir, 'Design Tools', 'workspace')];
const snapshot = () => new Map(watched.flatMap((d) => [...mtimes(d)]));
const before = snapshot();
check('pass 1 left Library and workspace files', before.size > 0);

console.log('pass 2: --smoke-quiet (relaunch, no input)');
const two = await launch([`--smoke-dir=${dir}`, '--smoke-quiet']);
check('pass 2 exits 0', two.code === 0, `exit code ${two.code}`);
const diff = changed(before, snapshot());
check('no Library or workspace file changed', diff.length === 0, diff.join(', '));

console.log(failed ? `FAIL (${failed}); the smoke folder is kept: ${dir}` : 'PASS');
if (!failed) rmSync(dir, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
