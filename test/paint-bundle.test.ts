import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

// The stroke sheet, its checks and the dtPaint probe are for smoke folders: the Illustration tool must
// not pull them in statically, or they ship in the chunk every user loads. useEngine imports the probe
// with a dynamic import() only when window.api.smoke is set.
const root = resolve(import.meta.dirname, '../src/renderer');
const entry = join(root, 'tools/illustration/index.ts');
const smokeOnly = ['probe.ts', 'sheet.ts', 'sheet-checks.ts', 'sheet-strokes.ts', 'smoke-checks.ts', 'km-cases.ts'].map((f) => join(root, 'tools/illustration/paint', f));

/** every file the entry reaches through static imports and re-exports (not import()) */
function reach(from: string): Map<string, string> {
  const seen = new Map<string, string>();
  const walk = (file: string, via: string) => {
    if (seen.has(file)) return;
    seen.set(file, via);
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/^\s*(?:import|export)\s[^;]*?\sfrom\s+'(\.[^']+)'/gm)) {
      const to = resolve(dirname(file), m[1]);
      if (/\.(ts|tsx)$/.test(to) && existsSync(to)) walk(to, file);
    }
  };
  walk(from, '(entry)');
  return seen;
}

test('the Illustration tool does not statically reach the stroke sheet, its checks or the probe', () => {
  const files = reach(entry);
  assert.ok(files.size > 20 && files.has(join(root, 'tools/illustration/paint/engine.ts')), `walked ${files.size} files`);
  for (const f of smokeOnly) assert.ok(!files.has(f), `${f.slice(root.length)} is imported by ${files.get(f)?.slice(root.length)}`);
});

test('the probe is loaded with a dynamic import, in smoke folders only', () => {
  const src = readFileSync(join(root, 'tools/illustration/useEngine.ts'), 'utf8');
  assert.match(src, /if \(window\.api\.smoke\) \{[^}]*import\('\.\/paint\/probe\.ts'\)/s);
});
