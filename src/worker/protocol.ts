import type { AggregateSettings } from '../core/aggregate';
import type { TreeData } from '../core/genreTree';
import type { Kind, Query } from './engine';
import type { ReportOptions } from '../report/types';

export type WorkerRequest =
  | { type: 'import'; id: number; files: File[] }
  | { type: 'aggregate'; id: number; query: Query; maxTop?: number; colored?: boolean }
  | { type: 'details'; id: number; query: Query; seriesKey: string; periodIndex: number | null }
  | { type: 'ranks'; id: number; query: Query }
  | { type: 'clock'; id: number; query: Query; offsetHours: number; timeZone?: string | null }
  | { type: 'summary'; id: number; settings: AggregateSettings }
  | { type: 'report'; id: number; settings: AggregateSettings; options: ReportOptions; timeZone: string | null }
  | { type: 'whole'; id: number; settings: AggregateSettings; scope?: string | null }
  | { type: 'insights'; id: number; settings: AggregateSettings; timeZone: string | null }
  | { type: 'patterns'; id: number; settings: AggregateSettings; k?: number; tastes?: boolean; mapSize?: number }
  | { type: 'search'; id: number; q: string }
  | { type: 'table'; id: number; query: Query; limit?: number }
  | { type: 'decades'; id: number; query: Query; by: 'artist' | 'album' }
  | { type: 'tree'; id: number; settings: AggregateSettings }
  | { type: 'entity'; id: number; kind: Kind; entityId: number | string; settings: AggregateSettings; timeZone?: string | null }
  | { type: 'setGenres'; id: number; csv: string }
  | { type: 'setEnrichment'; id: number; tree: TreeData | null; artistCsv: string | null; albumCsv: string | null }
  | { type: 'clearGenres'; id: number }
  | { type: 'setArt'; id: number; index: Record<string, string | null> | null }
  | { type: 'artistList'; id: number; limit: number }
  | { type: 'reset'; id: number };

export type WorkerResponse =
  | { type: 'progress'; done: number; total: number; label: string }
  | { type: 'result'; id: number; value: unknown }
  | { type: 'error'; id: number; message: string };
