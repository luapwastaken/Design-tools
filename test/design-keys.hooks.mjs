// Lets design-keys.test.ts import the tool without a bundler: a .tsx or .css file becomes a module of no-op exports with the same names (the keys never draw anything).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export async function load(url, context, next) {
  if (!/\.(tsx|css)(\?|$)/.test(url)) return next(url, context);
  if (url.includes('.css')) return { format: 'module', source: 'export default new Proxy({}, { get: (_, k) => String(k) });', shortCircuit: true };
  const text = readFileSync(fileURLToPath(url), 'utf8');
  const names = new Set();
  for (const m of text.matchAll(/^export\s+(?:async\s+)?(?:const|let|function\*?|class)\s+(\w+)/gm)) names.add(m[1]);
  for (const m of text.matchAll(/^export\s*\{([^}]*)\}(?!\s*from)/gm)) for (const n of m[1].split(',')) { const p = n.trim().split(/\s+as\s+/).pop(); if (p && !/^type\s/.test(n.trim())) names.add(p); }
  const src = [...names].map((n) => `export const ${n} = new Proxy(function () {}, { get: () => () => {}, apply: () => undefined });`).join('\n') + '\nexport default {};';
  return { format: 'module', source: src, shortCircuit: true };
}
