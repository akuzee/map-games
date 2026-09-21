# Decisions

Why the project is shaped the way it is, and the traps that shaped it. Written for
whoever picks this up next (including a future me, or an AI agent). Each entry is the
decision, the reasoning at the time, and what it costs — so a later change is an informed
reversal rather than an accident.

Companion docs: [README](README.md) (what it is, how to run), [DATA.md](DATA.md) (sources
and pipeline), [BACKLOG.md](BACKLOG.md) (deferred ideas, with rationale).

---

## 1. No framework, no build step

Plain HTML/CSS/JS, four script files, zero dependencies (mapshaper runs via `npx` in the
pipeline only). The app is small enough that a framework would be the biggest thing in it.

**Costs:** manual DOM wiring in `js/app.js`. If a settings screen and per-quiz stats
arrive, revisit — that's the point where state management starts to pay for itself.

## 2. Quiz = declarative config over a pack

A quiz is a few lines of JSON (`pack`, `scope`, `select`, optional `bounds`), resolved at
runtime by `js/data.js`. Presets, the builder, and saved quizzes all produce the same
shape, so anything the builder can make can also be hand-written into `data/presets.json`.

**Why:** the alternative — baking a quiz per dataset — would have meant a code change per
quiz. This is what let the library go from 1 quiz to 1,300 packs without touching the engine.

## 3. Generated data never enters git

`data/packs/` is 258MB of regenerated output. Committing it would grow the repo without
bound on every rebuild. Instead: `tools/release-packs.mjs` publishes tiered tarballs to a
GitHub release; `tools/fetch-packs.mjs` pulls them. A yearly Action rebuilds.

**Why yearly:** the upstream sources (Census, Natural Earth, GeoNames) move annually at
most. More frequent runs would re-download identical bytes and lean on volunteer-run
Overpass servers for nothing.

**Costs:** a fresh clone needs one extra command before it can play. Accepted — the
alternative is a repo nobody can clone.

## 4. Three target kinds, one engine

`polygon` (regions), `point` (pins), `line` (transit, roads, rivers). Everything else —
scoring, reveal, retry-missed, hover — is shared.

Lines needed two non-obvious things:
- **A fat invisible hit path** per line (`.hitline`, ~16px, `pointer-events: stroke`).
  Nobody can click a 2px stroke.
- **Answer colors on `stroke`, not `fill`** — and the polygon `fill: …!important` rules
  had to be guarded with `:not(.town--line)` or solved lines turn into filled blobs.

## 5. Hand-rolled projection instead of d3-geo

`js/geo.js` is ~200 lines: equirectangular with cos(mid-latitude) x-scaling at city and
country scale, the Natural Earth projection beyond ~110° longitude or ~65° latitude.

**Antimeridian handling** is the subtle part: find the widest empty longitude band in the
*quiz features* and cut there, so Alaska's Aleutians don't stretch the US map across the
globe. Two rules learned the hard way:
- The cut must come from the quiz features alone. Including context (which can span the
  planet) erases the gap and un-splits Alaska.
- Context shapes that straddle the cut meridian must be dropped, or Russia smears
  horizontal stripes across a map of the United States.

**Trap:** `featsBbox()` returns longitudes in *cut space*. That is correct for rendering
and wrong for everything else. Passing it to Overpass once made the basemap fetch query
the French Pyrenees for Grand Rapids. `plainBbox()` is the raw-coordinate version — use it
for any API call or comparison against real coordinates.

## 6. Surrounding geography is baked into packs

A quiz drawn as shapes floating in a void is unplayable — you can't tell where you are.
Packs carry a `context` array (neighboring counties/states/countries), and scoped quizzes
also render the rest of their own pack muted.

## 7. The reference underlay, and its layer order

City quizzes additionally carry a `reference` pointer to a shared per-city file of water,
parks, and major roads. It's a separate file because a city has up to ten packs
(neighborhoods, ZIPs, seven OSM layers) that would each otherwise carry a copy.

Render order is load-bearing (`js/engine.js` → `render()`):

```
context land  →  region fills  →  reference (water/parks/roads)
              →  region borders  →  line & point targets  →  click targets
```

The reference sits **above** region fills so landmarks read *inside* the quiz area, and
every region border is then **redrawn on top** so the underlay can never blur the
boundaries being asked about. Line and point targets come last — they are the quiz.

**Filtering matters more than styling.** A fixed cap per layer is meaningless across
cities: Boston has 5,807 road fragments where Grand Rapids has ~1,300. Roads are merged by
name (→387 in Boston) and each layer is ranked by real size — length for roads and rivers,
area for parks and lakes — then capped. Calibrated so Grand Rapids reads well: ~15 roads,
~22 parks. Roads are dashed and desaturated specifically so they can never be confused
with region borders.

## 8. Prominence ranking, computed from OSM signals

"Top 10 landmarks" needs a notion of importance, and population doesn't exist for
landmarks or roads. Rather than an LLM labeling pass, `emitOsm()` scores structurally:

| Layer | Signal |
|---|---|
| Roads | length × class weight (motorway 3, trunk 2.2, primary 1) |
| Landmarks | type weight + Wikipedia tag (+40) + Wikidata tag (+15) |
| Transit stations | how many distinct lines pass within ~400m (grid index of line vertices) |
| Parks, lakes | polygon area |
| Transit lines, rivers, trails | total length |

Sanity check: Boston's landmarks rank Logan Airport first, then the universities; its
roads rank the Mass Pike and I-93 top. Good enough, and free. An LLM pass remains an
option if editorial judgment is ever wanted over structural signals.

## 9. Detail levels instead of counts

Wherever features are ranked, the builder's default control is a three-rung slider —
Quick / Standard / Everything — because people know whether they want the basics or the
whole thing, not whether they want 25 landmarks. Each dataset sets its own numbers (quick
is 6 roads but 12 countries). The level resolves to a count when saved, so a stored quiz
stays self-describing.

It appears **only** where ranking makes it meaningful. Fixed sets (NATO, school districts,
ZIPs, neighborhoods) keep all-or-pick; "the top 10 school districts" isn't a thing. The
rule is mechanical — a dataset gets the slider iff its features carry `rank` or `pop` — so
it stays correct as layers are added.

## 10. The builder is driven by dataset capability

`DATASETS` in `js/app.js` is the single source of truth: each entry declares its category
tab, what its region picker means, and which select modes it supports. Modes then decide
which fields appear. Population can't show up for transit lines, and membership groups
can't show up for cities, because those datasets don't list those modes.

**Trap that cost real confusion:** `.builder label { display: flex }` overrode the
`[hidden]` attribute, so fields the code had correctly hidden stayed on screen and
silently did nothing — typing "5" into a visible "How many" box while the mode was
"Everything" looked like a broken filter. `.builder [hidden] { display: none !important }`
is load-bearing; don't remove it.

---

## Operational notes

- **Overpass requires a User-Agent.** Node's `fetch` sends none, and Apache answers
  `406 Not Acceptable` — which looks like a query error but isn't. Expect 429/504s too;
  the fetch retries with backoff across mirrors and caches every response, so re-running
  a step only fetches what's missing.
- **Reference data is reused by coverage.** A neighborhood-scale quiz (the Bronx) borrows
  the download made for the city containing it (New York) when that covers ≥80% of its
  area. This is why the Bronx had an underlay before its own fetch ever ran.
- **`pkill -f "tools/serve.mjs"` is a footgun.** Other projects use the same filename; a
  sibling session killing "its" server kills this one too. Run it under a distinct name if
  that keeps happening.
- **Testing is headless Chrome, not a framework.** `?play=<preset-id>` deep-links straight
  into a quiz, so any map can be screenshotted in one command, and injecting a script into
  a copy of `index.html` drives the UI. `node tools/test-resolve.mjs` resolves every preset
  through the real code paths — run it after touching `geo.js`, `data.js`, or the pipeline.
- **Watch the artifact size cap.** `dist/map-games.html` must stay under 16MB; it's ~14.3MB
  now. `tools/build-artifact.mjs` picks which packs to inline and drops presets whose packs
  aren't bundled, so the shared build never shows a card that errors when clicked.
