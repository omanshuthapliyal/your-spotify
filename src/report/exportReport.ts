import type { ReportData } from './types';
import { esc } from '../ui/exporter';

/** Strict policy for the report file: inline code only, embedded images only, no network at all. */
const REPORT_CSP = [
  "default-src 'none'", "script-src 'unsafe-inline'", "style-src 'unsafe-inline'", "img-src data:",
  "connect-src 'none'", "font-src 'none'", "base-uri 'none'", "form-action 'none'",
].join('; ');

/** Turn same-origin cover paths into small embedded JPEGs (canvas, no fetch needed). */
async function coverToDataUri(src: string, size = 112): Promise<string | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const c = document.createElement('canvas');
        c.width = size; c.height = size;
        const ctx = c.getContext('2d')!;
        const s = Math.min(img.naturalWidth, img.naturalHeight);
        ctx.drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, 0, 0, size, size);
        resolve(c.toDataURL('image/jpeg', 0.8));
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/** Replace every `art` path in the data with an embedded image (or null). */
export async function embedCovers(data: ReportData): Promise<ReportData> {
  const paths = new Set<string>();
  const walk = (v: unknown, fn: (o: Record<string, unknown>) => void) => {
    if (Array.isArray(v)) v.forEach((x) => walk(x, fn));
    else if (v && typeof v === 'object') { fn(v as Record<string, unknown>); Object.values(v).forEach((x) => walk(x, fn)); }
  };
  walk(data, (o) => { if (typeof o.art === 'string' && !o.art.startsWith('data:')) paths.add(o.art); });
  const map = new Map<string, string | null>();
  await Promise.all([...paths].map(async (p) => map.set(p, await coverToDataUri(p))));
  const copy: ReportData = JSON.parse(JSON.stringify(data));
  walk(copy, (o) => { if (typeof o.art === 'string' && map.has(o.art)) o.art = map.get(o.art) ?? null; });
  return copy;
}


/** Assemble the self-contained report HTML: viewer script + styles + data, nothing external. */
export function reportHtml(data: ReportData, viewer: { js: string; css: string }): string {
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  const js = viewer.js.replace(/<\/script/gi, '<\\/script');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta http-equiv="Content-Security-Policy" content="${REPORT_CSP}" />
<meta name="referrer" content="no-referrer" />
<meta name="generator" content="Listening Timeline" />
<title>${esc(data.title)}</title>
<style>${viewer.css}</style>
</head>
<body>
<div id="root"></div>
<script id="report-data" type="application/json">${json}</script>
<script>${js}</script>
</body>
</html>
`;
}

/** Embed code for a report section (`story`, `albums`, ...) or one plot (`plot=map`). */
export const EMBED_SNIPPET = (file: string, target: string) => `<iframe src="${file}#${target}&embed" title="My listening report" loading="lazy" allowfullscreen
  style="width:100%;border:0;min-height:${target.startsWith('plot=') ? 420 : 640}px"></iframe>
<script>
  // Optional: let the report set its own height.
  addEventListener('message', (e) => {
    if (!e.data || e.data.type !== 'listening-report:height') return;
    for (const f of document.querySelectorAll('iframe')) if (f.contentWindow === e.source) f.style.height = e.data.height + 'px';
  });
</script>`;

/** Hugo shortcode call (docs/hugo-shortcode.html) for a file placed in static/listening/. */
export const HUGO_SNIPPET = (file: string, plot: string | null) =>
  plot ? `{{< listening src="listening/${file}" plot="${plot}" >}}` : `{{< listening src="listening/${file}" section="story" >}}`;
