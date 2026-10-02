/**
 * Co-listening map: which artists you play in the same sessions.
 *
 *  - Session: qualifying plays with no gap over 30 minutes (same rule as Habits).
 *  - Association between two artists: Ochiai coefficient, sessions with both divided by the
 *    geometric mean of each artist's session count (0-1). Pairs need 2+ shared sessions.
 *  - Graph: each artist links to its strongest associations (k nearest neighbours).
 *  - Groups: Louvain modularity communities on that graph. Stability is the adjusted Rand index
 *    between runs that visit nodes in different random orders (1 = identical groups).
 *  - Positions: groups are packed as round islands (related groups side by side), artists laid
 *    out inside by their own links. Distances are only suggestive; links and groups are what
 *    the data supports.
 *  - Bridges: artists whose links spread across groups (participation coefficient).
 */
import { rng, type PatternInput } from './monthly';

export const SESSION_GAP = 30 * 60_000;
export const MAP_ARTISTS = 150;
const KNN = 5;
const MIN_SHARED = 2;

function sessionsOf(input: PatternInput, plays: number[]): number[][] {
  const { store } = input;
  const out: number[][] = [];
  let cur = new Set<number>();
  let end = -Infinity;
  for (const i of plays) {
    const t = store.endedAt[i];
    const start = t - store.msPlayed[i];
    if (start - end > SESSION_GAP && cur.size) { out.push([...cur]); cur = new Set(); }
    cur.add(store.artist[i]);
    end = Math.max(end, t);
  }
  if (cur.size) out.push([...cur]);
  return out;
}

/** Louvain community detection (modularity, weighted, undirected). Node visit order is configurable. */
export function louvain(n: number, edges: Array<[number, number, number]>, order: number[] = Array.from({ length: n }, (_, i) => i)): Int32Array {
  let comm = Int32Array.from({ length: n }, (_, i) => i);
  let nodes = n;
  let adj: Array<Map<number, number>> = Array.from({ length: n }, () => new Map());
  for (const [a, b, w] of edges) {
    if (a === b) continue;
    adj[a].set(b, (adj[a].get(b) ?? 0) + w);
    adj[b].set(a, (adj[b].get(a) ?? 0) + w);
  }
  let self = new Float64Array(n);
  let visit = order;
  for (let level = 0; level < 10; level++) {
    const deg = new Float64Array(nodes);
    let m2 = 0;
    for (let v = 0; v < nodes; v++) { let d = self[v] * 2; for (const w of adj[v].values()) d += w; deg[v] = d; m2 += d; }
    if (m2 === 0) break;
    const c = Int32Array.from({ length: nodes }, (_, i) => i);
    const tot = Float64Array.from(deg);
    let moved = false;
    for (let pass = 0; pass < 20; pass++) {
      let any = false;
      for (const v of visit) {
        const cv = c[v];
        const links = new Map<number, number>();
        for (const [u, w] of adj[v]) links.set(c[u], (links.get(c[u]) ?? 0) + w);
        tot[cv] -= deg[v];
        let best = cv;
        let bestGain = (links.get(cv) ?? 0) - tot[cv] * deg[v] / m2;
        for (const [cc, w] of links) {
          const g = w - tot[cc] * deg[v] / m2;
          if (g > bestGain + 1e-12) { bestGain = g; best = cc; }
        }
        tot[best] += deg[v];
        if (best !== cv) { c[v] = best; any = true; moved = true; }
      }
      if (!any) break;
    }
    if (!moved) break;
    // Relabel and aggregate.
    const ids = new Map<number, number>();
    for (let v = 0; v < nodes; v++) if (!ids.has(c[v])) ids.set(c[v], ids.size);
    const next = ids.size;
    comm = comm.map((x) => ids.get(c[x])!);
    const nadj: Array<Map<number, number>> = Array.from({ length: next }, () => new Map());
    const nself = new Float64Array(next);
    for (let v = 0; v < nodes; v++) {
      const a = ids.get(c[v])!;
      nself[a] += self[v];
      for (const [u, w] of adj[v]) {
        const b = ids.get(c[u])!;
        if (a === b) nself[a] += w / 2;
        else nadj[a].set(b, (nadj[a].get(b) ?? 0) + w);
      }
    }
    adj = nadj; self = nself; nodes = next;
    visit = Array.from({ length: nodes }, (_, i) => i);
    if (next === 1) break;
  }
  return comm;
}

/** Adjusted Rand index between two labelings of the same nodes. */
export function adjustedRand(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const n = a.length;
  if (n < 2) return 1;
  const table = new Map<string, number>(), ra = new Map<number, number>(), rb = new Map<number, number>();
  for (let i = 0; i < n; i++) {
    const k = `${a[i]},${b[i]}`;
    table.set(k, (table.get(k) ?? 0) + 1);
    ra.set(a[i], (ra.get(a[i]) ?? 0) + 1);
    rb.set(b[i], (rb.get(b[i]) ?? 0) + 1);
  }
  const c2 = (x: number) => (x * (x - 1)) / 2;
  let idx = 0, sa = 0, sb = 0;
  for (const v of table.values()) idx += c2(v);
  for (const v of ra.values()) sa += c2(v);
  for (const v of rb.values()) sb += c2(v);
  const exp = (sa * sb) / c2(n);
  const max = (sa + sb) / 2;
  return max === exp ? 1 : (idx - exp) / (max - exp);
}

/**
 * Two-level layout that keeps each group a compact, round island:
 *  1. Group islands: each group gets a disc big enough for its circles; discs attract in
 *     proportion to the links between groups (so related groups sit side by side), repel when they
 *     overlap, and are pulled gently to the middle.
 *  2. Inside each disc, a force layout of that group's own links, with the most-listened
 *     artists starting in the middle; nodes stay inside their disc.
 *  3. Artists in no group sit next to the group they link to most; overlaps are then removed.
 * Deterministic for a seed. `radii` are node radii in layout units; output spans [0, 1] and
 * `radiusScale` converts those radii to output units.
 */
function clusterLayout(n: number, edges: Array<[number, number, number]>, group: ArrayLike<number>, radii: ArrayLike<number>, weight: ArrayLike<number>, seed = 7): { pos: Array<[number, number]>; radiusScale: number } {
  if (n === 0) return { pos: [], radiusScale: 1 };
  if (n === 1) return { pos: [[0.5, 0.5]], radiusScale: 1 };
  const r = rng(seed);
  const gap = 0.006;
  const x = new Float64Array(n), y = new Float64Array(n);
  const adj: Array<Array<[number, number]>> = Array.from({ length: n }, () => []);
  for (const [a, b, w] of edges) { adj[a].push([b, w]); adj[b].push([a, w]); }
  // Singletons join the group they link to most for placement (they keep group -1 for colour).
  const place = Array.from({ length: n }, (_, i) => {
    if (group[i] >= 0) return group[i];
    const tally = new Map<number, number>();
    for (const [j, w] of adj[i]) if (group[j] >= 0) tally.set(group[j], (tally.get(group[j]) ?? 0) + w);
    const best = [...tally].sort((p, q) => q[1] - p[1] || p[0] - q[0])[0];
    return best ? best[0] : -1 - i;
  });
  const gids = [...new Set(place)].sort((p, q) => p - q);
  const G = gids.length;
  const gi = new Map(gids.map((g, k) => [g, k]));
  const members: number[][] = gids.map(() => []);
  for (let i = 0; i < n; i++) members[gi.get(place[i])!].push(i);
  const R = members.map((m) => Math.sqrt(m.reduce((s, i) => s + (radii[i] + gap) ** 2, 0)) * 1.9 + gap);
  // Inter-group link weights.
  const gw: number[][] = Array.from({ length: G }, () => new Array(G).fill(0));
  for (const [a, b, w] of edges) { const p = gi.get(place[a])!, q = gi.get(place[b])!; if (p !== q) { gw[p][q] += w; gw[q][p] += w; } }
  const gwMax = Math.max(1e-9, ...gw.flat());
  // 1. Islands, biggest first on a sunflower spiral.
  const order = members.map((_, k) => k).sort((p, q) => R[q] - R[p] || p - q);
  const cx = new Float64Array(G), cy = new Float64Array(G);
  const unit = Math.max(...R);
  order.forEach((k, rank) => { const ang = rank * 2.39996, rad = unit * 1.6 * Math.sqrt(rank); cx[k] = Math.cos(ang) * rad; cy[k] = Math.sin(ang) * rad; });
  for (let it = 0; it < 500; it++) {
    const fx = new Float64Array(G), fy = new Float64Array(G);
    for (let p = 0; p < G; p++) for (let q = p + 1; q < G; q++) {
      const dx = cx[p] - cx[q], dy = cy[p] - cy[q];
      const d = Math.sqrt(dx * dx + dy * dy) || 1e-6;
      const want = R[p] + R[q] + unit * 0.3;
      let f = 0;
      if (d < want) f = (want - d) * 0.5;
      else f = -(d - want) * 0.02 * (0.15 + gw[p][q] / gwMax);
      fx[p] += (dx / d) * f; fy[p] += (dy / d) * f; fx[q] -= (dx / d) * f; fy[q] -= (dy / d) * f;
    }
    for (let p = 0; p < G; p++) { cx[p] += fx[p] - cx[p] * 0.01; cy[p] += fy[p] - cy[p] * 0.01; }
  }
  // 2. Inside each island.
  for (let k = 0; k < G; k++) {
    const m = [...members[k]].sort((p, q) => weight[q] - weight[p] || p - q);
    const local = new Map(m.map((i, t) => [i, t]));
    m.forEach((i, t) => {
      const ang = t * 2.39996 + r() * 0.2, rad = R[k] * 0.85 * Math.sqrt((t + 0.5) / m.length);
      x[i] = cx[k] + Math.cos(ang) * rad; y[i] = cy[k] + Math.sin(ang) * rad;
    });
    if (m.length < 2) continue;
    const kk = R[k] * Math.sqrt(1 / m.length) * 0.9;
    let temp = R[k] * 0.15;
    for (let it = 0; it < 250; it++) {
      const fx = new Float64Array(m.length), fy = new Float64Array(m.length);
      for (let p = 0; p < m.length; p++) for (let q = p + 1; q < m.length; q++) {
        const dx = x[m[p]] - x[m[q]], dy = y[m[p]] - y[m[q]];
        const d2 = Math.max(dx * dx + dy * dy, 1e-8);
        const f = (kk * kk) / d2;
        fx[p] += dx * f; fy[p] += dy * f; fx[q] -= dx * f; fy[q] -= dy * f;
      }
      for (let p = 0; p < m.length; p++) for (const [j, w] of adj[m[p]]) {
        const q = local.get(j);
        if (q === undefined || q < p) continue;
        const dx = x[m[p]] - x[j], dy = y[m[p]] - y[j];
        const d = Math.sqrt(dx * dx + dy * dy) || 1e-9;
        const f = (d / kk) * (0.4 + w);
        fx[p] -= dx * f; fy[p] -= dy * f; fx[q] += dx * f; fy[q] += dy * f;
      }
      for (let p = 0; p < m.length; p++) {
        const i = m[p];
        // Pull toward the island centre, stronger for big artists.
        fx[p] -= (x[i] - cx[k]) * (0.3 + 2 * weight[i]) / kk; fy[p] -= (y[i] - cy[k]) * (0.3 + 2 * weight[i]) / kk;
        const d = Math.sqrt(fx[p] * fx[p] + fy[p] * fy[p]) || 1e-9;
        const step = Math.min(d * kk * 0.02, temp);
        x[i] += (fx[p] / d) * step; y[i] += (fy[p] / d) * step;
        const ex = x[i] - cx[k], ey = y[i] - cy[k], ed = Math.sqrt(ex * ex + ey * ey), lim = Math.max(0, R[k] - radii[i] - gap);
        if (ed > lim) { x[i] = cx[k] + (ex / ed) * lim; y[i] = cy[k] + (ey / ed) * lim; }
      }
      temp = Math.max(R[k] * 0.002, temp * 0.985);
    }
  }
  // 3. Remove remaining overlaps.
  for (let pass = 0; pass < 150; pass++) {
    let moved = false;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      const dx = x[i] - x[j], dy = y[i] - y[j];
      const d = Math.sqrt(dx * dx + dy * dy) || 1e-6;
      const min = radii[i] + radii[j] + gap;
      if (d < min) {
        const push = (min - d) / 2;
        x[i] += (dx / d) * push; y[i] += (dy / d) * push; x[j] -= (dx / d) * push; y[j] -= (dy / d) * push;
        moved = true;
      }
    }
    if (!moved) break;
  }
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (let i = 0; i < n; i++) {
    x0 = Math.min(x0, x[i] - radii[i]); x1 = Math.max(x1, x[i] + radii[i]);
    y0 = Math.min(y0, y[i] - radii[i]); y1 = Math.max(y1, y[i] + radii[i]);
  }
  const span = Math.max(x1 - x0, y1 - y0) || 1;
  const offX = (1 - (x1 - x0) / span) / 2, offY = (1 - (y1 - y0) / span) / 2;
  return {
    pos: Array.from({ length: n }, (_, i) => [(x[i] - x0) / span + offX, (y[i] - y0) / span + offY] as [number, number]),
    radiusScale: 1 / span,
  };
}

export interface MapNode {
  id: number; name: string; x: number; y: number; group: number; ms: number; sessions: number;
  /** Year of the first-ever qualifying play. */
  firstYear: number;
  /** Lifecycle label, when the artist has enough listening to classify. */
  kind?: string | null;
  /** Share of links that go outside the node's own group (participation coefficient, 0-1). */
  bridge: number;
  /** Strongest partners on the map: [node index, sessions together, association 0-1]. */
  partners: Array<[number, number, number]>;
}
export interface Neighbour { id: number; name: string; together: number; score: number }

export interface ColistenResult {
  nodes: MapNode[];
  edges: Array<[number, number, number]>;
  /** Groups with 2+ artists, largest listening first; `index` is the node `group` value. */
  groups: Array<{ index: number; label: string; artists: number; ms: number }>;
  stability: number;
  sessions: number;
  /** Multiply `nodeRadius` by this to get radii in map units (the layout was packed at that size). */
  radiusScale: number;
  /** Strongest associations per artist (store id), for the artist panel. */
  neighbours: Map<number, Neighbour[]>;
}

/** Radius of a node in layout units (the map spans 1), by listening; the UI draws the same size. */
export function nodeRadius(ms: number, maxMs: number): number {
  return 0.006 + 0.016 * Math.sqrt(ms / Math.max(1, maxMs));
}

export function colistenMap(input: PatternInput, plays: number[], size = MAP_ARTISTS): ColistenResult {
  const { store } = input;
  const sessions = sessionsOf(input, plays);
  const ms = new Float64Array(store.artistNames.length);
  for (const i of plays) ms[store.artist[i]] += store.msPlayed[i];
  const sc = new Float64Array(store.artistNames.length);
  for (const s of sessions) for (const a of s) sc[a]++;
  const chosen = Array.from({ length: ms.length }, (_, a) => a).filter((a) => sc[a] >= 3 && ms[a] > 0)
    .sort((a, b) => ms[b] - ms[a] || a - b).slice(0, size);
  const n = chosen.length;
  const idx = new Int32Array(ms.length).fill(-1);
  chosen.forEach((a, i) => (idx[a] = i));
  const co = new Map<number, number>();
  for (const s of sessions) {
    const inS = s.map((a) => idx[a]).filter((i) => i >= 0).sort((a, b) => a - b);
    for (let p = 0; p < inS.length; p++) for (let q = p + 1; q < inS.length; q++) {
      const key = inS[p] * n + inS[q];
      co.set(key, (co.get(key) ?? 0) + 1);
    }
  }
  const nbr: Array<Array<{ j: number; c: number; s: number }>> = Array.from({ length: n }, () => []);
  for (const [key, c] of co) {
    if (c < MIN_SHARED) continue;
    const a = Math.floor(key / n), b = key % n;
    const s = c / Math.sqrt(sc[chosen[a]] * sc[chosen[b]]);
    nbr[a].push({ j: b, c, s }); nbr[b].push({ j: a, c, s });
  }
  for (const l of nbr) l.sort((p, q) => q.s - p.s || q.c - p.c || p.j - q.j);
  const ekey = new Map<number, number>();
  nbr.forEach((l, a) => l.slice(0, KNN).forEach(({ j, s }) => ekey.set(Math.min(a, j) * n + Math.max(a, j), s)));
  const edges: Array<[number, number, number]> = [...ekey].map(([key, s]) => [Math.floor(key / n), key % n, Math.round(s * 1000) / 1000]);
  edges.sort((p, q) => p[0] - q[0] || p[1] - q[1]);

  const groups0 = louvain(n, edges);
  let stability = 1;
  if (n > 2 && edges.length) {
    let sum = 0;
    const runs = 4;
    for (let s = 1; s <= runs; s++) {
      const r = rng(100 + s);
      const order = Array.from({ length: n }, (_, i) => i);
      for (let i = n - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
      sum += adjustedRand(groups0, louvain(n, edges, order));
    }
    stability = sum / runs;
  }
  // Group ids by listening: 0 = biggest group. Singletons get -1.
  const gms = new Map<number, { ms: number; size: number; members: number[] }>();
  for (let i = 0; i < n; i++) {
    const g = gms.get(groups0[i]) ?? { ms: 0, size: 0, members: [] };
    g.ms += ms[chosen[i]]; g.size++; g.members.push(i);
    gms.set(groups0[i], g);
  }
  const ranked = [...gms].filter(([, g]) => g.size >= 2).sort((a, b) => b[1].ms - a[1].ms || a[0] - b[0]);
  const gid = new Map<number, number>(ranked.map(([g], r) => [g, r]));
  const groups = ranked.map(([, g], r) => ({
    index: r,
    label: g.members.sort((a, b) => ms[chosen[b]] - ms[chosen[a]]).slice(0, 3).map((i) => store.artistNames[chosen[i]]).join(' · '),
    artists: g.size, ms: g.ms,
  }));
  const groupOf = chosen.map((_, i) => gid.get(groups0[i]) ?? -1);
  const maxMs = Math.max(1, ...chosen.map((a) => ms[a]));
  const { pos, radiusScale } = clusterLayout(n, edges, groupOf, chosen.map((a) => nodeRadius(ms[a], maxMs)), chosen.map((a) => Math.sqrt(ms[a] / maxMs)));
  const r4 = (v: number) => Math.round(v * 10_000) / 10_000;
  // First-ever qualifying play per mapped artist (whole history, not just the range).
  const firstT = new Float64Array(n).fill(Infinity);
  for (let i = 0; i < store.length; i++) {
    const j = idx[store.artist[i]];
    if (j >= 0 && store.msPlayed[i] >= input.minMs && store.endedAt[i] < firstT[j]) firstT[j] = store.endedAt[i];
  }
  // Participation coefficient over the drawn links: 0 = all links inside its group.
  const links: Array<Map<number, number>> = Array.from({ length: n }, () => new Map());
  for (const [a, b] of edges) {
    links[a].set(groupOf[b], (links[a].get(groupOf[b]) ?? 0) + 1);
    links[b].set(groupOf[a], (links[b].get(groupOf[a]) ?? 0) + 1);
  }
  const bridge = links.map((m) => {
    let k = 0, sq = 0;
    for (const v of m.values()) { k += v; sq += v * v; }
    return k ? 1 - sq / (k * k) : 0;
  });
  const nodes: MapNode[] = chosen.map((a, i) => ({
    id: a, name: store.artistNames[a], x: r4(pos[i][0]), y: r4(pos[i][1]), group: groupOf[i], ms: ms[a], sessions: sc[a],
    firstYear: new Date(firstT[i]).getUTCFullYear(), bridge: Math.round(bridge[i] * 1000) / 1000,
    partners: nbr[i].slice(0, 8).map(({ j, c, s }) => [j, c, Math.round(s * 1000) / 1000] as [number, number, number]),
  }));
  const neighbours = new Map<number, Neighbour[]>();
  nbr.forEach((l, a) => neighbours.set(chosen[a], l.filter((x) => x.c >= 3).slice(0, 6)
    .map(({ j, c, s }) => ({ id: chosen[j], name: store.artistNames[chosen[j]], together: c, score: s }))));
  return { nodes, edges, groups, stability, sessions: sessions.length, neighbours, radiusScale: Math.round(radiusScale * 10_000) / 10_000 };
}
