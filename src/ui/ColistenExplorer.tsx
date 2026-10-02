/**
 * Interactive co-listening map: zoom and pan (Ctrl/Cmd + scroll, pinch, drag, buttons), hover to
 * light up an artist's partners, click to select, search, colour by group / discovery year /
 * lifecycle, group outlines, collision-free labels that thin out with zoom, fullscreen and SVG
 * download. Positions come from the worker (community-aware force layout); only links and groups
 * carry meaning.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { line, curveCatmullRomClosed } from 'd3-shape';
import type { Patterns } from '../core/patterns';
import { nodeRadius } from '../core/patterns';
import { useWidth } from './useWidth';
import type { Theme } from './theme';
import { fmtHours, fmtInt } from './format';
import { Segmented } from './Controls';
import { saveBlob } from './download';

type MapData = Patterns['map'];
type ColorBy = 'group' | 'year' | 'life';
type SizeBy = 'hours' | 'sessions';
interface View { k: number; tx: number; ty: number }

const FONT = "system-ui, -apple-system, 'Segoe UI', sans-serif";
const LIFE_COLOR: Record<string, number> = { evergreen: 2, slowburn: 1, flash: 4, seasonal: 3, steady: 0, faded: -1, new: 6 };
const LIFE_NAME: Record<string, string> = { evergreen: 'Evergreen', slowburn: 'Slow burn', flash: 'Flash', seasonal: 'Seasonal', steady: 'Steady', faded: 'Faded', new: 'New' };

function hexMix(a: string, b: string, t: number) {
  const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const x = p(a), y = p(b);
  return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('');
}

function ramp(stops: string[], t: number) {
  const u = Math.max(0, Math.min(1, t)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(u));
  return hexMix(stops[i], stops[i + 1], u - i);
}

/** Convex hull (monotone chain). */
function hull(pts: Array<[number, number]>): Array<[number, number]> {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o: number[], a: number[], b: number[]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo: Array<[number, number]> = [], hi: Array<[number, number]> = [];
  for (const q of p) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (const q of [...p].reverse()) { while (hi.length >= 2 && cross(hi[hi.length - 2], hi[hi.length - 1], q) <= 0) hi.pop(); hi.push(q); }
  return [...lo.slice(0, -1), ...hi.slice(0, -1)];
}

const closedCurve = line<[number, number]>().curve(curveCatmullRomClosed.alpha(0.5));

export function ColistenExplorer({ map, theme, onOpenArtist, mapSize, onMapSize }: {
  map: MapData; theme: Theme; onOpenArtist?: (id: number) => void; mapSize?: number; onMapSize?: (n: number) => void;
}) {
  const shellRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [areaRef, W] = useWidth<HTMLDivElement>();
  const [full, setFull] = useState(false);
  const [view, setView] = useState<View>({ k: 1, tx: 0, ty: 0 });
  const viewRef = useRef(view);
  viewRef.current = view;
  const [hover, setHover] = useState<number | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [focusGroup, setFocusGroup] = useState<number | null>(null);
  const [colorBy, setColorBy] = useState<ColorBy>('group');
  const [sizeBy, setSizeBy] = useState<SizeBy>('hours');
  const [query, setQuery] = useState('');
  const [hint, setHint] = useState(false);
  const { nodes, edges, groups } = map;

  // The map fills the card width and (almost) the window height; the clusters are fitted and
  // centred in it whatever their overall shape.
  // Inside an iframe the window height follows our own content, so it cannot size the map.
  const winH = typeof window === 'undefined' || window.self !== window.top ? 10_000 : window.innerHeight;
  const H = full ? Math.max(360, winH - 90) : W < 600 ? 460 : Math.round(Math.max(520, Math.min(winH - 120, W * 0.68, 900)));
  const pad = W < 600 ? 34 : 56;
  const ext = useMemo(() => {
    const xs = nodes.map((n) => n.x), ys = nodes.map((n) => n.y);
    return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
  }, [nodes]);
  const bw = Math.max(0.05, ext.x1 - ext.x0), bh = Math.max(0.05, ext.y1 - ext.y0);
  const s0 = Math.max(10, Math.min((W - 2 * pad) / bw, (H - 2 * pad) / bh));
  const ox = (W - bw * s0) / 2 - ext.x0 * s0, oy = (H - bh * s0) / 2 - ext.y0 * s0;
  const overlay = W >= 720;
  const bx = (n: { x: number }) => ox + n.x * s0;
  const by = (n: { y: number }) => oy + n.y * s0;
  const sx = (n: { x: number }) => view.tx + view.k * bx(n);
  const sy = (n: { y: number }) => view.ty + view.k * by(n);
  const maxMs = useMemo(() => Math.max(1, ...nodes.map((n) => n.ms)), [nodes]);
  const maxSessions = useMemo(() => Math.max(1, ...nodes.map((n) => n.sessions)), [nodes]);
  const rOf = (i: number) => (sizeBy === 'hours' ? nodeRadius(nodes[i].ms, maxMs) : nodeRadius(nodes[i].sessions, maxSessions)) * map.radiusScale * s0 * Math.sqrt(view.k);

  const years = useMemo(() => { const ys = nodes.map((n) => n.firstYear); return [Math.min(...ys), Math.max(...ys)]; }, [nodes]);
  const yearStops = theme.name === 'dark' ? ['#9085e9', '#3987e5', '#199e70', '#c98500', '#d95926'] : ['#4a3aa7', '#2a78d6', '#1baf7a', '#eda100', '#eb6834'];
  const groupColor = (g: number) => (g >= 0 ? theme.series[g % theme.series.length] : theme.other);
  const colorOf = (i: number) => {
    const n = nodes[i];
    if (colorBy === 'year') return ramp(yearStops, years[1] > years[0] ? (n.firstYear - years[0]) / (years[1] - years[0]) : 0.5);
    if (colorBy === 'life') { const s = n.kind ? LIFE_COLOR[n.kind] : undefined; return s === undefined ? theme.emptyBand === '#f0efec' ? '#d9d8d2' : '#3a3a37' : s < 0 ? theme.other : theme.series[s]; }
    return groupColor(n.group);
  };

  // ---- view changes -------------------------------------------------------------------------
  const anim = useRef<number | null>(null);
  const animateTo = useCallback((to: View) => {
    if (anim.current) cancelAnimationFrame(anim.current);
    const from = viewRef.current;
    const t0 = performance.now();
    const step = (t: number) => {
      const u = Math.min(1, (t - t0) / 380);
      const e = 1 - Math.pow(1 - u, 3);
      setView({ k: from.k + (to.k - from.k) * e, tx: from.tx + (to.tx - from.tx) * e, ty: from.ty + (to.ty - from.ty) * e });
      if (u < 1) anim.current = requestAnimationFrame(step);
    };
    anim.current = requestAnimationFrame(step);
  }, []);
  const zoomAt = useCallback((px: number, py: number, f: number, animate = false) => {
    const v = viewRef.current;
    const k = Math.max(0.6, Math.min(14, v.k * f));
    const next = { k, tx: px - (px - v.tx) * (k / v.k), ty: py - (py - v.ty) * (k / v.k) };
    if (animate) animateTo(next); else setView(next);
  }, [animateTo]);
  /** Zoom to show these nodes, centred in the map (or in the part not covered by the card). */
  const fitTo = useCallback((idx: number[], maxK = 6, rightInset = 0) => {
    if (!idx.length) return;
    const xs = idx.map((i) => ox + nodes[i].x * s0), ys = idx.map((i) => oy + nodes[i].y * s0);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const w = W - rightInset;
    const k = Math.max(1, Math.min(maxK, Math.min(w / (x1 - x0 + 160), H / (y1 - y0 + 140))));
    animateTo({ k, tx: w / 2 - k * (x0 + x1) / 2, ty: H / 2 - k * (y0 + y1) / 2 });
  }, [nodes, ox, oy, s0, W, H, animateTo]);
  const reset = () => { setFocusGroup(null); animateTo({ k: 1, tx: 0, ty: 0 }); };
  useEffect(() => { setView({ k: 1, tx: 0, ty: 0 }); setSelected(null); setFocusGroup(null); }, [map]);

  // Wheel: zoom with Ctrl/Cmd (and trackpad pinch, which sends ctrlKey); plain scrolling scrolls the page.
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    let t: ReturnType<typeof setTimeout> | undefined;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey) && !document.fullscreenElement) { setHint(true); clearTimeout(t); t = setTimeout(() => setHint(false), 1400); return; }
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.002)));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => { el.removeEventListener('wheel', onWheel); clearTimeout(t); };
  }, [zoomAt]);

  // Drag to pan, two pointers to pinch.
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const drag = useRef<{ x: number; y: number; moved: number; pinch: number | null; node: number | null } | null>(null);
  const local = (e: RPointerEvent) => { const r = svgRef.current!.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const onDown = (e: RPointerEvent<SVGSVGElement>) => {
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, local(e));
    const p = local(e);
    // Pointer capture retargets later events to the svg, so remember which node was pressed now.
    const hit = (e.target as Element).closest?.('[data-node]');
    drag.current = { x: p.x, y: p.y, moved: 0, pinch: null, node: hit ? Number(hit.getAttribute('data-node')) : null };
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      drag.current.pinch = Math.hypot(a.x - b.x, a.y - b.y);
    }
  };
  const onMove = (e: RPointerEvent<SVGSVGElement>) => {
    if (!drag.current || !pointers.current.has(e.pointerId)) return;
    const p = local(e);
    pointers.current.set(e.pointerId, p);
    if (pointers.current.size === 2 && drag.current.pinch) {
      const [a, b] = [...pointers.current.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, d / drag.current.pinch);
      drag.current.pinch = d;
      drag.current.moved += 10;
      return;
    }
    const dx = p.x - drag.current.x, dy = p.y - drag.current.y;
    drag.current.moved += Math.abs(dx) + Math.abs(dy);
    drag.current.x = p.x; drag.current.y = p.y;
    if (drag.current.moved > 3) setView((v) => ({ ...v, tx: v.tx + dx, ty: v.ty + dy }));
  };
  const onUp = (e: RPointerEvent<SVGSVGElement>) => {
    pointers.current.delete(e.pointerId);
    const d = drag.current;
    if (pointers.current.size === 0) {
      if (d && d.moved <= 3) {
        if (d.node !== null) setSelected(selected === d.node ? null : d.node);
        else { setSelected(null); setFocusGroup(null); }
      }
      drag.current = null;
    }
  };

  // Fullscreen
  useEffect(() => {
    const on = () => setFull(document.fullscreenElement === shellRef.current);
    document.addEventListener('fullscreenchange', on);
    return () => document.removeEventListener('fullscreenchange', on);
  }, []);
  const canFull = typeof document !== 'undefined' && document.fullscreenEnabled;
  const toggleFull = () => { if (document.fullscreenElement) void document.exitFullscreen(); else void shellRef.current?.requestFullscreen(); };

  const download = () => {
    const svg = svgRef.current;
    if (!svg) return;
    const clone = svg.cloneNode(true) as SVGSVGElement;
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    bg.setAttribute('width', '100%'); bg.setAttribute('height', '100%'); bg.setAttribute('fill', theme.surface);
    clone.insertBefore(bg, clone.firstChild);
    saveBlob(new Blob([new XMLSerializer().serializeToString(clone)], { type: 'image/svg+xml' }), 'listening-map.svg');
  };

  // ---- derived highlight state ----------------------------------------------------------------
  const active = hover ?? selected;
  const neighbours = useMemo(() => {
    if (active === null) return null;
    return new Set<number>([active, ...nodes[active].partners.map((p) => p[0])]);
  }, [active, nodes]);
  const q = query.trim().toLowerCase();
  const matches = useMemo(() => (q.length >= 2 ? new Set(nodes.map((n, i) => (n.name.toLowerCase().includes(q) ? i : -1)).filter((i) => i >= 0)) : null), [q, nodes]);
  const dim = (i: number) => {
    if (neighbours) return !neighbours.has(i);
    if (matches) return !matches.has(i);
    if (focusGroup !== null) return nodes[i].group !== focusGroup;
    return false;
  };
  const pick = (i: number) => { setSelected(i); setQuery(''); fitTo([i, ...nodes[i].partners.map((p) => p[0])], 4, overlay ? 324 : 0); };
  const onSearch = (v: string) => {
    setQuery(v);
    const exact = nodes.findIndex((n) => n.name.toLowerCase() === v.trim().toLowerCase());
    if (exact >= 0) pick(exact);
  };

  // ---- geometry for this frame -----------------------------------------------------------------
  const P = nodes.map((n, i) => ({ x: sx(n), y: sy(n), r: rOf(i) }));
  const groupShapes = groups.map((g) => {
    const members = nodes.map((n, i) => (n.group === g.index ? i : -1)).filter((i) => i >= 0);
    if (members.length < 3) return null;
    const cx = members.reduce((a, i) => a + P[i].x, 0) / members.length, cy = members.reduce((a, i) => a + P[i].y, 0) / members.length;
    const dist = members.map((i) => Math.hypot(P[i].x - cx, P[i].y - cy)).sort((a, b) => a - b);
    const lim = dist[dist.length >> 1] * 2.4 + 1;
    const core = members.filter((i) => Math.hypot(P[i].x - cx, P[i].y - cy) <= lim);
    const pts: Array<[number, number]> = [];
    for (const i of core) for (let a = 0; a < 8; a++) pts.push([P[i].x + Math.cos(a * Math.PI / 4) * (P[i].r + 12), P[i].y + Math.sin(a * Math.PI / 4) * (P[i].r + 12)]);
    const h = hull(pts);
    const top = Math.min(...h.map((p) => p[1]));
    const left = Math.min(...h.map((p) => p[0])), right = Math.max(...h.map((p) => p[0]));
    // Short label on narrow maps; always kept inside the map.
    const text = g.label.split(' · ').slice(0, W < 600 ? 1 : 2).join(' · ');
    const tw = text.length * 7.2 + 8;
    const lx = Math.min(W - tw / 2 - 4, Math.max(tw / 2 + 4, (left + right) / 2));
    return { g, d: closedCurve(h) ?? '', lx, ly: Math.max(16, top - 6), text, tw, members };
  });
  const showGroupLabels = view.k < 2.4;
  const labelled = useMemo(() => {
    const boxes: Array<[number, number, number, number]> = [];
    if (showGroupLabels && colorBy === 'group' && !neighbours) for (const s of groupShapes) if (s) boxes.push([s.lx - s.tw / 2 - 6, s.ly - 15, s.lx + s.tw / 2 + 6, s.ly + 3]);
    const order = nodes.map((_, i) => i).sort((a, b) => {
      const pa = (a === active ? 4 : 0) + (a === selected ? 4 : 0) + (neighbours?.has(a) ? 2 : 0) + (matches?.has(a) ? 3 : 0);
      const pb = (b === active ? 4 : 0) + (b === selected ? 4 : 0) + (neighbours?.has(b) ? 2 : 0) + (matches?.has(b) ? 3 : 0);
      return pb - pa || nodes[b].ms - nodes[a].ms;
    });
    const out = new Set<number>();
    for (const i of order) {
      const p = P[i];
      if (p.x < -40 || p.x > W + 40 || p.y < -20 || p.y > H + 20) continue;
      if (dim(i) && !(neighbours?.has(i))) continue;
      const w = Math.min(26, nodes[i].name.length) * 6.6 + 10;
      const box: [number, number, number, number] = [p.x - w / 2, p.y - p.r - 19, p.x + w / 2, p.y - p.r - 1];
      const forced = i === active || i === selected;
      if (!forced && boxes.some((b) => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1])) continue;
      boxes.push(box);
      out.add(i);
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, W, H, nodes, active, selected, neighbours, matches, focusGroup, sizeBy, showGroupLabels, colorBy]);

  const sel = selected !== null ? nodes[selected] : null;
  const groupLabel = (g: number) => groups.find((x) => x.index === g)?.label ?? 'Not in a group';
  const bridges = useMemo(() => nodes.map((n, i) => ({ n, i })).filter(({ n }) => n.group >= 0 && n.bridge >= 0.3 && n.partners.length >= 3)
    .sort((a, b) => b.n.bridge * Math.log(1 + b.n.sessions) - a.n.bridge * Math.log(1 + a.n.sessions)).slice(0, 6), [nodes]);
  const linkedGroups = (i: number) => [...new Set(nodes[i].partners.map((p) => nodes[p[0]].group).filter((g) => g >= 0 && g !== nodes[i].group))];
  const maxGroupMs = Math.max(1, ...groups.map((g) => g.ms));

  const selectionPanel = sel && selected !== null ? (
      <div data-testid="map-selection">
        <div className="mapx-side-head">
          <h3>{sel.name}</h3>
          <button type="button" className="btn ghost" onClick={() => setSelected(null)} aria-label="Clear selection">×</button>
        </div>
        <p className="chips">
          <span className="chip"><i className="swatch" style={{ background: groupColor(sel.group) }} /> {sel.group >= 0 ? `Group: ${groupLabel(sel.group).split(' · ')[0]}…` : 'Not in a group'}</span>
          {sel.kind && <span className="chip">{LIFE_NAME[sel.kind]}</span>}
        </p>
        <div className="mini-stats">
          <div><span className="stat-label">Listening</span><b>{fmtHours(sel.ms)}</b></div>
          <div><span className="stat-label">Sessions</span><b>{fmtInt(sel.sessions)}</b></div>
          <div><span className="stat-label">First played</span><b>{sel.firstYear}</b></div>
        </div>
        {linkedGroups(selected).length > 0 && <p className="muted small">Also linked to: {linkedGroups(selected).map((g) => groupLabel(g).split(' · ')[0]).join(', ')}</p>}
        <h4 className="sub-h">Played most often with</h4>
        <p className="muted small">Ranked by how consistently you play them together, relative to how often you play each.</p>
        <ol className="partner-list">
          {sel.partners.map(([j, c, s]) => (
            <li key={j}>
              <button type="button" className="link-like" onClick={() => pick(j)}>{nodes[j].name}</button>
              <span className="partner-bar"><span style={{ width: `${(s / (sel.partners[0]?.[2] || 1)) * 100}%`, background: groupColor(nodes[j].group) }} /></span>
              <span className="muted small" title={`${fmtInt(c)} of ${sel.name}'s ${fmtInt(sel.sessions)} sessions also had ${nodes[j].name}`}>{fmtInt(c)} sessions · {Math.round((c / sel.sessions) * 100)}% of {sel.name.length > 14 ? 'theirs' : `${sel.name}'s`}</span>
            </li>
          ))}
        </ol>
        {onOpenArtist && <button type="button" className="btn" onClick={() => onOpenArtist(sel.id)}>Open artist details</button>}
      </div>
  ) : null;

  return (
    <div ref={shellRef} className={`mapx${full ? ' full' : ''}`} data-testid="colisten-explorer">
      <div className="mapx-tools">
        <input type="search" className="mapx-search" placeholder="Find an artist on the map…" aria-label="Find an artist on the map" list="mapx-names"
          value={query} onChange={(e) => onSearch(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && matches?.size) pick([...matches][0]); if (e.key === 'Escape') setQuery(''); }} />
        <datalist id="mapx-names">{nodes.map((n) => <option key={n.id} value={n.name} />)}</datalist>
        <Segmented<ColorBy> label="Colour by" value={colorBy} onChange={setColorBy} options={[['group', 'Group'], ['year', 'Discovered'], ['life', 'Lifecycle']]} />
        <Segmented<SizeBy> label="Size by" value={sizeBy} onChange={setSizeBy} options={[['hours', 'Hours'], ['sessions', 'Sessions']]} />
        {onMapSize && mapSize !== undefined && (
          <label className="control"><span className="control-label">Artists</span>
            <select value={mapSize} onChange={(e) => onMapSize(Number(e.target.value))} aria-label="Artists on the map">
              {[75, 150, 250].map((n) => <option key={n} value={n}>{n}</option>)}
            </select></label>
        )}
        <div className="mapx-buttons">
          <button type="button" className="btn ghost" aria-label="Zoom in" onClick={() => zoomAt(W / 2, H / 2, 1.6, true)}>+</button>
          <button type="button" className="btn ghost" aria-label="Zoom out" onClick={() => zoomAt(W / 2, H / 2, 1 / 1.6, true)}>−</button>
          <button type="button" className="btn ghost" onClick={reset}>Reset</button>
          {canFull && <button type="button" className="btn ghost" onClick={toggleFull}>{full ? 'Exit full screen' : 'Full screen'}</button>}
          <button type="button" className="btn ghost" onClick={download}>SVG</button>
        </div>
      </div>
      <div className="mapx-body">
        <div ref={areaRef} className="mapx-area" style={{ height: H }}>
          <svg ref={svgRef} width={W} height={H} fontFamily={FONT} role="img" className="mapx-svg" data-testid="colisten-map"
            aria-label={`Co-listening map of ${nodes.length} artists in ${groups.length} groups. Use the search box or the group list to explore.`}
            onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onPointerLeave={() => setHover(null)}
            onDoubleClick={(e) => { const r = svgRef.current!.getBoundingClientRect(); zoomAt(e.clientX - r.left, e.clientY - r.top, 1.8, true); }}>
            <g>
              {groupShapes.map((s) => s && (
                <path key={s.g.index} d={s.d} fill={colorBy === 'group' ? groupColor(s.g.index) : theme.ink2} fillOpacity={focusGroup === s.g.index ? 0.14 : focusGroup !== null || neighbours ? 0.03 : 0.07}
                  stroke={colorBy === 'group' ? groupColor(s.g.index) : theme.axis} strokeOpacity={0.35} strokeWidth={1.2} />
              ))}
            </g>
            <g>
              {edges.map(([a, b, w], k) => {
                if (neighbours && (a === active || b === active)) return null;
                const pa = P[a], pb = P[b];
                const mx = (pa.x + pb.x) / 2 - (pb.y - pa.y) * 0.12, my = (pa.y + pb.y) / 2 + (pb.x - pa.x) * 0.12;
                const same = nodes[a].group >= 0 && nodes[a].group === nodes[b].group;
                const off = dim(a) || dim(b);
                return <path key={k} d={`M${pa.x},${pa.y}Q${mx},${my} ${pb.x},${pb.y}`} fill="none"
                  stroke={same && colorBy === 'group' ? groupColor(nodes[a].group) : theme.ink2} strokeWidth={same ? 0.5 + w * 2.2 : 0.7 + w * 2.4}
                  opacity={off ? 0.05 : same ? 0.34 : 0.26} />;
              })}
              {active !== null && nodes[active].partners.map(([j, , s]) => {
                const pa = P[active], pb = P[j];
                const mx = (pa.x + pb.x) / 2 - (pb.y - pa.y) * 0.12, my = (pa.y + pb.y) / 2 + (pb.x - pa.x) * 0.12;
                return <path key={`h${j}`} d={`M${pa.x},${pa.y}Q${mx},${my} ${pb.x},${pb.y}`} fill="none" stroke={theme.ink} strokeWidth={1 + s * 5} opacity={0.55} strokeLinecap="round" />;
              })}
            </g>
            <g>
              {nodes.map((n, i) => (
                <circle key={n.id} data-node={i} data-artist={n.name} cx={P[i].x} cy={P[i].y} r={P[i].r} fill={colorOf(i)}
                  stroke={i === selected ? theme.ink : theme.surface} strokeWidth={i === selected ? 2.5 : 1.3}
                  opacity={dim(i) ? 0.16 : 1} style={{ cursor: 'pointer' }}
                  onPointerEnter={() => { if (!drag.current) setHover(i); }} onPointerLeave={() => setHover(null)}>
                  <title>{`${n.name} · ${fmtHours(n.ms)} · ${fmtInt(n.sessions)} sessions`}</title>
                </circle>
              ))}
            </g>
            {showGroupLabels && colorBy === 'group' && !neighbours && (
              <g pointerEvents="none">
                {groupShapes.map((s) => s && (
                  <text key={s.g.index} x={s.lx} y={s.ly} textAnchor="middle" fontSize={13} fontWeight={700} fill={theme.ink}
                    stroke={theme.surface} strokeWidth={4} paintOrder="stroke" opacity={focusGroup !== null && focusGroup !== s.g.index ? 0.3 : 0.9}>
                    {s.text}
                  </text>
                ))}
              </g>
            )}
            <g pointerEvents="none">
              {[...labelled].map((i) => (
                <text key={i} x={P[i].x} y={P[i].y - P[i].r - 5} textAnchor="middle" fontSize={i === active || i === selected ? 13 : 11.5}
                  fontWeight={i === active || i === selected ? 700 : 500} fill={theme.ink} stroke={theme.surface} strokeWidth={3.5} paintOrder="stroke">
                  {nodes[i].name.length > 26 ? nodes[i].name.slice(0, 25) + '…' : nodes[i].name}
                </text>
              ))}
            </g>
          </svg>
          {hint && <div className="mapx-hint" role="status">Hold Ctrl (or ⌘) and scroll to zoom, or use + and −</div>}
          {colorBy === 'year' && (
            <div className="mapx-legend"><span>First played {years[0]}</span><span className="mapx-ramp" style={{ background: `linear-gradient(90deg, ${yearStops.join(',')})` }} /><span>{years[1]}</span></div>
          )}
          {colorBy === 'life' && (
            <div className="mapx-legend">{Object.entries(LIFE_COLOR).map(([k, s]) => <span key={k}><i className="swatch" style={{ background: s < 0 ? theme.other : theme.series[s] }} /> {LIFE_NAME[k]}</span>)}</div>
          )}
        {selectionPanel && overlay && <div className="mapx-card" style={{ maxHeight: H - 24 }} aria-live="polite">
          {selectionPanel}
        </div>}
        </div>
        {selectionPanel && !overlay && <div className="mapx-under" aria-live="polite">
          {selectionPanel}
        </div>}
        <div className="mapx-under">
            <div>
              <h4 className="sub-h">Groups</h4>
              <ul className="group-list group-grid">
                {groups.map((g) => (
                  <li key={g.index}>
                    <button type="button" className={focusGroup === g.index ? 'on' : ''} aria-pressed={focusGroup === g.index}
                      onClick={() => { if (focusGroup === g.index) reset(); else { setFocusGroup(g.index); fitTo(nodes.map((n, i) => (n.group === g.index ? i : -1)).filter((i) => i >= 0), 3); } }}>
                      <span className="group-name"><i className="swatch" style={{ background: groupColor(g.index) }} /> {g.label}</span>
                      <span className="partner-bar"><span style={{ width: `${(g.ms / maxGroupMs) * 100}%`, background: groupColor(g.index) }} /></span>
                      <span className="muted small">{g.artists} artists · {fmtHours(g.ms)}</span>
                    </button>
                  </li>
                ))}
              </ul>
              {bridges.length > 0 && (
                <>
                  <h4 className="sub-h">Bridges between groups</h4>
                  <ul className="bridge-list" data-testid="bridges">
                    {bridges.map(({ n, i }) => (
                      <li key={n.id}><button type="button" className="link-like" onClick={() => pick(i)}>{n.name}</button>
                        <span className="muted small"> links {[nodes[i].group, ...linkedGroups(i)].length} groups</span></li>
                    ))}
                  </ul>
                </>
              )}
              <p className="muted small">Hover an artist to see who you play them with; click to select. Drag to move, Ctrl/⌘ + scroll or pinch to zoom.</p>
            </div>
        </div>
      </div>
    </div>
  );
}
