# Map Games

Seterra-style blank-map quizzes at any scale — countries and capitals, states and
provinces, US counties and townships and ZIP codes, and city layers like neighborhoods,
transit lines, major roads, parks and landmarks.

Pick what to quiz, scope it to a region, then choose a level of detail (Quick / Standard /
Everything) or a precise filter ("top 20 by population", "NATO members", "capitals only",
hand-picked). ~1,350 data packs, 18 presets, and an in-app builder; custom quizzes save to
your library.

## Run

```sh
node tools/fetch-packs.mjs   # download prebuilt quiz data (~66MB)
node tools/serve.mjs         # → http://localhost:8017
```

Node 18+; no dependencies to install. A server is required because quiz data loads
via fetch; any static server works.

Only want part of it? The data ships in tiers:

```sh
node tools/fetch-packs.mjs --world        # countries, states/provinces, districts (16MB)
node tools/fetch-packs.mjs --us           # US counties, townships, places (14MB)
node tools/fetch-packs.mjs --city boston  # one city's neighborhoods/transit/roads (<1MB)
node tools/fetch-packs.mjs --list         # everything on offer
```

You can also build every pack from the original sources instead — see [DATA.md](DATA.md) —
but that takes hours and leans on volunteer-run servers, so prefer the download.

## Play

- You're prompted with a name; click it on the map.
- 1st try = green, 2nd = yellow, 3rd = orange. After 3 misses the answer is revealed in red.
- A wrong click briefly names the thing you actually clicked — misses teach you the map.
- Muted shapes are context only (not in the quiz) and aren't clickable.
- Scroll to zoom, drag to pan. Hovering solved/revealed shapes shows their name.
- At the end: play again with everything, or retry only what you missed.

## Project layout

```
index.html            app shell: library, builder, play views
css/styles.css        theme tokens (light + dark) and all styling
js/geo.js             projections + GeoJSON→SVG scene building (pure, node-testable)
js/data.js            pack loading + quiz-config resolution (pure-ish, node-testable)
js/engine.js          the game loop: rendering, zoom/pan, guesses, scoring
js/app.js             routing, library, builder UI
data/index.json       catalog of packs + menu lists (generated)
data/groups.json      membership lists (NATO, EU, G7, G20, ASEAN) by ISO A3 (generated)
data/presets.json     starter quiz library (hand-written configs)
data/packs/           ~1,350 normalized packs, ~260MB (generated, not in git)
tools/build-packs.mjs the data pipeline (one function per step; see DATA.md)
tools/fetch-packs.mjs download prebuilt packs from the latest GitHub release
tools/release-packs.mjs bundle packs into tiered tarballs and publish them
tools/add-pack.mjs    turn any GeoJSON of your own into a playable pack
tools/serve.mjs       zero-dependency static server
tools/test-resolve.mjs node smoke test: resolves every preset through real code paths
tools/build-artifact.mjs single-file bundle with a curated pack subset (dist/)
```

## Documentation

- **[DECISIONS.md](DECISIONS.md)** — why the project is built this way, and the traps
  that shaped it. Read before changing architecture.
- **[CLAUDE.md](CLAUDE.md)** — orientation for picking the codebase up cold: layout,
  conventions, how to test and ship.
- **[DATA.md](DATA.md)** — every data source, the pipeline, and bringing your own.
- **[BACKLOG.md](BACKLOG.md)** — deferred ideas, each with the reason it was deferred.

## Data

**Full documentation in [DATA.md](DATA.md)** — every source (all keyless bulk downloads,
no scraping), the pipeline steps, the pack format, licenses/attribution, and how to plug
in your own GeoJSON for your own country or city:

```sh
node tools/add-pack.mjs my-districts.geojson --id my-districts \
  --label "Districts of My City" --name-prop NAME
```

→ appears in the builder under **Custom packs**. Generated data is gitignored (a fresh
clone runs `node tools/build-packs.mjs all`); custom packs are kept.

## How data flows

1. **Pipeline** (`node tools/build-packs.mjs all`, ~30–60 min first run, ~800MB of sources
   cached in `tools/cache/`; each step also runs standalone — `download`, `convert`, `pops`,
   `geonames`, `adm2`, `hoods`, `osm`, `basemaps`, `civic`, `emit`). Sources, all keyless
   bulk downloads:
   - **Natural Earth**: admin-0 countries, admin-1 states/provinces, populated places
     (major cities with population + capital flags)
   - **US Census cartographic boundaries** (1:500k): counties, county subdivisions
     (townships), places — population joined from the keyless Census Vintage-2024 estimate
     CSVs (the ACS API now requires an API key)
   - **GeoNames** `cities500`: every named place with 500+ population (~200k cities
     worldwide) with population, capital flags, and state/province membership
   - **geoBoundaries** ADM2: county/district-level polygons for ~180 countries (CC-BY)
   - **click-that-hood**: community-curated neighborhood polygons for ~250 cities
     (US-heavy; OSM-derived, ODbL)
   - **OpenStreetMap** via Overpass: per-city transit lines and stations, major roads,
     rivers, trails, parks and landmarks, plus the map reference underlay
   - **Census ZCTA / school districts**: ZIP codes and school-district boundaries

   Everything is simplified via mapshaper and emitted as normalized packs:
   `{kind: 'polygon'|'point', features: [{id, name, pop, capital?, continent?, country?,
   county?, admin1?, geometry|lon/lat}]}`. IDs are stable (ISO A3, ISO 3166-2, Census
   GEOID, GeoNames id, geoBoundaries shapeID).

2. **Quiz configs** are small and declarative — this is what presets and saved quizzes store:

   ```json
   { "title": "China: 20 Biggest Cities",
     "pack": "cities",
     "scope": { "country": "CHN" },
     "select": { "mode": "topPop", "n": 20 },
     "bounds": [-25, 34, 45, 72] }   // optional viewport crop (see Europe presets)
   ```

   Select modes: `detail` (Quick/Standard/Everything), `top` (by population, or by
   prominence where population doesn't exist), `all`, `independent`, `minPop`, `group`,
   `capitals`, `manual`. `js/data.js` resolves a config into the engine's quiz shape.

3. **Rendering** (`js/geo.js`): equirectangular with cos(mid-lat) x-scaling at city/state/
   country scale; the Natural Earth projection beyond ~110° of longitude or ~65° of latitude.
   Antimeridian-crossing regions (USA with the Aleutians, Russia) are handled by finding the
   widest empty longitude gap and cutting the map there. Point quizzes draw the country's
   admin-1 divisions (or country outlines) as non-interactive context under the pins.

## Tests

```sh
node tools/test-resolve.mjs   # resolves all presets, checks scenes for missing/broken shapes
```

Visual spot-checks work headlessly: `?play=<preset-id>` deep-links straight into a quiz, so
`chrome --headless --screenshot=... "http://localhost:8017/?play=us-states"` renders any map.

## Single-file build

`node tools/build-artifact.mjs` → `dist/map-games.html` (~14MB, cap is 16MB): the app plus
world countries, every admin-1 and US county pack, and a starter set of city layers.
Presets whose packs aren't bundled are dropped from that build; the local app has everything.

## Known limits (see BACKLOG.md)

- US states map: Alaska/Hawaii at true positions makes the mainland small (no Albers insets).
- Natural Earth files Russia under Europe; the Europe presets handle it with a `bounds` crop.
- admin-1 features have no population data (Natural Earth doesn't carry it), so those
  quizzes only offer all/manual selection.
