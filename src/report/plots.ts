/**
 * Every plot that can be exported on its own for embedding (a single-plot report holds only the
 * data that plot needs). The id is also the URL hash a full report accepts: `report.html#plot=map`.
 */
export type ReportSection = 'story' | 'artists' | 'albums' | 'songs' | 'genres' | 'habits' | 'patterns';

export interface PlotInfo {
  id: string;
  label: string;
  group: string;
  section: ReportSection;
  /** Which part of the section: a view name, a habits section id, or a patterns part. */
  part: string;
  /** Needs the daily-routine data (calendar, sessions, single days). */
  routine?: boolean;
  /** Needs a genre mapping. */
  genres?: boolean;
}

/**
 * Typical embedded height in px [phone, desktop], measured on the compact embed layout. Used as
 * the iframe's starting height so the page does not jump while the plot loads (the plot then
 * reports its exact height). Mirrored in docs/hugo-shortcode.html; a unit test keeps them equal.
 */
export const PLOT_HEIGHTS: Record<string, [number, number]> = {
  'albums-eras': [680, 660],
  'albums-list': [1210, 1050],
  'albums-ranks': [1010, 790],
  'albums-timeline': [1020, 700],
  'albums-whole': [1070, 820],
  'artists-eras': [680, 660],
  'artists-list': [1150, 1000],
  'artists-ranks': [830, 720],
  'artists-timeline': [830, 610],
  'eras': [400, 350],
  'genres-list': [580, 500],
  'genres-timeline': [610, 550],
  'habits-age': [300, 280],
  'habits-calendar': [450, 580],
  'habits-comebacks': [290, 260],
  'habits-discovery': [770, 670],
  'habits-loyal': [470, 440],
  'habits-obsessions': [930, 700],
  'habits-sessions': [790, 600],
  'habits-shuffle': [380, 370],
  'habits-skips': [1010, 980],
  'habits-variety': [460, 410],
  'life': [1280, 1000],
  'map': [860, 880],
  'songs-eras': [890, 870],
  'songs-list': [1850, 1710],
  'songs-ranks': [990, 820],
  'songs-timeline': [1000, 740],
  'story': [730, 600],
  'tastes': [860, 730],
};

const kinds: Array<[ReportSection, string, string]> = [['artists', 'Artists', 'artists'], ['albums', 'Albums', 'albums'], ['songs', 'Songs', 'songs']];

export const PLOTS: PlotInfo[] = [
  { id: 'map', label: 'Who you play together (co-listening map)', group: 'Patterns', section: 'patterns', part: 'map' },
  { id: 'eras', label: 'Your listening eras', group: 'Patterns', section: 'patterns', part: 'eras' },
  { id: 'tastes', label: 'Your tastes over time', group: 'Patterns', section: 'patterns', part: 'tastes' },
  { id: 'life', label: 'How artists come and go', group: 'Patterns', section: 'patterns', part: 'life' },
  ...kinds.flatMap(([section, group, noun]) => [
    { id: `${section}-list`, label: `Top ${noun}`, group, section, part: 'list' },
    ...(section === 'albums' ? [{ id: 'albums-whole', label: 'Whole albums, front to back', group, section, part: 'whole' }] : []),
    { id: `${section}-eras`, label: `${group} by era`, group, section, part: 'eras' },
    { id: `${section}-timeline`, label: `Top ${noun} over time`, group, section, part: 'timeline' },
    { id: `${section}-ranks`, label: `How the top ${noun} ranked each year`, group, section, part: 'ranks' },
  ]),
  { id: 'genres-timeline', label: 'Genre branches over time', group: 'Genres', section: 'genres', part: 'timeline', genres: true },
  { id: 'genres-list', label: 'Top genres', group: 'Genres', section: 'genres', part: 'list', genres: true },
  { id: 'story', label: 'Story: headline numbers and highlights', group: 'Story', section: 'story', part: 'story' },
  { id: 'habits-discovery', label: 'Discovering new artists', group: 'Habits', section: 'habits', part: 'h-discovery' },
  { id: 'habits-variety', label: 'How varied your listening was', group: 'Habits', section: 'habits', part: 'h-variety' },
  { id: 'habits-skips', label: 'Skips', group: 'Habits', section: 'habits', part: 'h-skips' },
  { id: 'habits-shuffle', label: 'Shuffle', group: 'Habits', section: 'habits', part: 'h-shuffle' },
  { id: 'habits-age', label: 'How old the music you play is', group: 'Habits', section: 'habits', part: 'h-age' },
  { id: 'habits-comebacks', label: 'Comebacks', group: 'Habits', section: 'habits', part: 'h-comebacks' },
  { id: 'habits-loyal', label: 'Most loyal artists', group: 'Habits', section: 'habits', part: 'h-loyal' },
  { id: 'habits-calendar', label: 'Every day you listened (calendar)', group: 'Habits (daily routine)', section: 'habits', part: 'h-calendar', routine: true },
  { id: 'habits-sessions', label: 'Listening sessions', group: 'Habits (daily routine)', section: 'habits', part: 'h-sessions', routine: true },
  { id: 'habits-obsessions', label: 'Obsessions (single-day binges)', group: 'Habits (daily routine)', section: 'habits', part: 'h-obsessions', routine: true },
];

export const plotById = (id: string | null | undefined) => PLOTS.find((p) => p.id === id) ?? null;
