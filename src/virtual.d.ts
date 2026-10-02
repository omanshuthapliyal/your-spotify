declare module 'virtual:baked-genres' {
  import type { TreeData } from './core/genreTree';
  /** Artist->genre CSV (and optional enrichment) baked in at build time, or null when none was present. */
  const baked: { name: string; csv: string; tree: TreeData | null; artistInfo: string | null; albumYears: string | null; art: Record<string, string | null> | null } | null;
  export default baked;
}

declare module 'virtual:report-viewer' {
  /** Prebuilt report viewer (script + styles), or null if `npm run build:report` has not run. */
  const viewer: { js: string; css: string } | null;
  export default viewer;
}
