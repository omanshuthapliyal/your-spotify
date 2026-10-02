import type { Plugin } from 'vite';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Production-only Content Security Policy. `connect-src 'none'` means the page
// and its worker cannot fetch/XHR/WebSocket/beacon anywhere, so listening data
// cannot leave the tab even by accident. Not applied in dev because Vite's HMR
// needs a local WebSocket.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "worker-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data:",
  "font-src 'self'",
  "connect-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
  "object-src 'none'",
].join('; ');

function cspPlugin(): Plugin {
  return {
    name: 'local-csp',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace(
        '<meta charset="UTF-8" />',
        `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`,
      );
    },
  };
}

/**
 * Bakes a local artist->genre CSV (plus, when present, the genre tree and artist/album year files
 * from `npm run enrich`) into the build as `virtual:baked-genres`, so they load automatically after
 * an import. Default file: genres/artist-genres.local.csv (git-ignored).
 * BAKED_GENRES_FILE overrides the path; NO_BAKED_GENRES=1 disables it (used by tests).
 * The CSV holds artist names and genres only, never plays. A build that contains it is for
 * personal local use: do not publish that dist/ folder.
 */
function bakedGenres(): Plugin {
  const id = 'virtual:baked-genres';
  const rid = '\0' + id;
  return {
    name: 'baked-genres',
    resolveId(i) {
      return i === id ? rid : undefined;
    },
    load(i) {
      if (i !== rid) return undefined;
      if (process.env.NO_BAKED_GENRES) return 'export default null;';
      const file = resolve(import.meta.dirname, process.env.BAKED_GENRES_FILE ?? 'genres/artist-genres.local.csv');
      if (!existsSync(file)) return 'export default null;';
      // Optional companions from `npm run enrich`, next to the mapping (or set via env for tests).
      const dir = file.slice(0, file.lastIndexOf('/'));
      const read = (envName: string, fallback: string) => {
        const f = process.env[envName] ? resolve(import.meta.dirname, process.env[envName]!) : `${dir}/${fallback}`;
        if (!existsSync(f)) return null;
        this.addWatchFile(f);
        return readFileSync(f, 'utf8');
      };
      this.addWatchFile(file);
      const tree = read('BAKED_TREE_FILE', 'genre-tree.local.json');
      return `export default ${JSON.stringify({
        name: file.split('/').pop(),
        csv: readFileSync(file, 'utf8'),
        tree: tree ? JSON.parse(tree) : null,
        artistInfo: read('BAKED_ARTIST_INFO_FILE', 'artist-info.local.csv'),
        albumYears: read('BAKED_ALBUM_YEARS_FILE', 'album-years.local.csv'),
        art: (() => { const a = read('BAKED_ART_FILE', 'art-index.local.json'); return a ? JSON.parse(a) : null; })(),
      })};`;
    },
  };
}

/**
 * Exposes the prebuilt report viewer (npm run build:report -> dist-report/) as
 * `virtual:report-viewer`, loaded on demand when you create a shareable report.
 */
function reportViewer(): Plugin {
  const id = 'virtual:report-viewer';
  const rid = '\0' + id;
  return {
    name: 'report-viewer',
    resolveId: (i) => (i === id ? rid : undefined),
    load(i) {
      if (i !== rid) return undefined;
      const js = resolve(import.meta.dirname, 'dist-report/viewer.js');
      const css = resolve(import.meta.dirname, 'dist-report/viewer.css');
      if (!existsSync(js)) return 'export default null;';
      this.addWatchFile(js);
      return `export default ${JSON.stringify({ js: readFileSync(js, 'utf8'), css: existsSync(css) ? readFileSync(css, 'utf8') : '' })};`;
    },
  };
}

// Test builds (no baked data, or a fixture mapping) must not ship your downloaded covers in public/.
const testBuild = Boolean(process.env.NO_BAKED_GENRES || process.env.BAKED_GENRES_FILE);

export default defineConfig({
  plugins: [react(), cspPlugin(), bakedGenres(), reportViewer()],
  publicDir: testBuild ? false : 'public',
  worker: { format: 'es' },
  // The meta tag covers the page; the header also covers the worker script (workers take their
  // CSP from their own response). Local preview server only.
  preview: { headers: { 'Content-Security-Policy': CSP, 'Referrer-Policy': 'no-referrer' } },
  // Personal builds embed the baked genre/year data (a few hundred KB); that is expected locally.
  build: { sourcemap: false, chunkSizeWarningLimit: 1500 },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
  },
});
