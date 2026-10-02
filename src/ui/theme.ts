import { useEffect, useState } from 'react';
import type { SeriesData } from '../core/aggregate';

/**
 * Chart colors are concrete hex values (not CSS variables) so exported SVG/PNG files render
 * exactly as displayed. Categorical order is the validated 8-slot palette; do not reorder.
 */
export interface Theme {
  name: 'light' | 'dark';
  surface: string;
  ink: string;
  ink2: string;
  muted: string;
  grid: string;
  axis: string;
  emptyBand: string;
  other: string;
  unclassified: string;
  series: string[];
}

function mix(a: string, b: string, t: number): string {
  const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const x = p(a);
  const y = p(b);
  return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('');
}

/** 24 slots: the 8 validated hues, then a lighter tier, then a darker tier (same order). */
function tiers(base: string[], dark: boolean): string[] {
  const light = base.map((c) => mix(c, '#ffffff', dark ? 0.38 : 0.5));
  const deep = base.map((c) => mix(c, '#000000', dark ? 0.3 : 0.38));
  return [...base, ...light, ...deep];
}

const LIGHT: Theme = {
  name: 'light',
  surface: '#fcfcfb',
  ink: '#0b0b0b',
  ink2: '#52514e',
  muted: '#77756f',
  grid: '#e1e0d9',
  axis: '#c3c2b7',
  emptyBand: '#f0efec',
  other: '#c3c2b7',
  unclassified: '#898781',
  series: tiers(['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'], false),
};

const DARK: Theme = {
  name: 'dark',
  surface: '#1a1a19',
  ink: '#ffffff',
  ink2: '#c3c2b7',
  muted: '#9a988f',
  grid: '#2c2c2a',
  axis: '#383835',
  emptyBand: '#232321',
  other: '#5c5b56',
  unclassified: '#898781',
  series: tiers(['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'], true),
};

export function seriesColor(s: Pick<SeriesData, 'kind' | 'colorSlot'>, t: Theme): string {
  if (s.kind === 'other') return t.other;
  if (s.kind === 'unclassified') return t.unclassified;
  return s.colorSlot === null ? t.other : t.series[s.colorSlot];
}

export type ThemePref = 'system' | 'light' | 'dark';

/**
 * Chart theme for the chosen preference. "system" follows the OS setting live. The choice is kept
 * in memory only (no browser storage), so a reload returns to "system".
 */
export function useTheme(pref: ThemePref = 'system'): Theme {
  const q = typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  const [systemDark, setSystemDark] = useState(q?.matches ?? false);
  useEffect(() => {
    if (!q) return;
    const on = () => setSystemDark(q.matches);
    q.addEventListener('change', on);
    return () => q.removeEventListener('change', on);
  }, [q]);
  useEffect(() => {
    const root = document.documentElement;
    if (pref === 'system') delete root.dataset.theme;
    else root.dataset.theme = pref;
  }, [pref]);
  const dark = pref === 'dark' || (pref === 'system' && systemDark);
  return dark ? DARK : LIGHT;
}
