import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Builds the shareable-report viewer as ONE inline-able script (+ one CSS file) in dist-report/.
 * The main app embeds these into exported report HTML files, so reports need nothing else.
 */
export default defineConfig({
  plugins: [react()],
  publicDir: false,
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  build: {
    outDir: 'dist-report',
    emptyOutDir: true,
    cssCodeSplit: false,
    sourcemap: false,
    lib: { entry: 'src/report/viewer.tsx', formats: ['iife'], name: 'ListeningReport', fileName: () => 'viewer.js', cssFileName: 'viewer' },
  },
});
