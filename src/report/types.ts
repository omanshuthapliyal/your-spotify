/**
 * Shareable report: a single self-contained HTML file with summary statistics only. Never contains
 * the export, individual plays, or identifying fields (IP, device, country, username).
 */
import type { AggregateResult } from '../core/aggregate';
import type { Insights } from '../core/insights';
import type { RankResult } from '../core/ranks';
import type { Summary, TableRow, WholeAlbumsResult } from '../worker/engine';
import type { Patterns } from '../core/patterns';

export interface ReportOptions {
  title: string;
  author: string;
  /** 'month' rounds every date in the data to the first of its month. */
  precision: 'day' | 'month';
  sections: {
    story: boolean;
    artists: boolean;
    albums: boolean;
    songs: boolean;
    genres: boolean;
    /** Discovery, variety, skips, shuffle, music age, comebacks, loyalty. */
    habits: boolean;
    /** Calendar, time of day, sessions, day-level obsessions: these reveal a daily routine. */
    routine: boolean;
    /** Eras, tastes, co-listening map, lifecycles (month-level only). */
    patterns: boolean;
  };
  covers: boolean;
  listSize: number;
  /** Export one plot only (an id from PLOTS); the file then holds just that plot's data. */
  plot?: string | null;
  /** For the genre stream plot: show the sub-genres of this genre-tree branch instead of the top level. */
  plotBranch?: string | null;
}

export const DEFAULT_REPORT_OPTIONS: ReportOptions = {
  title: 'My listening, in numbers',
  author: '',
  precision: 'month',
  sections: { story: true, artists: true, albums: true, songs: true, genres: true, habits: true, routine: false, patterns: true },
  covers: true,
  listSize: 25,
};

/** One library kind. In a single-plot report only the part that plot needs is present. */
export interface KindBlock {
  list?: TableRow[];
  timeline?: AggregateResult;
  eras?: AggregateResult;
  ranks?: { agg: AggregateResult; ranks: RankResult };
}

export interface ReportData {
  format: 'listening-report';
  version: 1;
  title: string;
  author: string;
  generatedAt: number;
  precision: 'day' | 'month';
  rangeLabel: string;
  minSeconds: number;
  granularity: string;
  routine: boolean;
  story?: { summary: Summary; insights: Insights };
  top?: { artist: TableRow[]; album: TableRow[]; track: TableRow[]; genre?: TableRow[] };
  artists?: KindBlock;
  albums?: KindBlock & { whole?: WholeAlbumsResult };
  songs?: KindBlock;
  genres?: {
    timeline?: AggregateResult;
    list?: TableRow[];
    /** The branch the stream starts at (absent = all genres). */
    branch?: { id: string; label: string };
    /** Sub-genre streams for drilling down, by genre-tree node id (bands link to them via `ref`). */
    drill?: Record<string, { label: string; timeline: AggregateResult }>;
  };
  habits?: Insights;
  patterns?: Partial<Patterns>;
  /** Set for a single-plot report: the plot id (see PLOTS). */
  plot?: string;
  notes: string[];
}
