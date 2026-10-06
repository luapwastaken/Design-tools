// scripts/check-rules.mjs against planted violations. Each line marked `expect: <rules>` must be
// reported with exactly those rules, and nothing else may be (so the allowed forms are covered too).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PLANTED: Record<string, string> = {
  'src/renderer/styles/tokens.css': `
:root { --t-fast: 90ms; --t-slow: 300ms; --ease: cubic-bezier(.2, .8, .2, 1); }
[data-theme="dark"] {
  --page: oklch(0.12 0 0);
  --ground: oklch(0.185 0 0);
  --ink-2: oklch(0.80 0 0);
  --extra: oklch(0.5 0 0); /* expect: 2 */
}
[data-theme="light"] {
  --page: oklch(0.93 0 0);
  --ground: #d1d1d1; /* expect: 2 */
  --ink-2: oklch(0.37 0 0);
}`,
  'src/renderer/styles/base.css': `/* expect: 4 */
@media (prefers-reduced-motion: reduce) { * { transition-duration: 0s; } }`,
  'src/renderer/ui/Bad.module.css': `
.a { content: "x"; } /* expect: 1 */
.a::after { content: ""; }
.b { color: #fff; } /* expect: 2 */
.b { background: white; } /* expect: 2 */
.b { border-color: rgb(0 0 0); } /* expect: 2 */
.ok { white-space: nowrap; box-shadow: inset 0 0 0 1px var(--edge-red); background: transparent; color: currentColor; }
.c { transition: opacity 100ms; } /* expect: 4 */
.d { transition: all 90ms; } /* expect: 4 */
.e { transition: 90ms; } /* expect: 4 */
.f { transition: transform 200ms; } /* expect: 4 */
.g { transition: transform var(--t-slow) var(--ease); } /* expect: 4 */
.g { transition-property: box-shadow; } /* expect: 4 */
.ok { transition: transform var(--t-fast) var(--ease), clip-path 120ms cubic-bezier(.2, .8, .2, 1); }
.h { animation: fade 90ms; } /* expect: 4 */
@keyframes fade { from { opacity: 0; } } /* expect: 4 */
.spin { animation: spin 1s linear infinite; } /* expect: 4 */
@keyframes spin { to { transform: rotate(1turn); } } /* expect: 4 */
.j { animation: grow 90ms; } /* expect: 4 */
@keyframes grow { to { transform: scale(2); } } /* expect: 4 */
.l { animation-iteration-count: infinite; } /* expect: 4 */
.m { animation: none; animation-name: none; }
.k { scroll-behavior: smooth; } /* expect: 4 */
.p { box-shadow: inset 0 4px 0 var(--agent), inset 0 0 0 1px var(--edge); } /* expect: 7 */
.q { box-shadow: inset 3px 0 0 var(--signal); } /* expect: 7 */
.r { border-left: 3px solid var(--line); } /* expect: 7 */
.s::before { content: ""; position: absolute; top: 0; bottom: 0; left: 0; width: 2px; background: var(--agent); } /* expect: 7 */
.t { box-shadow: 0 -1px 0 var(--line); }
.u[data-insert]::before { content: ""; position: absolute; top: 0; bottom: 0; width: 3px; background: var(--ink); }
.v:focus-visible::after { content: ""; position: absolute; left: 0; right: 0; bottom: 0; height: 2px; background: var(--signal); }
.w { box-shadow: inset 0 0 0 2px var(--agent); }`,
  'src/renderer/ui/Bad.tsx': `// a comment may say anything: → ─ §
export const A = () => <div title="x">→</div>; // expect: 1 6
export const B = () => <select />; // expect: 6
export const C = () => <input type="number" />; // expect: 6
export const D = () => <span className="material-symbols-rounded">add</span>; // expect: 1
import { Plus } from '@phosphor-icons/react'; // expect: 1
export const E = () => <i style={{ background: '#000' }} />; // expect: 2
export const F = () => <i style={{ transition: 'transform 90ms' }} />; // expect: 4
export const G = (el: HTMLElement) => el.animate([{ opacity: 0 }], 90); // expect: 4
export const H = () => document.startViewTransition(); // expect: 4
export const O = (el: HTMLElement) => el.animate([{ transform: 'none' }], { duration: 90, iterations: Infinity }); // expect: 4
export const P = (el: HTMLElement) => el.animate([{ transform: 'none' }], { duration: 90 });
export const I = () => <Module title="Fine: a prop" sub="× · ° Δ ≈ – … “ ” ’" />;
export const J = (c: CanvasRenderingContext2D) => { c.fillStyle = 'white'; }; // expect: 2
export const K = () => <circle fill="red" />; // expect: 2
export const L = { plates: ['cyan', 'black'], label: 'Black plate' };
export const M = () => <i>a&nbsp;· b</i>; // expect: 1
export const N = () => <i>a&middot; b &#215; c &#x2192;</i>; // expect: 1`,
  'src/main/menu.ts': `export const m = (menu: any) => menu.popup({}); // expect: 6
export const bg = '#123456'; // expect: 2`,
  'src/main/window.ts': `export const THEME_HEX = {
  dark: { page: '#000000', ground: '#131313', ink2: '#bebebe' }, // expect: 2
} as const;`,
};

test('check-rules reports exactly the planted violations', () => {
  const root = mkdtempSync(join(tmpdir(), 'dt-rules-'));
  try {
    const expected: string[] = [];
    for (const [file, text] of Object.entries(PLANTED)) {
      mkdirSync(join(root, dirname(file)), { recursive: true });
      writeFileSync(join(root, file), text);
      text.split('\n').forEach((l, i) => {
        for (const rule of l.match(/expect: ([\d ]+)/)?.[1].trim().split(' ') ?? []) expected.push(`${file}:${i + 1} rule ${rule}`);
      });
    }
    const script = fileURLToPath(new URL('../scripts/check-rules.mjs', import.meta.url));
    const r = spawnSync(process.execPath, [script, root], { encoding: 'utf8' });
    const got = [...r.stdout.matchAll(/^(\S+:\d+) {2}rule (\d)/gm)].map((m) => `${m[1]} rule ${m[2]}`);
    assert.deepEqual([...got].sort(), [...expected].sort(), r.stdout + r.stderr);
    assert.equal(r.status, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
