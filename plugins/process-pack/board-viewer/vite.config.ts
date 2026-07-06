import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { viteSingleFile } from 'vite-plugin-singlefile'

export default defineConfig({
  // Relative base so the built index.html works when opened straight from
  // disk (file://) as well as when served from any subpath.
  base: './',
  plugins: [react(), tailwindcss(), viteSingleFile()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    // Single-file output: everything inlines into one dist/index.html.
    // board.json in public/ is left alone (copied next to it, not inlined)
    // so it can be fetched at runtime or swapped without a rebuild.
    cssCodeSplit: false,
    assetsInlineLimit: 100_000_000,
  },
})
