import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';

export default defineConfig({
  // culori is the one dependency main imports; bundled, so the packaged app needs no node_modules
  main: { plugins: [externalizeDepsPlugin({ exclude: ['culori'] })] },
  preload: {
    plugins: [externalizeDepsPlugin()],
    // sandboxed preloads can't load ESM; emit CommonJS
    build: { rollupOptions: { output: { format: 'cjs', entryFileNames: '[name].cjs' } } },
  },
  renderer: {
    plugins: [react()],
    build: { rollupOptions: { input: { index: resolve(__dirname, 'src/renderer/index.html') } } },
  },
});
