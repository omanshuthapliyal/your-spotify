# your-spotify

**Listening Timeline**: a private, browser-only app that turns your Spotify **Extended Streaming
History** export into interactive lifetime analytics of your music listening: timelines, top
artists, albums and songs, habits, listening eras, tastes over time, and a map of which artists you
play together.

- **Private by design.** No backend, accounts, Spotify login, analytics or telemetry. Your files
  are read inside your own browser tab and kept in memory only; reloading the tab clears
  everything. A Content Security Policy (`connect-src 'none'`) stops the page from making network
  requests at all.
- Only files you explicitly export (chart images, CSV tables, a share report) leave the page.

## 1. Get your Spotify data

1. Log in at Spotify's [Privacy settings](https://www.spotify.com/account/privacy/).
2. Under "Download your data", tick **Extended streaming history** (the full history; the
   basic "Account data" only covers one year) and press **Request data**.
3. Confirm the email Spotify sends you.
4. Wait for the second email (Spotify says up to 30 days; often a few days) and download
   `my_spotify_data.zip`. Keep it zipped.

## 2. Run the app

You need [Node.js](https://nodejs.org) 20 or newer (check with `node -v`) and git.

```sh
git clone https://github.com/omanshuthapliyal/your-spotify.git
cd your-spotify
npm install
npm run build
npm run preview
```

Open <http://127.0.0.1:4173> in your browser. Next time, just `cd your-spotify && npm run preview`.

No export yet? Click **explore with synthetic demo data** on the start page to try everything.

## 3. Use it

1. **Drop `my_spotify_data.zip`** onto the page (or click to choose it). Import takes a few
   seconds and happens entirely in your browser.
2. **Story** gives the overview: headline numbers, highlights, your listening eras, a year-by-year
   row (click a year to focus on it) and top lists.
3. The **filter bar** (year chips and **Edit filters**) sets the date range, period
   (month / quarter / year), measure (hours / share / plays), how many top items to show, and the
   minimum play length. It applies everywhere.
4. **Explore** has Artists, Albums, Songs and Genres. Switch between the top list, **Eras**,
   **Timeline** and **Rankings** (and **Whole albums** for albums played front to back). Click any
   artist, album or song for its full history.
5. **Habits** covers when and how you listen: calendar, time of day, discovery, variety, skips,
   shuffle, music age, sessions, obsessions, comebacks and loyalty.
6. **Patterns** has the learned views: **Who you play together** (an interactive map: hover,
   click, search, zoom with Ctrl/⌘ + scroll or pinch), your **eras**, **tastes** over time and how
   artists **come and go**.
7. **Search** (top) finds any artist, album, song or genre. **Settings** switches light/dark mode
   or starts over with another file.
8. **Share** creates one self-contained HTML report (summary statistics only) that you can send or
   embed in a blog. See [Sharing your results](#sharing-your-results).
9. Optional: add genres, release years and album covers from MusicBrainz with the scripts in
   [Genres, years and covers](#genres-years-and-covers-optional).

## What you get

Five areas, with one filter bar (dates, period, measure, top N, minimum play length) that applies
everywhere:

- **Story**: headline numbers, auto-generated highlights, your eras, a year-by-year row and top lists.
- **Explore**: Artists, Albums, Songs and Genres, each with:
  - top lists ranked by listening time or play count (album listens for albums);
  - **Eras** (a ridgeline sorted by when each item peaked), **Timeline** (stream or flow) and **Rankings**;
  - for albums, **Whole albums**: albums played (almost) front to back in one sitting.
  Clicking any item opens a detail panel with its history, first and last play, peak, top
  tracks and albums, genres, release years and who you play it alongside.
- **Habits**: discovery of new artists, variety, skips and shuffle, the age of the music you play,
  sessions, obsessions, comebacks, loyal artists, a daily calendar and a listening clock.
- **Patterns**: models learned from your history (see below): who you play together, listening
  eras, tastes over time, and how artists come and go.
- **Data**: the import audit, genre sources and settings.

The one-year "Account data" history (`StreamingHistory_music_*.json`) is recognised and rejected
with an explanation, because it lacks track IDs, albums and skip information.

## Data handling

Accepted input: Extended Streaming History ZIP and/or JSON files, identified by schema (`ts`,
`ms_played`, ...), not by name.

Kept fields: `ts`, `ms_played`, track name, album name, album artist, `spotify_track_uri`,
`skipped`, `shuffle` and `reason_end`. The episode and audiobook fields are read only to classify
a record, then discarded. IP address, country, platform, username, user agent and every other field
are never copied.

| Record                                          | Treatment                 |
|-------------------------------------------------|---------------------------|
| Music track with artist                         | counted                   |
| Podcast / video episode, audiobook              | excluded, reported        |
| Track without artist, no metadata at all        | excluded, reported        |
| Unparseable `ts`, before 2008, or in the future | excluded as invalid date  |
| Non-object, bad/negative `ms_played`, no `ts`   | excluded as malformed     |

**Duplicates.**
- *File level:* inputs with byte-identical content count once (e.g. the ZIP plus a loose copy of
  one of its files).
- *Record level:* a record is dropped only if **every raw field** matches a record from a
  **different** file, which happens with overlapping exports.
- Repeats within a single file are kept as real, repeated listens.

**Artist names** are grouped exactly as exported (the *album* artist). Names that differ only by
case, accents, punctuation or a leading "The" are listed as possible variants and **not** merged.
**Albums** are identified by album artist + album name, since the export has no album ID.

## Measurement rules

- Chart periods are calendar month / quarter (default) / year in **UTC**. Empty periods stay on
  the axis and are marked "no plays".
- Metrics: listening hours (default), share of the period's listening time, play count.
- Minimum play duration defaults to 30 s (exactly 30 000 ms counts). Excluded plays and hours are
  shown.
- **Top N** (default 12, up to 20) is chosen once across the displayed range by the selected
  measure. Everything else is summed into "Other", so period totals always reconcile. Other is
  drawn below the axis by default, or can be hidden.
- **Colours follow the item, not its rank**: 8 validated hues in 3 lightness tiers, seeded from
  the all-time top items, stable across periods, views and filter changes.
- **Default range**: if a few isolated plays sit far before or after regular listening (at most 2%
  of plays, in months with almost no other activity), charts start where regular listening starts.
  The audit says so, the plays stay counted, and one click shows the full history.
- **Skips**: Spotify's `skipped` flag or `reason_end = fwdbtn`.
- **Album listens**: a sitting (gaps of at most 30 min) with 3+ distinct tracks from the album, so
  ten tracks in one sitting count as one album listen, not ten. A **whole-album** listen covers at
  least 80% of the album's known tracks (albums with 4+ known tracks), with at least 80% of those
  plays not skipped. "Known tracks" are the tracks that appear in your own history.
- **Time of day** (calendar, clock, streaks, sessions) uses your browser's timezone with daylight
  saving, assuming you listened there. The clock can also show UTC or a fixed offset.

### What the flow view's ribbons mean

Each column is a period; nodes are the same top-N + Other series as the timeline, so column
heights equal the stacked totals. A ribbon joins **the same item** in two adjacent non-empty
periods. **Ribbons never connect different items**: the export records totals, not transitions,
so a crossing ribbon only means the ranking changed.

## Patterns: how the models work

All four run in the Web Worker on qualifying plays in the selected range, in UTC calendar months,
with fixed random seeds, so the same data always gives the same result. Each one shows how sure
it is.

- **Eras** (change-point detection). Each month becomes a vector of square-rooted artist
  shares (top 50 artists plus "everyone else"), and optimal segmentation by dynamic programming
  minimises within-era spread (eras of 3+ months, at most 10). A **permutation test** decides how
  many eras there are: another era is accepted only if its improvement beats the same step on
  39 random shuffles of your months (p <= 0.05). On pure noise it invents an era about 5% of
  the time (unit-tested). Each boundary shows the window where it could sit while keeping 90% of
  its improvement, and each era its top and "defining" artists (far above their usual share).
  Months with under an hour (or under 10% of a typical month) join the era around them.
- **Tastes** (KL non-negative matrix factorisation, i.e. a PLSA topic model, of the month x
  artist share matrix for your top 80 artists). Tastes are named by their top artists, never by
  invented labels. Each play's hours are split across tastes in proportion to the model, and
  other artists go below the line, so the bands add up to your real listening. Five fits from
  different random starts give each taste a stability score (stable / fairly stable / loose):
  real listening often has groups that can be split more than one way. You can choose 3 to 10 tastes.
- **Who you play together** (the co-listening map, first on the Patterns page). Sessions (no
  gap over 30 minutes) give each pair of your top artists (75, 150 or 250) an Ochiai association:
  shared sessions over the geometric mean of each artist's sessions, with 2+ shared. Each artist
  links to its 5 strongest partners. Groups are Louvain modularity communities, with stability as
  the adjusted Rand index across runs in random node orders. **Bridges** are artists whose links
  spread across groups (participation coefficient). Layout: groups are packed as round islands,
  related groups side by side, with artists laid out inside by their own links and overlaps
  removed. Only links and groups carry meaning, not exact distances.
  The map is interactive:
  - zoom and pan (Ctrl/Cmd + scroll, pinch, drag, buttons);
  - hover to light up an artist's partners, click to see them ranked with session counts;
  - search, and focus a group;
  - colour by group, discovery year or lifecycle; size by hours or sessions;
  - full screen and SVG download.
  The artist panel also lists who you play each artist alongside.
- **Lifecycles** (rules you can check, for artists with 2+ hours and 10+ plays): new, seasonal,
  flash, slow burn, evergreen, faded or steady; the exact rules are in the app and in
  `src/core/patterns/lifecycle.ts`. **How long new artists last** is a Kaplan-Meier survival curve
  for artists first played 3+ months into the range and on 2+ days. An artist counts as stopped
  after 6 months without plays; artists still going are censored.

Tests plant known structure in a synthetic history (eras, groups, lifecycle shapes) and check
that each model recovers it, that taste hours reconcile exactly, and that results are deterministic.

## Genres, years and covers (optional)

The export has no genre field, and the app never infers genres from names. You can add them in
two ways.

**Load a CSV** in the Data area:

```csv
artist,genre
Artist A,Indie Rock
Artist B,Electronic; Pop
```

- Exact name match only. Case- or accent-only matches are reported, not applied.
- Several genres per artist split that artist's time **equally**, so genre totals still equal
  total listening time.
- Unmapped artists are **Unclassified**, always shown, and genre coverage is displayed.
- **Download template** creates a CSV of your top 300 artists locally.

**Or fill it from MusicBrainz and Cover Art Archive** with the scripts below. They are the only
parts of the project that use the network, and only when you run them. They send artist names,
album titles and MusicBrainz IDs; never plays, times or counts. They respect MusicBrainz's
1 request/second limit and cache results. Set `MB_CONTACT=you@example.com` to identify yourself, as
MusicBrainz requests.

```sh
# genres for your top artists
npm run genres -- --zip ~/Downloads/my_spotify_data.zip --out genres/artist-genres.local.csv --cache genres/.genre-cache.json
# genre tree, artist formation years, album release years
npm run enrich -- --zip ~/Downloads/my_spotify_data.zip [--artists 1000] [--albums 1000]
# album covers (needs enrich first; downloads into public/art/)
npm run covers
npm run build
```

`npm run build` bakes whatever exists in `genres/*.local.*` and `public/art/` into the app, so it is
applied after each import. These files are git-ignored. A build made with them contains your
top artist names and covers, so **don't publish that `dist/`**.

- **Genre tree**: MusicBrainz "subgenre of / fusion of" links, plus name-based *style* branches
  such as "Progressive (style)". An artist with several genres counts toward a branch in
  proportion to its genres inside it, so a branch total counts each play at most once.
- **Album years** are the earliest release on MusicBrainz, so a remaster counts as the original.
- Spotify's Web API is not used: it no longer returns artist genres, and it has no full history.

## Sharing your results

**Share** (in the header) creates one self-contained, interactive `.html` file.

- **Contents:** summary statistics only. Never the ZIP, individual plays, or identifying fields.
- **Interactive:** the same charts, tabs, tooltips and view switches as the app.
- **No outside requests:** the report has its own strict CSP (`connect-src 'none'`, embedded
  images only).
- **Patterns** are month-level, so they need no extra rounding.
- **You choose:** sections (excluded sections are left out of the file, not just hidden), months
  only or exact days (rounds the data itself), embedded covers, title, name and list length.
- **Daily routine is off by default:** the calendar, time of day, sessions and single-day binges
  reveal when you are awake, away or busy.

Anything in the file is readable by anyone who opens it, including numbers that aren't on screen.

### Embedding plots in a blog

You can embed **single interactive plots** (not the whole report) in a post:

1. In the app, click **Embed** on a chart (on every Patterns section and on Explore charts), or
   open **Share** and choose **One plot, for embedding**, then pick a plot. Plots include the
   co-listening map, eras, tastes, lifecycles, top lists, timelines, eras and rankings for
   artists, albums and songs, whole albums, genres, and each Habits chart.
2. Click **Download plot**. You get a small file such as `map.html` with only that plot's
   data, still fully interactive (hover, zoom, selection, view switches).
3. Put the file on your site and embed it with the snippet the dialog shows (HTML or Hugo).

The report also posts its height to the parent page, so the iframe fits the plot. In a full
report, `report.html#albums&embed` shows one section and `report.html#plot=albums-eras&embed`
shows one plot.

For **Hugo**, put the files in `static/listening/` and copy
[`docs/hugo-shortcode.html`](docs/hugo-shortcode.html) to `layouts/shortcodes/listening.html`:

```html
{{/*
  Embed a listening report or one plot from it.
    src      path of the exported file (e.g. "listening/map.html"), required
    plot     one plot id (e.g. "map"); or section="albums" for a section of a full report
    theme    "light", "dark" or "auto" (follows the reader's device; the default)
    height   starting height in px, before the plot reports its own (default: typical per plot)
    title    accessible title of the frame
*/}}
{{ $id := printf "lr-%d" .Ordinal }}
{{ $target := .Get "section" | default "story" }}
{{ with .Get "plot" }}{{ $target = printf "plot=%s" . }}{{ end }}
{{ with .Get "theme" }}{{ $target = printf "%s&theme=%s" $target . }}{{ end }}
{{ $sizes := dict "albums-eras" (slice 680 660) "albums-list" (slice 1210 1050) "albums-ranks" (slice 1010 790) "albums-timeline" (slice 1020 700) "albums-whole" (slice 1070 820) "artists-eras" (slice 680 660) "artists-list" (slice 1150 1000) "artists-ranks" (slice 830 720) "artists-timeline" (slice 830 610) "eras" (slice 400 350) "genres-list" (slice 580 500) "genres-timeline" (slice 610 550) "habits-age" (slice 300 280) "habits-calendar" (slice 450 580) "habits-comebacks" (slice 290 260) "habits-discovery" (slice 770 670) "habits-loyal" (slice 470 440) "habits-obsessions" (slice 930 700) "habits-sessions" (slice 790 600) "habits-shuffle" (slice 380 370) "habits-skips" (slice 1010 980) "habits-variety" (slice 460 410) "life" (slice 1280 1000) "map" (slice 860 880) "songs-eras" (slice 890 870) "songs-list" (slice 1850 1710) "songs-ranks" (slice 990 820) "songs-timeline" (slice 1000 740) "story" (slice 730 600) "tastes" (slice 860 730) }}
{{ $h := slice 640 640 }}
{{ with .Get "plot" }}{{ with index $sizes . }}{{ $h = . }}{{ end }}{{ end }}
{{ with .Get "height" }}{{ $h = slice . . }}{{ end }}
<style>#{{ $id }}{height:{{ index $h 1 }}px}@media (max-width:600px){#{{ $id }}{height:{{ index $h 0 }}px}}</style>
<iframe id="{{ $id }}" src="{{ printf "%s#%s&embed" (.Get "src" | relURL) $target | safeURL }}"
        title="{{ .Get "title" | default "Listening report" }}" loading="lazy" allowfullscreen
        style="width:100%;border:0;display:block"></iframe>
<script>
(function () {
  var f = document.getElementById("{{ $id }}");
  window.addEventListener("message", function (e) {
    if (e.source === f.contentWindow && e.data && e.data.type === "listening-report:height")
      f.style.height = e.data.height + "px";
  });
})();
</script>
```

Then, anywhere in a post:

```markdown
{{< listening src="listening/map.html" plot="map" title="Who I play together" >}}

{{< listening src="listening/albums-eras.html" plot="albums-eras" >}}
```

Options: `theme="light"` or `theme="dark"` fixes the plot's colours to match your blog (by
default it follows the reader's device); `height="500"` overrides the starting height (by default
each plot starts at its typical size, so the page does not jump while it loads).

Embedded plots adapt to the reader's device: they fill the post's column, size themselves to
their content, and use a compact layout (options in one menu, notes and secondary lists behind
toggles) so they stay short on phones. On touch screens one finger scrolls the page and two
fingers move or zoom the map; **Full screen** gives one-finger panning. Plot ids: `map`, `eras`,
`tastes`, `life`, `artists-list`, `artists-eras`, `artists-timeline`, `artists-ranks` (and the
same for `albums-` and `songs-`), `albums-whole`, `genres-timeline`, `genres-list`, `story`,
`habits-discovery`, `habits-variety`, `habits-skips`, `habits-shuffle`, `habits-age`,
`habits-comebacks`, `habits-loyal`, and the daily-routine ones `habits-calendar`,
`habits-sessions`, `habits-obsessions`.

## Development

`npm run dev` starts a hot-reloading dev server at http://localhost:5173 (without the CSP).

```sh
npm test            # Vitest unit tests
npm run typecheck   # TypeScript
npm run fixtures    # writes fixtures/generated/ (needed once before e2e; includes a 190 MB perf file)
npm run test:e2e    # Playwright against production builds (no baked data, then sample data)
```

The e2e suite checks the UI flows, that no network request is made, performance on a large
synthetic export, and the share report. Screenshots go to `screenshots/`. Tests build with
`NO_BAKED_GENRES=1` (or the sample files in `fixtures/`), never with your personal data.

```
src/core/     pure TypeScript: parsing, import, periods, aggregation, colours, flow, genres, insights,
              patterns/ (eras, tastes, co-listening, lifecycles)
src/worker/   Web Worker + testable Engine (holds the plays in typed arrays)
src/ui/       React components; charts are custom SVG (d3-shape / d3-scale)
src/report/   the share report: data types, HTML export, standalone viewer
scripts/      fixture generator and the optional MusicBrainz / Cover Art Archive scripts
fixtures/     deterministic synthetic export generator and sample genre data
tests/        unit/ (Vitest), e2e/ (Playwright)
```

## License

[MIT](LICENSE). You are free to use, modify and share this code. Album covers, genres and other
data you fetch with the optional scripts come from MusicBrainz and the Cover Art Archive under
their own terms, and are never part of this repository.
