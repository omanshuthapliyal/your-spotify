/**
 * Session engine that owns the in-memory play store. Runs inside the Web Worker; kept free of
 * worker APIs so it can be unit-tested directly. Nothing here persists anything.
 *
 * Every query takes a `kind` (what to group by) and an optional `scope` (a genre-tree node id):
 * a scope restricts listening to artists in that branch, weighted by the share of the artist's
 * genres inside it, so branch totals never double count.
 */
import {
  aggregate, albumGrouping, artistGrouping, trackGrouping,
  type AggregateResult, type AggregateSettings, type ArtistScope, type Grouping,
} from '../core/aggregate';
import { ColorRegistry, rankByTotal } from '../core/colors';
import { buildGenreGrouping, parseGenreCsv, UNCLASSIFIED, type GenreGroupingInfo } from '../core/genres';
import { buildGenreTree, partitionBranch, pathTo, ROOT_ID, type GenreTree, type TreeData } from '../core/genreTree';
import { importFiles, type ImportAudit, type InputFile, type PlayStore } from '../core/importer';
import { enumeratePeriods } from '../core/period';
import { periodRanks, type RankResult } from '../core/ranks';
import { listeningClock, type ClockResult } from '../core/clock';
import { decadeBreakdown, parseYearInfo, resolveYears, type DecadeBucket, type YearInfo } from '../core/years';
import { albumListenMarks, wholeAlbums, type WholeAlbums } from '../core/albumListens';
import { computeInsights, type Insights } from '../core/insights';
import { offsetFn } from '../core/tz';
import { computeCorePatterns, computeTastes, DEFAULT_TASTES, MAP_ARTISTS, type LifeKind, type Neighbour, type Patterns, type PatternState, type TastesResult } from '../core/patterns';
import type { PatternInput } from '../core/patterns/monthly';
import type { KindBlock, ReportData, ReportOptions } from '../report/types';
import { plotById } from '../report/plots';

export type Kind = 'artist' | 'album' | 'track' | 'genre' | 'branch';

export interface Query {
  settings: AggregateSettings;
  kind: Kind;
  /** Genre-tree node restricting the data (null = all listening). */
  scope?: string | null;
  /** For kind 'branch': whose children are the groups (default: root). */
  branch?: string | null;
}

export interface GenreSummary {
  rows: number;
  genres: number;
  mappedArtists: number;
  totalArtists: number;
  multiGenreArtists: number;
  unmatchedCsvArtists: string[];
  nearMatches: Array<{ csv: string; exported: string[] }>;
  issues: string[];
}

export interface EnrichmentSummary {
  treeNodes: number;
  mbEdges: number;
  styleBranches: number;
  artistsWithYear: number;
  albumsWithYear: number;
}

export interface DetailRow { id?: number; name: string; sub?: string; ms: number; plays: number }

export interface Details {
  seriesKey: string;
  title: string;
  scope: string;
  ms: number;
  plays: number;
  topTracks: DetailRow[];
  topArtists: DetailRow[];
  topAlbums: DetailRow[];
  firstPlay: number | null;
  lastPlay: number | null;
}

export interface TableRow {
  id: number;
  name: string;
  sub: string;
  ms: number;
  /** Times played; for albums, album listens (sittings with 3+ different tracks). */
  plays: number;
  /** Individual track plays (equals `plays` except for albums). */
  trackPlays: number;
  share: number;
  first: number;
  last: number;
  peak: string;
  genre: string;
  year: number | null;
  distinctTracks: number;
  /** Album cover (album rows; a song's album; an artist's most-played album with a cover). */
  art?: string | null;
}

export interface TableResult {
  rows: TableRow[];
  total: number; // distinct items with listening
  includedMs: number;
}

export interface EntityInfo {
  kind: Kind;
  id: number | string;
  title: string;
  sub: string;
  ms: number;
  plays: number;
  /** Album listens (albums only). */
  albumListens?: number;
  share: number;
  rank: number | null;
  first: number | null;
  last: number | null;
  periods: Array<{ label: string; ms: number; totalMs: number }>;
  peak: string | null;
  genres: string[];
  year: number | null;
  meta: string[];
  topTracks: DetailRow[];
  topAlbums: DetailRow[];
  topArtists: DetailRow[];
  art?: string | null;
  /** Your history with this item. */
  discovered?: number | null;
  bestMonth?: { label: string; ms: number } | null;
  longestStreakDays?: number;
  yearsPlayed?: number;
  path?: Array<{ id: string; label: string }>;
  /** Artists only: played in the same sessions, and the shape of your history with them. */
  alongside?: Neighbour[];
  lifecycle?: LifeKind | null;
  children?: Array<{ id: string; label: string; ms: number; kind: string }>;
}

export interface WholeAlbumsResult extends Omit<WholeAlbums, 'rows'> {
  rows: Array<WholeAlbums['rows'][number] & { name: string; artist: string; art: string | null }>;
}

export interface Summary {
  plays: number;
  ms: number;
  artists: number;
  albums: number;
  tracks: number;
  first: number | null;
  last: number | null;
  days: number;
  activeDays: number;
}

export interface SearchHit { kind: 'artist' | 'album' | 'track' | 'genre'; id: number | string; name: string; sub: string; ms: number; art?: string | null }

export interface TreeNodeSummary {
  id: string;
  label: string;
  kind: 'genre' | 'style' | 'root';
  parents: string[];
  children: string[];
  ms: number;
  share: number;
  genres: number;
  artists: number;
  mapped: boolean;
  /** Root only: listening that has a genre (the rest is Unclassified). */
  classifiedMs?: number;
}

export class Engine {
  private store: PlayStore | null = null;
  private groupings = new Map<string, Grouping>();
  private registries = new Map<string, ColorRegistry>();
  private genre: GenreGroupingInfo | null = null;
  private artistGenres: Array<Array<[string, number]>> = [];
  private treeData: TreeData | null = null;
  private tree: GenreTree | null = null;
  private yearInfo: YearInfo | null = null;
  private years: { artist: Array<number | null>; album: Array<number | null> } | null = null;
  private scopes = new Map<string, Float64Array>();
  private last = new Map<string, AggregateResult>();
  private nodeIndex = new Map<string, number>();
  private marks = new Map<number, Uint8Array>();
  private artIndex: Record<string, string | null> | null = null;
  private albumArt: Array<string | null> = [];
  private trackAlbumArt: Array<string | null> = [];
  private artistArt: Array<string | null> = [];

  /** Cover index from `npm run covers` (key: artist + NUL + album). Kept across imports. */
  setArt(index: Record<string, string | null> | null) {
    this.artIndex = index;
    this.resolveArt();
  }

  private resolveArt() {
    const store = this.store;
    if (!store || !this.artIndex) { this.albumArt = []; this.trackAlbumArt = []; this.artistArt = []; return; }
    const idx = this.artIndex;
    this.albumArt = store.albumNames.map((n, i) => idx[`${store.artistNames[store.albumArtist[i]]}\u0000${n}`] ?? null);
    // A song's cover: its most-played album. An artist's: their most-played album that has a cover.
    const trackAlbum = new Map<number, Map<number, number>>();
    const artistAlbum = new Map<number, Map<number, number>>();
    for (let i = 0; i < store.length; i++) {
      const t = store.track[i], al = store.album[i], a = store.artist[i], m = store.msPlayed[i];
      const tm = trackAlbum.get(t) ?? new Map(); tm.set(al, (tm.get(al) ?? 0) + m); trackAlbum.set(t, tm);
      if (this.albumArt[al]) { const am = artistAlbum.get(a) ?? new Map(); am.set(al, (am.get(al) ?? 0) + m); artistAlbum.set(a, am); }
    }
    const best = (m: Map<number, number> | undefined) => { let k = -1, v = -1; m?.forEach((vv, kk) => { if (vv > v) { v = vv; k = kk; } }); return k; };
    this.trackAlbumArt = store.trackNames.map((_, t) => { const al = best(trackAlbum.get(t)); return al >= 0 ? this.albumArt[al] : null; });
    this.artistArt = store.artistNames.map((_, a) => { const al = best(artistAlbum.get(a)); return al >= 0 ? this.albumArt[al] : null; });
  }

  private artFor(kind: Kind, id: number): string | null {
    if (kind === 'album') return this.albumArt[id] ?? null;
    if (kind === 'track') return this.trackAlbumArt[id] ?? null;
    if (kind === 'artist') return this.artistArt[id] ?? null;
    return null;
  }

  /** Album-listen marks for the current minimum-play filter (cached). */
  private albumMarks(minMs: number): Uint8Array {
    let m = this.marks.get(minMs);
    if (!m) {
      m = albumListenMarks(this.requireStore(), minMs);
      if (this.marks.size > 6) this.marks.clear();
      this.marks.set(minMs, m);
    }
    return m;
  }

  private countFor(kind: Kind, settings: AggregateSettings): Uint8Array | null {
    return kind === 'album' ? this.albumMarks(settings.minMs) : null;
  }

  async import(files: InputFile[], onProgress?: (done: number, total: number, label: string) => void): Promise<ImportAudit> {
    this.reset();
    const { audit, store } = await importFiles(files, { onProgress });
    if (!audit.error) {
      this.store = store;
      for (const [k, g] of [['artist', artistGrouping(store)], ['album', albumGrouping(store)], ['track', trackGrouping(store)]] as const) {
        this.groupings.set(k, g);
        const totals = new Float64Array(g.labels.length);
        const keys = store[g.column];
        for (let i = 0; i < store.length; i++) totals[keys[i]] += store.msPlayed[i];
        this.registries.set(k, new ColorRegistry(rankByTotal(totals.length, (x) => totals[x])));
      }
      if (this.yearInfo) this.years = resolveYears(store, this.yearInfo);
      this.resolveArt();
    }
    return audit;
  }

  reset() {
    this.store = null;
    this.groupings.clear();
    this.registries.clear();
    this.genre = null;
    this.artistGenres = [];
    this.tree = null;
    this.years = null;
    this.scopes.clear();
    this.last.clear();
    this.marks.clear();
    this.insightsCache = null;
    this.patternCache = null;
    this.tasteCache = null;
  }

  /** Genre tree and year files (baked into the build or loaded by the user). Kept across imports. */
  setEnrichment(tree: TreeData | null, artistCsv: string | null, albumCsv: string | null): EnrichmentSummary {
    this.treeData = tree;
    this.yearInfo = artistCsv || albumCsv ? parseYearInfo(artistCsv, albumCsv) : null;
    if (this.store && this.yearInfo) this.years = resolveYears(this.store, this.yearInfo);
    if (this.genre) this.rebuildTree();
    return this.enrichmentSummary();
  }

  enrichmentSummary(): EnrichmentSummary {
    const nodes = this.tree ? [...this.tree.nodes.values()] : [];
    return {
      treeNodes: nodes.length ? nodes.length - 1 : 0,
      mbEdges: this.tree?.mbEdges ?? 0,
      styleBranches: nodes.filter((n) => n.kind === 'style').length,
      artistsWithYear: this.years ? this.years.artist.filter((y) => y !== null).length : 0,
      albumsWithYear: this.years ? this.years.album.filter((y) => y !== null).length : 0,
    };
  }

  setGenres(csv: string): GenreSummary {
    const store = this.requireStore();
    const info = buildGenreGrouping(store, parseGenreCsv(csv));
    this.genre = info;
    this.groupings.set('genre', info.grouping);
    const totals = new Float64Array(info.grouping.labels.length);
    for (let i = 0; i < store.length; i++) {
      for (const [g, w] of info.grouping.ofKey(store.artist[i])) totals[g] += store.msPlayed[i] * w;
    }
    const pinned = info.grouping.pinnedGroup;
    this.registries.set('genre', new ColorRegistry(rankByTotal(totals.length, (g) => (g === pinned ? 0 : totals[g]))));
    this.artistGenres = store.artistNames.map((_, a) =>
      info.grouping.ofKey(a).filter(([g]) => g !== pinned).map(([g, w]) => [info.grouping.labels[g], w] as [string, number]));
    this.rebuildTree();
    return {
      rows: parseGenreCsv(csv).rows,
      genres: info.grouping.labels.length - 1,
      mappedArtists: info.mappedArtists,
      totalArtists: store.artistNames.length,
      multiGenreArtists: info.multiGenreArtists,
      unmatchedCsvArtists: info.unmatchedCsvArtists,
      nearMatches: info.nearMatches,
      issues: info.issues,
    };
  }

  clearGenres() {
    this.genre = null;
    this.groupings.delete('genre');
    this.artistGenres = [];
    this.tree = null;
    this.scopes.clear();
    for (const k of [...this.last.keys()]) if (!k.startsWith('artist|') && !k.startsWith('album|') && !k.startsWith('track|')) this.last.delete(k);
  }

  private rebuildTree() {
    if (!this.genre) return;
    const labels = this.genre.grouping.labels.filter((l) => l !== UNCLASSIFIED);
    this.tree = buildGenreTree(labels, this.treeData);
    this.scopes.clear();
    this.nodeIndex = new Map([...this.tree.nodes.keys()].map((id, i) => [id, i]));
    // Branch colours: seed with the largest top-level branches.
    this.registries.set('branch', new ColorRegistry());
  }

  /** Artist names by all-time listening time, for the genre CSV template. */
  topArtistNames(limit: number): string[] {
    const store = this.requireStore();
    const totals = new Float64Array(store.artistNames.length);
    for (let i = 0; i < store.length; i++) totals[store.artist[i]] += store.msPlayed[i];
    return rankByTotal(totals.length, (g) => totals[g]).slice(0, limit).map((g) => store.artistNames[g]);
  }

  // ---- scopes and groupings ----------------------------------------------------------------

  /** Per-artist weight inside a genre-tree node: share of the artist's genres that fall in it. */
  private scopeWeights(nodeId: string): Float64Array {
    const cached = this.scopes.get(nodeId);
    if (cached) return cached;
    const node = this.tree?.nodes.get(nodeId);
    if (!node) throw new Error('Unknown genre branch.');
    const w = new Float64Array(this.artistGenres.length);
    this.artistGenres.forEach((gs, a) => { for (const [g, gw] of gs) if (node.leafGenres.has(g)) w[a] += gw; });
    this.scopes.set(nodeId, w);
    return w;
  }

  private scopeFn(scope: string | null | undefined): ArtistScope {
    if (!scope) return null;
    const w = this.scopeWeights(scope);
    return (a) => w[a];
  }

  private branchGrouping(nodeId: string, settings: AggregateSettings): { grouping: Grouping; scope: ArtistScope } {
    const tree = this.tree;
    if (!tree) throw new Error('No genre mapping loaded.');
    const artistMs = this.artistTotals(settings, null);
    const nodeTotal = (id: string) => { const w = this.scopeWeights(id); let s = 0; for (let a = 0; a < w.length; a++) s += w[a] * artistMs[a]; return s; };
    const part = partitionBranch(tree, nodeId, nodeTotal);
    const groupIds = [...new Set(part.values())];
    const labels = groupIds.map((id) => (id === nodeId ? `${tree.nodes.get(id)!.label} (itself)` : tree.nodes.get(id)!.label));
    const idx = new Map(groupIds.map((id, i) => [id, i]));
    const isRoot = nodeId === ROOT_ID;
    const unclassified = isRoot ? labels.length : -1;
    if (isRoot) labels.push(UNCLASSIFIED);
    const scopeW = isRoot ? null : this.scopeWeights(nodeId);
    const per = this.artistGenres.map((gs) => {
      const inside = gs.filter(([g]) => part.has(g));
      if (!inside.length) return isRoot ? [[unclassified, 1] as const] : [];
      const sum = inside.reduce((s, [, w]) => s + w, 0);
      const acc = new Map<number, number>();
      for (const [g, w] of inside) acc.set(idx.get(part.get(g)!)!, (acc.get(idx.get(part.get(g)!)!) ?? 0) + w / sum);
      return [...acc.entries()] as Array<readonly [number, number]>;
    });
    return {
      grouping: { kind: 'branch', column: 'artist', labels, sublabels: groupIds.map((id) => id), ofKey: (a) => per[a], pinnedGroup: isRoot ? unclassified : null },
      scope: scopeW ? (a) => scopeW[a] : null,
    };
  }

  private groupingFor(q: Query): { grouping: Grouping; scope: ArtistScope; regKey: string; toRegId: (g: number) => number } {
    if (q.kind === 'branch') {
      const { grouping, scope } = this.branchGrouping(q.branch ?? ROOT_ID, q.settings);
      // Colours follow the tree node, so a branch keeps its colour wherever it appears.
      const toRegId = (g: number) => this.nodeIndex.get(grouping.sublabels![g]) ?? 100_000 + g;
      return { grouping, scope, regKey: 'branch', toRegId };
    }
    const grouping = this.groupings.get(q.kind);
    if (!grouping) throw new Error(q.kind === 'genre' ? 'No genre mapping loaded.' : 'No data imported.');
    return { grouping, scope: this.scopeFn(q.scope), regKey: q.kind, toRegId: (g) => g };
  }

  private key(q: Query) {
    return `${q.kind}|${q.scope ?? ''}|${q.branch ?? ''}`;
  }

  // ---- queries -------------------------------------------------------------------------------

  /** `colored: false` is for labelled lanes (Eras); those series get no colour slot. */
  aggregate(q: Query, maxTop = 20, colored = true): AggregateResult {
    const store = this.requireStore();
    const { grouping, scope, regKey, toRegId } = this.groupingFor(q);
    const reg = this.registries.get(regKey)!;
    const colorFor = colored
      ? (ids: number[]) => { const m = reg.assign(ids.map(toRegId)); return new Map(ids.map((g) => [g, m.get(toRegId(g))!])); }
      : () => new Map<number, number>();
    const r = aggregate(store, q.settings, grouping, colorFor, maxTop, scope, this.countFor(q.kind, q.settings));
    // Albums and tracks: put the artist in the label so series are identifiable.
    if (grouping.sublabels && (q.kind === 'album' || q.kind === 'track')) {
      for (const s of r.series) if (s.kind === 'item' && s.id !== null) s.label = `${grouping.labels[s.id]} · ${grouping.sublabels[s.id]}`;
    }
    if (q.kind === 'branch') for (const s of r.series) if (s.kind === 'item' && s.id !== null) s.ref = grouping.sublabels![s.id];
    this.last.set(this.key(q), r);
    return r;
  }

  ranks(q: Query): RankResult {
    const r = this.last.get(this.key(q));
    if (!r) throw new Error('No aggregate yet.');
    const { grouping, scope } = this.groupingFor(q);
    return periodRanks(this.requireStore(), r, grouping, r.topIds, scope, this.countFor(q.kind, q.settings));
  }

  clock(q: Query, offsetHours: number, timeZone: string | null = null): ClockResult {
    const r = this.last.get(this.key(q));
    if (!r || !r.periods.length) throw new Error('No aggregate yet.');
    const scopeNode = q.kind === 'branch' ? (q.branch && q.branch !== ROOT_ID ? q.branch : null) : q.scope;
    return listeningClock(this.requireStore(), r.periods[0].start, r.periods[r.periods.length - 1].end, r.settings.minMs, offsetHours, this.scopeFn(scopeNode), timeZone);
  }

  /** Albums listened to front to back in one sitting (see core/albumListens). */
  wholeAlbums(settings: AggregateSettings, scope: string | null = null): WholeAlbumsResult {
    const store = this.requireStore();
    const { from, to } = this.bounds(settings);
    const w = wholeAlbums(store, settings.minMs, from, to, this.scopeFn(scope));
    return {
      ...w,
      rows: w.rows.map((r) => ({ ...r, name: store.albumNames[r.album], artist: store.artistNames[store.albumArtist[r.album]], art: this.albumArt[r.album] ?? null })),
    };
  }

  /** Data for the shareable report: aggregates only, sanitized per the chosen options. */
  reportData(settings: AggregateSettings, o0: ReportOptions, timeZone: string | null): ReportData {
    // A single-plot report turns on just that plot's section and keeps only the part it needs.
    const plot = plotById(o0.plot);
    const o: ReportOptions = plot
      ? { ...o0, sections: { story: false, artists: false, albums: false, songs: false, genres: false, habits: false, patterns: false, [plot.section]: true, routine: Boolean(plot.routine) } }
      : o0;
    const want = (part: string) => !plot || plot.part === part;
    const s = { ...settings, rankBy: 'time' as const };
    const n = Math.max(5, Math.min(100, o.listSize));
    const block = (kind: 'artist' | 'album' | 'track'): KindBlock => {
      const b: KindBlock = {};
      if (want('list')) b.list = this.table({ settings: s, kind }, n).rows;
      if (want('timeline')) b.timeline = this.aggregate({ settings: s, kind }, 20, true);
      if (want('eras')) b.eras = this.aggregate({ settings: { ...s, topN: 20 }, kind }, 30, false);
      if (want('ranks')) {
        const rq = { settings: { ...s, granularity: 'year' as const }, kind };
        b.ranks = { agg: this.aggregate(rq, 20, true), ranks: this.ranks(rq) };
      }
      return b;
    };
    const MONTH = (t: number) => { const d = new Date(t); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1); };
    const DAYMS = 86_400_000;
    const rt = (t: number | null) => (t === null || !Number.isFinite(t) ? t : o.precision === 'month' ? MONTH(t) : t);
    const rd = (d: number) => (o.precision === 'month' ? MONTH(d * DAYMS) / DAYMS : d);
    const rows = (r: TableRow[]) => r.map((x) => ({ ...x, first: rt(x.first) as number, last: rt(x.last) as number }));
    const cleanInsights = (ins: Insights): Insights => {
      const out: Insights = JSON.parse(JSON.stringify(ins));
      out.comebacks = out.comebacks.map((c) => ({ ...c, returnedAt: rt(c.returnedAt) as number }));
      out.notableDiscoveries = out.notableDiscoveries.map((d) => ({ ...d, artists: d.artists.map((a) => ({ ...a, first: rt(a.first) as number })) }));
      if (!o.sections.routine) {
        out.days = []; out.daysWithMusic = 0; out.totalDays = 0;
        out.sessions = { count: 0, perWeek: 0, medianMinutes: 0, longest: null };
        out.sessionLengths = []; out.sessionStartHours = [];
        out.obsessions = { biggestTrackDay: null, biggestArtistDay: null, longestRepeat: null, longestStreak: null };
        out.topSongDays = [];
        out.timeZone = '';
      } else {
        if (o.precision === 'month') out.days = []; // a daily calendar cannot be month-only
        const ob = out.obsessions;
        if (ob.biggestTrackDay) ob.biggestTrackDay.day = rd(ob.biggestTrackDay.day);
        if (ob.biggestArtistDay) ob.biggestArtistDay.day = rd(ob.biggestArtistDay.day);
        if (ob.longestStreak) ob.longestStreak.startDay = rd(ob.longestStreak.startDay);
        if (ob.longestRepeat) ob.longestRepeat.start = rt(ob.longestRepeat.start) as number;
        if (out.sessions.longest) out.sessions.longest.start = rt(out.sessions.longest.start) as number;
        out.topSongDays = out.topSongDays.map((b) => ({ ...b, day: rd(b.day) }));
      }
      return out;
    };
    const ins = cleanInsights(this.insights(settings, timeZone));
    const sum = this.summary(settings);
    const r: ReportData = {
      format: 'listening-report', version: 1,
      title: o.title.trim() || 'My listening, in numbers',
      author: o.author.trim(),
      generatedAt: o.precision === 'month' ? MONTH(Date.now()) : Date.now(),
      precision: o.precision,
      rangeLabel: sum.first !== null ? `${new Date(sum.first).getUTCFullYear()} – ${new Date(sum.last!).getUTCFullYear()}` : '',
      minSeconds: settings.minMs / 1000,
      granularity: settings.granularity,
      routine: o.sections.routine,
      notes: [
        'Summary statistics from my Spotify Extended Streaming History, computed locally. No raw listening data is included.',
        ...(this.genre ? ['Genres, genre tree, release years and covers come from MusicBrainz and the Cover Art Archive.'] : []),
      ],
    };
    if (o.sections.story) {
      r.story = { summary: { ...sum, first: rt(sum.first), last: rt(sum.last), activeDays: o.sections.routine ? sum.activeDays : 0, days: o.sections.routine ? sum.days : 0 }, insights: ins };
      r.top = {
        artist: rows(this.table({ settings: s, kind: 'artist' }, 5).rows),
        album: rows(this.table({ settings: s, kind: 'album' }, 5).rows),
        track: rows(this.table({ settings: s, kind: 'track' }, 5).rows),
        ...(this.genre ? { genre: rows(this.table({ settings: s, kind: 'genre' }, 5).rows) } : {}),
      };
    }
    const withRows = (b: KindBlock): KindBlock => (b.list ? { ...b, list: rows(b.list) } : b);
    if (o.sections.artists) r.artists = withRows(block('artist'));
    if (o.sections.albums) {
      r.albums = withRows(block('album'));
      if (want('whole')) {
        const w = this.wholeAlbums(settings);
        r.albums.whole = { ...w, rows: w.rows.slice(0, n).map((x) => ({ ...x, firstWhole: rt(x.firstWhole), lastWhole: rt(x.lastWhole) })) };
      }
    }
    if (o.sections.songs) r.songs = withRows(block('track'));
    if (o.sections.genres && this.genre) {
      r.genres = {};
      if (want('timeline')) r.genres.timeline = this.aggregate({ settings: s, kind: 'branch' }, 20, true);
      if (want('list')) r.genres.list = rows(this.table({ settings: s, kind: 'genre' }, n).rows);
    }
    if (o.sections.habits || o.sections.routine) r.habits = ins;
    // Pattern results are month-level already (no days or times), so precision needs no rounding.
    if (o.sections.patterns) {
      const p = this.patterns(settings, DEFAULT_TASTES, want('tastes'));
      r.patterns = plot ? { [plot.part]: p[plot.part as keyof typeof p] } : p;
    }
    if (plot) r.plot = plot.id;
    if (!o.covers) {
      const strip = (x: { art?: string | null }) => { x.art = null; };
      for (const b of [r.artists, r.albums, r.songs]) b?.list?.forEach(strip);
      r.albums?.whole?.rows.forEach(strip);
      if (r.top) for (const l of Object.values(r.top)) l?.forEach(strip);
      r.story?.insights.years.forEach((y) => { if (y.topAlbum) y.topAlbum.art = null; });
      r.habits?.years.forEach((y) => { if (y.topAlbum) y.topAlbum.art = null; });
    }
    return r;
  }

  /** Headline numbers for the selected range and filter (the same plays every chart counts). */
  summary(settings: AggregateSettings): Summary {
    const store = this.requireStore();
    const { from, to } = this.bounds(settings);
    const ar = new Set<number>(), al = new Set<number>(), tr = new Set<number>(), dd = new Set<number>();
    let plays = 0, ms = 0, first: number | null = null, last: number | null = null;
    for (let i = 0; i < store.length; i++) {
      const t = store.endedAt[i];
      const m = store.msPlayed[i];
      if (m < settings.minMs || t < from || t >= to) continue;
      plays++; ms += m;
      ar.add(store.artist[i]); al.add(store.album[i]); tr.add(store.track[i]); dd.add(Math.floor(t / 86_400_000));
      if (first === null || t < first) first = t;
      if (last === null || t > last) last = t;
    }
    const days = first !== null && last !== null ? Math.floor(last / 86_400_000) - Math.floor(first / 86_400_000) + 1 : 0;
    return { plays, ms, artists: ar.size, albums: al.size, tracks: tr.size, first, last, days, activeDays: dd.size };
  }

  private patternCache: { key: string; value: PatternState } | null = null;
  private tasteCache: { key: string; value: TastesResult | null } | null = null;
  private mapSize = MAP_ARTISTS;

  /** Eras, taste components, co-listening map and lifecycles (cached per range and filter; tastes also per k). */
  patterns(settings: AggregateSettings, k = DEFAULT_TASTES, withTastes = true, mapSize?: number): Patterns {
    const core = this.patternState(settings, mapSize).view;
    if (!withTastes) return { ...core, tastes: null };
    const input = this.patternInput(settings);
    const key = JSON.stringify([input.from, input.to, input.minMs, settings.granularity, k]);
    if (this.tasteCache?.key !== key) this.tasteCache = { key, value: computeTastes(input, settings, k) };
    return { ...core, tastes: this.tasteCache.value };
  }

  private patternInput(settings: AggregateSettings): PatternInput {
    const { from, to } = this.bounds(settings);
    const g = this.artistGenres;
    return { store: this.requireStore(), from, to, minMs: settings.minMs, genreOf: g.length ? (a) => g[a]?.[0]?.[0] ?? null : null };
  }

  /** Core patterns; `mapSize` defaults to the size last asked for, so the artist panel reuses it. */
  private patternState(settings: AggregateSettings, mapSize = this.mapSize): PatternState {
    this.mapSize = Math.max(20, Math.min(300, mapSize));
    const input = this.patternInput(settings);
    const key = JSON.stringify([input.from, input.to, input.minMs, this.artistGenres.length, this.mapSize]);
    if (this.patternCache?.key === key) return this.patternCache.value;
    const value = computeCorePatterns(input, this.mapSize);
    this.patternCache = { key, value };
    return value;
  }

  private insightsCache: { key: string; value: Insights } | null = null;

  insights(settings: AggregateSettings, timeZone: string | null): Insights {
    const key = JSON.stringify([settings.range, settings.minMs, timeZone, this.artistGenres.length, this.years ? 1 : 0]);
    if (this.insightsCache?.key === key) return this.insightsCache.value;
    const value = this.computeInsights(settings, timeZone);
    this.insightsCache = { key, value };
    return value;
  }

  private computeInsights(settings: AggregateSettings, timeZone: string | null): Insights {
    const store = this.requireStore();
    const { from, to } = this.bounds(settings);
    const g = this.artistGenres;
    const ins = computeInsights(store, {
      from, to, minMs: settings.minMs, offset: offsetFn(timeZone), timeZone: timeZone ?? 'UTC',
      albumYear: this.years?.album ?? null,
      genreOf: g.length ? (a) => g[a]?.[0]?.[0] ?? null : null,
    });
    for (const y of ins.years) if (y.topAlbum) y.topAlbum.art = this.albumArt[y.topAlbum.id] ?? null;
    return ins;
  }

  /** Name search across artists, albums, songs and genres, ranked by all-time listening. */
  search(q: string, limit = 12): SearchHit[] {
    const store = this.requireStore();
    const needle = q.trim().toLowerCase();
    if (needle.length < 2) return [];
    const total = (col: Uint32Array, n: number) => {
      const t = new Float64Array(n);
      for (let i = 0; i < store.length; i++) t[col[i]] += store.msPlayed[i];
      return t;
    };
    const hits: SearchHit[] = [];
    const scan = (kind: 'artist' | 'album' | 'track', names: string[], sub: (i: number) => string, col: Uint32Array) => {
      const t = total(col, names.length);
      names.forEach((name, i) => { if (name.toLowerCase().includes(needle)) hits.push({ kind, id: i, name, sub: sub(i), ms: t[i], art: this.artFor(kind, i) }); });
    };
    scan('artist', store.artistNames, () => 'Artist', store.artist);
    scan('album', store.albumNames, (i) => `Album · ${store.artistNames[store.albumArtist[i]]}`, store.album);
    scan('track', store.trackNames, (i) => `Song · ${store.artistNames[store.trackArtist[i]]}`, store.track);
    if (this.tree) {
      const w = this.artistTotals({ granularity: 'year', metric: 'hours', topN: 1, minMs: 0, range: null }, null);
      for (const n of this.tree.nodes.values()) {
        if (n.id === ROOT_ID || !n.label.toLowerCase().includes(needle)) continue;
        const sw = this.scopeWeights(n.id);
        let ms = 0;
        for (let a = 0; a < sw.length; a++) ms += sw[a] * w[a];
        hits.push({ kind: 'genre', id: n.id, name: n.label, sub: n.kind === 'style' ? 'Style branch' : 'Genre', ms });
      }
    }
    // Exact/prefix matches first, then by listening.
    const rank = (h: SearchHit) => (h.name.toLowerCase() === needle ? 0 : h.name.toLowerCase().startsWith(needle) ? 1 : 2);
    return hits.filter((h) => h.ms > 0).sort((a, b) => rank(a) - rank(b) || b.ms - a.ms).slice(0, limit);
  }

  decades(q: Query, by: 'artist' | 'album'): DecadeBucket[] {
    const store = this.requireStore();
    if (!this.years) return [];
    const { from, to } = this.bounds(q.settings);
    const scope = this.scopeFn(q.scope);
    return decadeBreakdown(store, by, by === 'artist' ? this.years.artist : this.years.album, from, to, q.settings.minMs, scope);
  }

  /** Ranked table of artists / albums / tracks / genres over the displayed range. */
  table(q: Query, limit = 500): TableResult {
    const store = this.requireStore();
    if (q.kind === 'branch') throw new Error('Use treeSummary for branches.');
    const { grouping, scope } = this.groupingFor(q);
    const { from, to, periods } = this.bounds(q.settings);
    const n = grouping.labels.length;
    const ms = new Float64Array(n);
    const plays = new Float64Array(n);
    const trackPlays = new Float64Array(n);
    const countOf = this.countFor(q.kind, q.settings);
    const first = new Float64Array(n).fill(Infinity);
    const last = new Float64Array(n).fill(-Infinity);
    const keys = store[grouping.column];
    let includedMs = 0;
    for (let i = 0; i < store.length; i++) {
      const t = store.endedAt[i];
      const m = store.msPlayed[i];
      if (m < q.settings.minMs || t < from || t >= to) continue;
      const w0 = scope ? scope(store.artist[i]) : 1;
      if (w0 <= 0) continue;
      includedMs += m * w0;
      const c = countOf ? countOf[i] : 1;
      for (const [g, w] of grouping.ofKey(keys[i])) {
        ms[g] += m * w * w0;
        plays[g] += w * w0 * c;
        trackPlays[g] += w * w0;
        if (t < first[g]) first[g] = t;
        if (t > last[g]) last[g] = t;
      }
    }
    const ids = [...ms.keys()].filter((g) => ms[g] > 0 && g !== grouping.pinnedGroup).sort((a, b) => ms[b] - ms[a] || a - b);
    const top = ids.slice(0, limit);
    // Peak period and distinct tracks for the rows shown.
    const pos = new Map(top.map((g, i) => [g, i]));
    const perPeriod = top.map(() => new Float64Array(periods.length));
    const tracks = top.map(() => new Set<number>());
    const starts = periods.map((p) => p.start);
    for (let i = 0; i < store.length; i++) {
      const t = store.endedAt[i];
      const m = store.msPlayed[i];
      if (m < q.settings.minMs || t < from || t >= to) continue;
      const w0 = scope ? scope(store.artist[i]) : 1;
      if (w0 <= 0) continue;
      for (const [g, w] of grouping.ofKey(keys[i])) {
        const r = pos.get(g);
        if (r === undefined) continue;
        let lo = 0, hi = starts.length - 1;
        while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= t) lo = mid; else hi = mid - 1; }
        perPeriod[r][lo] += m * w * w0;
        tracks[r].add(store.track[i]);
      }
    }
    const genreOf = (artistId: number) => this.artistGenres[artistId]?.map(([g]) => g).join(', ') ?? '';
    const rows = top.map((g, r) => {
      let pk = 0;
      perPeriod[r].forEach((v, i) => { if (v > perPeriod[r][pk]) pk = i; });
      const artistId = q.kind === 'artist' ? g : q.kind === 'album' ? store.albumArtist[g] : q.kind === 'track' ? store.trackArtist[g] : -1;
      const year = !this.years ? null : q.kind === 'artist' ? this.years.artist[g] : q.kind === 'album' ? this.years.album[g] : null;
      return {
        id: g,
        name: grouping.labels[g],
        sub: grouping.sublabels?.[g] ?? '',
        ms: ms[g], plays: plays[g], trackPlays: trackPlays[g], share: includedMs ? ms[g] / includedMs : 0,
        first: first[g], last: last[g],
        peak: periods[pk]?.label ?? '',
        genre: artistId >= 0 ? genreOf(artistId) : '',
        year,
        distinctTracks: tracks[r].size,
        art: q.kind === 'genre' ? null : this.artFor(q.kind, g),
      };
    });
    return { rows, total: ids.length, includedMs };
  }

  /** Genre tree with listening per node over the displayed range. */
  treeSummary(settings: AggregateSettings): TreeNodeSummary[] {
    if (!this.tree) return [];
    const artistMs = this.artistTotals(settings, null);
    const total = artistMs.reduce((a, b) => a + b, 0);
    const out: TreeNodeSummary[] = [];
    for (const n of this.tree.nodes.values()) {
      const w = n.id === ROOT_ID ? null : this.scopeWeights(n.id);
      let ms = 0;
      let artists = 0;
      if (w) for (let a = 0; a < w.length; a++) { if (w[a] > 0 && artistMs[a] > 0) { ms += w[a] * artistMs[a]; artists++; } }
      else { ms = total; artists = artistMs.filter((v) => v > 0).length; }
      let classifiedMs: number | undefined;
      if (!w) { const rw = this.scopeWeights(ROOT_ID); classifiedMs = 0; for (let a = 0; a < rw.length; a++) classifiedMs += rw[a] * artistMs[a]; }
      out.push({ id: n.id, label: n.label, kind: n.kind, parents: n.parents, children: n.children, ms, share: total ? ms / total : 0, genres: n.leafGenres.size, artists, mapped: n.mapped, classifiedMs });
    }
    return out;
  }

  /** Everything about one artist / album / track / genre node, for the detail panel. */
  entity(kind: Kind, id: number | string, settings: AggregateSettings, timeZone: string | null = null): EntityInfo {
    const off = offsetFn(timeZone);
    const store = this.requireStore();
    const { from, to, periods } = this.bounds(settings);
    let match: (i: number) => number;
    let title = '';
    let sub = '';
    let genres: string[] = [];
    let year: number | null = null;
    const meta: string[] = [];
    let path: EntityInfo['path'];
    let children: EntityInfo['children'];
    if (kind === 'artist' || kind === 'album' || kind === 'track') {
      const n = Number(id);
      const col = store[kind];
      match = (i) => (col[i] === n ? 1 : 0);
      const g = this.groupings.get(kind)!;
      title = g.labels[n];
      sub = g.sublabels?.[n] ?? '';
      const artistId = kind === 'artist' ? n : kind === 'album' ? store.albumArtist[n] : store.trackArtist[n];
      genres = this.artistGenres[artistId]?.map(([x]) => x) ?? [];
      if (this.years) {
        if (kind === 'artist' && this.years.artist[n]) { year = this.years.artist[n]; meta.push(`Formed / born ${year}`); }
        if (kind === 'album' && this.years.album[n]) { year = this.years.album[n]; meta.push(`Released ${year}`); }
        if (kind !== 'artist' && this.years.artist[artistId]) meta.push(`${store.artistNames[artistId]}: formed / born ${this.years.artist[artistId]}`);
      }
      const am = this.yearInfo?.artistMeta.get(store.artistNames[artistId]);
      if (am && kind === 'artist') { if (am.type) meta.push(am.type); if (am.country) meta.push(am.country); if (am.ended) meta.push(`Ended ${am.ended}`); }
    } else {
      const nodeId = String(id);
      const w = nodeId === ROOT_ID ? null : this.scopeWeights(nodeId);
      match = w ? (i) => w[store.artist[i]] : () => 1;
      const node = this.tree!.nodes.get(nodeId)!;
      title = node.label;
      sub = node.kind === 'style' ? 'Style branch (genres sharing a name word)' : node.kind === 'root' ? 'All mapped genres' : node.children.length ? 'Genre branch' : 'Genre';
      genres = [...node.leafGenres].sort();
      path = pathTo(this.tree!, nodeId).map((x) => ({ id: x.id, label: x.label }));
      const artistMs = this.artistTotals(settings, null);
      children = node.children.map((c) => {
        const cw = this.scopeWeights(c);
        let s = 0;
        for (let a = 0; a < cw.length; a++) s += cw[a] * artistMs[a];
        const cn = this.tree!.nodes.get(c)!;
        return { id: c, label: cn.label, ms: s, kind: cn.kind };
      }).filter((c) => c.ms > 0).sort((a, b) => b.ms - a.ms);
    }

    const per = new Float64Array(periods.length);
    const perTotal = new Float64Array(periods.length);
    const starts = periods.map((p) => p.start);
    const tr = new Map<number, [number, number]>();
    const al = new Map<number, [number, number]>();
    const ar = new Map<number, [number, number]>();
    let ms = 0, plays = 0, all = 0, listens = 0;
    const marks = kind === 'album' ? this.albumMarks(settings.minMs) : null;
    let first: number | null = null, last: number | null = null;
    for (let i = 0; i < store.length; i++) {
      const t = store.endedAt[i];
      const m = store.msPlayed[i];
      if (m < settings.minMs || t < from || t >= to) continue;
      let lo = 0, hi = starts.length - 1;
      while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= t) lo = mid; else hi = mid - 1; }
      perTotal[lo] += m;
      all += m;
      const w = match(i);
      if (w <= 0) continue;
      per[lo] += m * w;
      ms += m * w;
      plays += w;
      if (marks) listens += marks[i];
      if (first === null || t < first) first = t;
      if (last === null || t > last) last = t;
      for (const [map, k] of [[tr, store.track[i]], [al, store.album[i]], [ar, store.artist[i]]] as const) {
        const e = map.get(k) ?? [0, 0];
        e[0] += m * w; e[1] += w;
        map.set(k, e);
      }
    }
    let pk = -1;
    per.forEach((v, i) => { if (v > 0 && (pk < 0 || v > per[pk])) pk = i; });
    // History: discovery (whole history), best calendar month, longest daily streak, years played.
    let discovered: number | null = null;
    const monthMs = new Map<number, number>();
    const days = new Set<number>();
    const yrs = new Set<number>();
    for (let i = 0; i < store.length; i++) {
      const m = store.msPlayed[i];
      if (m < settings.minMs) continue;
      const w = match(i);
      if (w <= 0) continue;
      const t = store.endedAt[i];
      if (discovered === null || t < discovered) discovered = t;
      if (t < from || t >= to) continue;
      const lt = t + off(t);
      const d = new Date(lt);
      const mo = d.getUTCFullYear() * 12 + d.getUTCMonth();
      monthMs.set(mo, (monthMs.get(mo) ?? 0) + m * w);
      days.add(Math.floor(lt / 86_400_000));
      yrs.add(d.getUTCFullYear());
    }
    let bestMonth: EntityInfo['bestMonth'] = null;
    for (const [mo, v] of monthMs) if (!bestMonth || v > bestMonth.ms) bestMonth = { label: new Date(Date.UTC(Math.floor(mo / 12), mo % 12, 1)).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }), ms: v };
    const sortedDays = [...days].sort((x, y) => x - y);
    let streak = sortedDays.length ? 1 : 0, run = 1;
    for (let k = 1; k < sortedDays.length; k++) { run = sortedDays[k] === sortedDays[k - 1] + 1 ? run + 1 : 1; if (run > streak) streak = run; }
    const rows = (m: Map<number, [number, number]>, name: (k: number) => string, subOf?: (k: number) => string) =>
      [...m.entries()].sort((a, b) => b[1][0] - a[1][0] || a[0] - b[0]).slice(0, 10)
        .map(([k, [rms, rp]]) => ({ id: k, name: name(k), sub: subOf?.(k), ms: rms, plays: rp }));
    let rank: number | null = null;
    if (kind === 'artist' || kind === 'album' || kind === 'track') {
      const t = this.table({ settings, kind }, 100_000);
      const r = t.rows.findIndex((x) => x.id === Number(id));
      rank = r >= 0 ? r + 1 : null;
    }
    return {
      art: kind === 'artist' || kind === 'album' || kind === 'track' ? this.artFor(kind, Number(id)) : null,
      kind, id, title, sub, ms, plays, albumListens: marks ? listens : undefined, share: all ? ms / all : 0, rank, first, last,
      periods: periods.map((p, i) => ({ label: p.label, ms: per[i], totalMs: perTotal[i] })),
      peak: pk >= 0 ? periods[pk].label : null,
      genres, year, meta,
      topTracks: rows(tr, (k) => store.trackNames[k], (k) => store.artistNames[store.trackArtist[k]]),
      topAlbums: rows(al, (k) => store.albumNames[k], (k) => store.artistNames[store.albumArtist[k]]),
      topArtists: rows(ar, (k) => store.artistNames[k]),
      path, children,
      ...(kind === 'artist' ? this.artistPatterns(Number(id), settings) : {}),
      discovered, bestMonth, longestStreakDays: streak, yearsPlayed: yrs.size,
    };
  }

  /** Top tracks / albums / artists behind one series, for one period or the whole range. */
  details(q: Query, seriesKey: string, periodIndex: number | null): Details {
    const store = this.requireStore();
    const r = this.last.get(this.key(q));
    if (!r) throw new Error('No aggregate yet.');
    const { grouping, scope } = this.groupingFor(q);
    const all = seriesKey === '*';
    const series = all ? null : r.series.find((s) => s.key === seriesKey);
    if (!all && !series) throw new Error('Unknown series.');
    const top = new Set(r.topIds);
    const keys = store[grouping.column];
    const weightFor = (k: number) => {
      if (!series) return 1;
      let w = 0;
      for (const [g, gw] of grouping.ofKey(k)) {
        if (series.kind === 'other' ? !top.has(g) && g !== grouping.pinnedGroup : g === series.id) w += gw;
      }
      return w;
    };
    const p = periodIndex === null ? null : r.periods[periodIndex];
    const from = p ? p.start : r.periods[0]?.start ?? 0;
    const to = p ? p.end : r.periods[r.periods.length - 1]?.end ?? 0;
    const tr = new Map<number, [number, number]>();
    const al = new Map<number, [number, number]>();
    const ar = new Map<number, [number, number]>();
    let ms = 0, plays = 0;
    let firstPlay: number | null = null, lastPlay: number | null = null;
    const cache = new Map<number, number>();
    for (let i = 0; i < store.length; i++) {
      const t = store.endedAt[i];
      const m = store.msPlayed[i];
      if (m < r.settings.minMs || t < from || t >= to) continue;
      const s0 = scope ? scope(store.artist[i]) : 1;
      if (s0 <= 0) continue;
      let w = cache.get(keys[i]);
      if (w === undefined) { w = weightFor(keys[i]); cache.set(keys[i], w); }
      if (w === 0) continue;
      w *= s0;
      ms += m * w;
      plays += w;
      if (firstPlay === null || t < firstPlay) firstPlay = t;
      if (lastPlay === null || t > lastPlay) lastPlay = t;
      for (const [map, k] of [[tr, store.track[i]], [al, store.album[i]], [ar, store.artist[i]]] as const) {
        const e = map.get(k) ?? [0, 0];
        e[0] += m * w; e[1] += w;
        map.set(k, e);
      }
    }
    const rows = (m: Map<number, [number, number]>, name: (k: number) => string, subOf?: (k: number) => string) =>
      [...m.entries()].sort((a, b) => b[1][0] - a[1][0] || a[0] - b[0]).slice(0, 8)
        .map(([k, [rms, rp]]) => ({ id: k, name: name(k), sub: subOf?.(k), ms: rms, plays: rp }));
    return {
      seriesKey,
      title: series ? series.label : 'All listening',
      scope: p ? p.label : 'Whole displayed range',
      ms, plays, firstPlay, lastPlay,
      topTracks: rows(tr, (k) => store.trackNames[k], (k) => store.artistNames[store.trackArtist[k]]),
      topAlbums: rows(al, (k) => store.albumNames[k], (k) => store.artistNames[store.albumArtist[k]]),
      topArtists: rows(ar, (k) => store.artistNames[k]),
    };
  }

  private artistPatterns(id: number, settings: AggregateSettings): Pick<EntityInfo, 'alongside' | 'lifecycle'> {
    const p = this.patternState(settings);
    return { alongside: p.neighbours.get(id) ?? [], lifecycle: p.kindOf.get(id) ?? null };
  }

  // ---- helpers ------------------------------------------------------------------------------

  private bounds(settings: AggregateSettings) {
    const store = this.requireStore();
    let first = Infinity, last = -Infinity;
    for (let i = 0; i < store.length; i++) { const t = store.endedAt[i]; if (t < first) first = t; if (t > last) last = t; }
    const a = settings.range ? Math.max(settings.range.from, first) : first;
    const b = settings.range ? Math.min(settings.range.to, last) : last;
    const periods = a <= b ? enumeratePeriods(a, b, settings.granularity) : [];
    return { from: periods[0]?.start ?? 0, to: periods[periods.length - 1]?.end ?? 0, periods };
  }

  private artistTotals(settings: AggregateSettings, scope: ArtistScope): Float64Array {
    const store = this.requireStore();
    const { from, to } = this.bounds(settings);
    const out = new Float64Array(store.artistNames.length);
    for (let i = 0; i < store.length; i++) {
      const t = store.endedAt[i];
      const m = store.msPlayed[i];
      if (m < settings.minMs || t < from || t >= to) continue;
      out[store.artist[i]] += m * (scope ? scope(store.artist[i]) : 1);
    }
    return out;
  }

  private requireStore(): PlayStore {
    if (!this.store) throw new Error('No data imported.');
    return this.store;
  }
}

