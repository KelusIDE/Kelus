import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [svelte()],
  // y-monaco imports a Monaco path that monaco-editor's exports map no longer resolves; share the one Monaco instance.
  resolve: { alias: [{ find: /^monaco-editor\/esm\/vs\/editor\/editor\.api(\.js)?$/, replacement: 'monaco-editor' }] },
  base: './',
  build: { outDir: fileURLToPath(new URL('../../../dist-ui', import.meta.url)), emptyOutDir: true },
  server: { port: 5173, strictPort: true }
});
