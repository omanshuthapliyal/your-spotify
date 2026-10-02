/**
 * PNG/SVG export of the displayed chart. The chart SVG uses literal colors, so the exported
 * graphic matches the screen. Everything happens locally (XMLSerializer, canvas, blob URLs).
 */
import { saveBlob } from './download';
import type { Theme } from './theme';

export interface LegendEntry {
  label: string;
  color: string;
  value: string;
  hatched?: boolean;
}

export interface ExportMeta {
  title: string;
  subtitle: string[];
  legend: LegendEntry[];
  footer: string[];
  theme: Theme;
  filename: string;
}

const FONT = "system-ui, -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif";

export function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Rough text width for layout (no DOM measurement, so it also works in tests). */
function textW(s: string, size: number) {
  return s.length * size * 0.56;
}

function wrap(text: string, size: number, maxW: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (textW(next, size) > maxW && cur) { lines.push(cur); cur = w; } else cur = next;
  }
  if (cur) lines.push(cur);
  return lines;
}

function buildExportSvg(chart: SVGSVGElement, meta: ExportMeta): { svg: string; width: number; height: number } {
  const t = meta.theme;
  const cw = Number(chart.getAttribute('width'));
  const ch = Number(chart.getAttribute('height'));
  const pad = 28;
  const W = Math.max(cw + pad * 2, 640);
  const maxW = W - pad * 2;
  const parts: string[] = [];
  let y = pad + 22;
  for (const line of wrap(meta.title, 22, maxW)) {
    parts.push(`<text x="${pad}" y="${y}" font-size="22" font-weight="700" fill="${t.ink}">${esc(line)}</text>`);
    y += 28;
  }
  y -= 4;
  for (const sub of meta.subtitle) {
    for (const line of wrap(sub, 13, maxW)) {
      parts.push(`<text x="${pad}" y="${y}" font-size="13" fill="${t.ink2}">${esc(line)}</text>`);
      y += 18;
    }
  }
  y += 10;
  const chartY = y;
  const inner = new XMLSerializer().serializeToString(chart)
    .replace(/^<svg/, `<svg x="${(W - cw) / 2}" y="${chartY}"`)
    .replace(/ tabindex="[^"]*"/g, '');
  y += ch + 14;

  // Legend, wrapped into rows.
  let x = pad;
  const rowH = 22;
  let legendY = y + 12;
  const legendParts: string[] = [];
  let hatchUsed = false;
  for (const e of meta.legend) {
    const label = `${e.label}  ${e.value}`;
    const w = 16 + textW(label, 12.5) + 20;
    if (x + w > W - pad && x > pad) { x = pad; legendY += rowH; }
    legendParts.push(`<rect x="${x}" y="${legendY - 10}" width="11" height="11" rx="3" fill="${e.color}"/>`);
    if (e.hatched) { hatchUsed = true; legendParts.push(`<rect x="${x}" y="${legendY - 10}" width="11" height="11" rx="3" fill="url(#hatch)"/>`); }
    legendParts.push(`<text x="${x + 17}" y="${legendY}" font-size="12.5" fill="${t.ink}">${esc(e.label)}<tspan fill="${t.muted}">  ${esc(e.value)}</tspan></text>`);
    x += w;
  }
  y = legendY + 20;
  const footerParts: string[] = [];
  for (const f of meta.footer) {
    for (const line of wrap(f, 11.5, maxW)) {
      footerParts.push(`<text x="${pad}" y="${y}" font-size="11.5" fill="${t.muted}">${esc(line)}</text>`);
      y += 16;
    }
  }
  const H = y + pad - 8;
  const defs = hatchUsed
    ? `<defs><pattern id="hatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="2" height="5" fill="rgba(255,255,255,0.55)"/></pattern></defs>`
    : '';
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${esc(FONT)}">
${defs}<rect width="${W}" height="${H}" fill="${t.surface}"/>
${parts.join('\n')}
${inner}
${legendParts.join('\n')}
${footerParts.join('\n')}
</svg>`;
  return { svg, width: W, height: H };
}

export function exportSvg(chart: SVGSVGElement, meta: ExportMeta) {
  const { svg } = buildExportSvg(chart, meta);
  saveBlob(new Blob([svg], { type: 'image/svg+xml' }), `${meta.filename}.svg`);
}

export async function exportPng(chart: SVGSVGElement, meta: ExportMeta, scale = 2) {
  const { svg, width, height } = buildExportSvg(chart, meta);
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    img.decoding = 'sync';
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('Could not render the chart image.'));
      img.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    const ctx = canvas.getContext('2d')!;
    ctx.scale(scale, scale);
    ctx.fillStyle = meta.theme.surface;
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
    if (!blob) throw new Error('PNG encoding failed.');
    saveBlob(blob, `${meta.filename}.png`);
  } finally {
    URL.revokeObjectURL(url);
  }
}
