/**
 * Import pipeline: ZIP/JSON bytes -> validated, normalized, compact play store + audit.
 *
 * Duplicate rules (documented in the UI):
 *  1. File level: two inputs with byte-identical content are the same file; the second is skipped.
 *  2. Record level: a record whose *entire raw content* (every field, including ones we never
 *     keep) exactly matches a record from a *different* file is an overlap between exports and is
 *     skipped. Repeats inside a single file are never removed: Spotify writes each stream once
 *     per export, so a repeat within a file is treated as a real, repeated listen.
 */
import { unzipSync } from 'fflate';
import { normalizeRecord, sniffFileKind, type ExclusionReason } from './normalize';

export interface InputFile {
  name: string;
  bytes: Uint8Array;
}

export type FileStatus = 'accepted' | 'duplicate' | 'one-year' | 'unsupported' | 'empty' | 'invalid-json' | 'ignored' | 'invalid-zip';

export interface FileAuditEntry {
  name: string;
  status: FileStatus;
  records: number;
  note?: string;
  /** First and last accepted music play in this file (epoch ms UTC). */
  firstPlay?: number;
  lastPlay?: number;
  musicPlays?: number;
}

export interface CountMs {
  count: number;
  ms: number;
}

export interface ImportAudit {
  files: FileAuditEntry[];
  recordsRead: number;
  acceptedMusic: CountMs;
  excluded: Record<ExclusionReason | 'crossFileDuplicate', CountMs>;
  firstPlay: number | null;
  lastPlay: number | null;
  artistCount: number;
  trackCount: number;
  /** Groups of distinct exported artist names that look like spelling variants. Not merged. */
  nameVariants: string[][];
  /** Accepted music plays per UTC calendar month, starting at `firstMonth` (ordinal year*12+month). */
  monthly: { firstMonth: number; counts: number[] };
  /** Fatal problem for the whole import (e.g. nothing usable). Null when plays were accepted. */
  error: string | null;
}

export interface PlayStore {
  length: number;
  endedAt: Float64Array;
  msPlayed: Float64Array;
  artist: Uint32Array;
  track: Uint32Array;
  artistNames: string[];
  trackNames: string[];
  trackArtist: Uint32Array;
  /** Album per play. Albums are keyed by (album artist, album name); there is no album ID in the export. */
  album: Uint32Array;
  albumNames: string[];
  albumArtist: Uint32Array;
  /** Per play: 1 = skipped (skipped flag, or ended by the forward button), 0 = not, 2 = unknown. */
  skip: Uint8Array;
  /** Per play: 1 = shuffle on, 0 = off, 2 = unknown. */
  shuffle: Uint8Array;
}

const zeroCM = (): CountMs => ({ count: 0, ms: 0 });

function isJsonName(n: string) {
  return n.toLowerCase().endsWith('.json');
}
function isZipName(n: string) {
  return n.toLowerCase().endsWith('.zip');
}
function isJunk(path: string) {
  return path.startsWith('__MACOSX/') || path.includes('/__MACOSX/') || path.split('/').pop()?.startsWith('._') || path.endsWith('.DS_Store') || path.endsWith('/');
}

/** Stable (key-sorted) serialization used only transiently for record fingerprints. */
function stableStringify(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'undefined';
  if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']';
  const o = v as Record<string, unknown>;
  return '{' + Object.keys(o).sort().map((k) => JSON.stringify(k) + ':' + stableStringify(o[k])).join(',') + '}';
}

/** cyrb53: fast 53-bit string hash. Used so fingerprints do not retain sensitive text. */
function cyrb53(str: string, seed = 0): number {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Fold case, strip diacritics, punctuation, spaces and a leading "the" to spot name variants. */
export function nameVariantKey(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/^the\s+/, '')
    .replace(/[^\p{L}\p{N}]/gu, '');
}

export interface ImportOptions {
  nowMs?: number;
  onProgress?: (done: number, total: number, label: string) => void;
}

/** Expand ZIPs into their JSON members; pass loose JSON through. */
function expandInputs(inputs: InputFile[], audit: FileAuditEntry[]): InputFile[] {
  const out: InputFile[] = [];
  for (const f of inputs) {
    if (isZipName(f.name)) {
      let entries: Record<string, Uint8Array>;
      const skipped: string[] = [];
      try {
        entries = unzipSync(f.bytes, {
          filter: (e) => {
            if (isJunk(e.name)) return false;
            if (!isJsonName(e.name)) {
              skipped.push(e.name);
              return false;
            }
            return true;
          },
        });
      } catch {
        audit.push({ name: f.name, status: 'invalid-zip', records: 0, note: 'Could not read this ZIP archive.' });
        continue;
      }
      for (const s of skipped) audit.push({ name: `${f.name} › ${s}`, status: 'ignored', records: 0, note: 'Not a JSON file.' });
      for (const [path, bytes] of Object.entries(entries).sort(([a], [b]) => a.localeCompare(b))) {
        out.push({ name: `${f.name} › ${path}`, bytes });
      }
    } else if (isJsonName(f.name)) {
      out.push(f);
    } else {
      audit.push({ name: f.name, status: 'unsupported', records: 0, note: 'Only .zip and .json files are supported.' });
    }
  }
  return out;
}

export async function importFiles(inputs: InputFile[], opts: ImportOptions = {}): Promise<{ audit: ImportAudit; store: PlayStore }> {
  const nowMs = opts.nowMs ?? Date.now();
  const files: FileAuditEntry[] = [];
  const jsonFiles = expandInputs(inputs, files);

  const excluded: ImportAudit['excluded'] = {
    podcast: zeroCM(), audiobook: zeroCM(), missingArtist: zeroCM(), unidentified: zeroCM(),
    invalidDate: zeroCM(), malformed: zeroCM(), crossFileDuplicate: zeroCM(),
  };
  const accepted = zeroCM();
  let recordsRead = 0;

  // Growable columnar buffers.
  let cap = 1024;
  let endedAt = new Float64Array(cap);
  let msPlayed = new Float64Array(cap);
  let artistCol = new Uint32Array(cap);
  let trackCol = new Uint32Array(cap);
  let albumCol = new Uint32Array(cap);
  let skipCol = new Uint8Array(cap);
  let shufCol = new Uint8Array(cap);
  let n = 0;
  const grow = () => {
    cap *= 2;
    const e = new Float64Array(cap); e.set(endedAt); endedAt = e;
    const m = new Float64Array(cap); m.set(msPlayed); msPlayed = m;
    const a = new Uint32Array(cap); a.set(artistCol); artistCol = a;
    const t = new Uint32Array(cap); t.set(trackCol); trackCol = t;
    const al = new Uint32Array(cap); al.set(albumCol); albumCol = al;
    const sk = new Uint8Array(cap); sk.set(skipCol); skipCol = sk;
    const sh = new Uint8Array(cap); sh.set(shufCol); shufCol = sh;
  };

  const artistIds = new Map<string, number>();
  const artistNames: string[] = [];
  const trackIds = new Map<string, number>();
  const trackNames: string[] = [];
  const trackArtistList: number[] = [];
  const albumIds = new Map<string, number>();
  const albumNames: string[] = [];
  const albumArtistList: number[] = [];

  const seenHashes = new Map<string, string>();
  const fingerprints = new Map<string, number>(); // fingerprint -> file index where first seen
  const decoder = new TextDecoder('utf-8');

  for (let fi = 0; fi < jsonFiles.length; fi++) {
    const f = jsonFiles[fi];
    opts.onProgress?.(fi, jsonFiles.length, f.name);
    const hash = await sha256Hex(f.bytes);
    const dupOf = seenHashes.get(hash);
    if (dupOf !== undefined) {
      files.push({ name: f.name, status: 'duplicate', records: 0, note: `Identical to ${dupOf}; skipped so plays are not double-counted.` });
      continue;
    }
    seenHashes.set(hash, f.name);

    let doc: unknown;
    try {
      doc = JSON.parse(decoder.decode(f.bytes));
    } catch {
      files.push({ name: f.name, status: 'invalid-json', records: 0, note: 'File is not valid JSON.' });
      continue;
    }
    const kind = sniffFileKind(doc);
    if (kind === 'one-year') {
      files.push({
        name: f.name, status: 'one-year', records: (doc as unknown[]).length,
        note: 'This is the one-year "Streaming History" from the Account Data export. This app needs "Extended Streaming History" (fields such as ts and ms_played).',
      });
      continue;
    }
    if (kind === 'empty') {
      files.push({ name: f.name, status: 'empty', records: 0, note: 'File contains no records.' });
      continue;
    }
    if (kind === 'unsupported') {
      files.push({ name: f.name, status: 'unsupported', records: 0, note: 'Not a recognised Spotify streaming history file.' });
      continue;
    }

    const records = doc as unknown[];
    recordsRead += records.length;
    const entry: FileAuditEntry = { name: f.name, status: 'accepted', records: records.length, musicPlays: 0 };
    files.push(entry);

    for (const raw of records) {
      if (raw !== null && typeof raw === 'object') {
        const s = stableStringify(raw);
        const fp = `${s.length}:${cyrb53(s)}:${cyrb53(s, 7)}`;
        const first = fingerprints.get(fp);
        if (first === undefined) fingerprints.set(fp, fi);
        else if (first !== fi) {
          const msv = (raw as Record<string, unknown>).ms_played;
          excluded.crossFileDuplicate.count++;
          excluded.crossFileDuplicate.ms += typeof msv === 'number' && Number.isFinite(msv) ? msv : 0;
          continue;
        }
      }
      const rec = normalizeRecord(raw, nowMs);
      if (rec.kind === 'excluded') {
        excluded[rec.reason].count++;
        excluded[rec.reason].ms += rec.msPlayed;
        continue;
      }
      let aid = artistIds.get(rec.artistName);
      if (aid === undefined) {
        aid = artistNames.length;
        artistIds.set(rec.artistName, aid);
        artistNames.push(rec.artistName);
      }
      const tkey = rec.trackUri ?? `${aid}\u0000${rec.trackName}`;
      let tid = trackIds.get(tkey);
      if (tid === undefined) {
        tid = trackNames.length;
        trackIds.set(tkey, tid);
        trackNames.push(rec.trackName);
        trackArtistList.push(aid);
      }
      if (n === cap) grow();
      entry.musicPlays!++;
      if (entry.firstPlay === undefined || rec.endedAt < entry.firstPlay) entry.firstPlay = rec.endedAt;
      if (entry.lastPlay === undefined || rec.endedAt > entry.lastPlay) entry.lastPlay = rec.endedAt;
      endedAt[n] = rec.endedAt;
      msPlayed[n] = rec.msPlayed;
      artistCol[n] = aid;
      trackCol[n] = tid;
      const albumName = rec.albumName ?? '(unknown album)';
      const akey = `${aid}\u0000${albumName}`;
      let alid = albumIds.get(akey);
      if (alid === undefined) {
        alid = albumNames.length;
        albumIds.set(akey, alid);
        albumNames.push(albumName);
        albumArtistList.push(aid);
      }
      albumCol[n] = alid;
      skipCol[n] = rec.skipped === true || rec.reasonEnd === 'fwdbtn' ? 1 : rec.skipped === false || rec.reasonEnd ? 0 : 2;
      shufCol[n] = rec.shuffle === null ? 2 : rec.shuffle ? 1 : 0;
      n++;
      accepted.count++;
      accepted.ms += rec.msPlayed;
    }
  }
  opts.onProgress?.(jsonFiles.length, jsonFiles.length, 'done');

  let firstPlay: number | null = null;
  let lastPlay: number | null = null;
  for (let i = 0; i < n; i++) {
    const t = endedAt[i];
    if (firstPlay === null || t < firstPlay) firstPlay = t;
    if (lastPlay === null || t > lastPlay) lastPlay = t;
  }

  const monthly = { firstMonth: 0, counts: [] as number[] };
  if (firstPlay !== null && lastPlay !== null) {
    const mo = (t: number) => { const d = new Date(t); return d.getUTCFullYear() * 12 + d.getUTCMonth(); };
    monthly.firstMonth = mo(firstPlay);
    monthly.counts = new Array(mo(lastPlay) - monthly.firstMonth + 1).fill(0);
    for (let i = 0; i < n; i++) monthly.counts[mo(endedAt[i]) - monthly.firstMonth]++;
  }

  const variantGroups = new Map<string, string[]>();
  for (const name of artistNames) {
    const k = nameVariantKey(name);
    if (!k) continue;
    const g = variantGroups.get(k);
    if (g) g.push(name);
    else variantGroups.set(k, [name]);
  }
  const nameVariants = [...variantGroups.values()].filter((g) => g.length > 1).map((g) => g.sort());

  let error: string | null = null;
  if (inputs.length === 0) error = 'No files were selected.';
  else if (n === 0) {
    if (files.some((f) => f.status === 'one-year')) {
      error = 'Only one-year Streaming History files were found. Request "Extended streaming history" from Spotify\'s Privacy page and upload that export instead.';
    } else if (files.some((f) => f.status === 'accepted')) {
      error = 'The files were read, but they contain no music plays that passed validation.';
    } else {
      error = 'No Spotify Extended Streaming History files were found in this upload.';
    }
  }

  const store: PlayStore = {
    length: n,
    endedAt: endedAt.slice(0, n),
    msPlayed: msPlayed.slice(0, n),
    artist: artistCol.slice(0, n),
    track: trackCol.slice(0, n),
    artistNames,
    trackNames,
    trackArtist: Uint32Array.from(trackArtistList),
    album: albumCol.slice(0, n),
    albumNames,
    albumArtist: Uint32Array.from(albumArtistList),
    skip: skipCol.slice(0, n),
    shuffle: shufCol.slice(0, n),
  };
  return {
    audit: {
      files, recordsRead, acceptedMusic: accepted, excluded, firstPlay, lastPlay,
      artistCount: artistNames.length, trackCount: trackNames.length, nameVariants, monthly, error,
    },
    store,
  };
}
