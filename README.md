# Map Games

Seterra-style blank-map quizzes for any region: pick what to quiz (countries, states/
provinces, US counties, US townships, US cities, world cities), scope it to a region,
filter the targets ("top 20 by population", "NATO members", "capitals only", hand-picked),
and play. Ships with 10 presets and an in-app builder; custom quizzes save to the library.

## Run

```sh
node tools/serve.mjs        # → http://localhost:8017
```

(A server is required because quiz data loads via fetch; any static server works.)

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
data/packs/           376 normalized data packs, ~42MB (generated, gitignore-able)
tools/build-packs.mjs the data pipeline (download → convert → pops → emit)
tools/serve.mjs       zero-dependency static server
tools/test-resolve.mjs node smoke test: resolves every preset through real code paths
tools/build-artifact.mjs single-file bundle with a curated pack subset (dist/)
```

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
   `geonames`, `adm2`, `hoods`, `emit`). Sources, all keyless bulk downloads:
   - **Natural Earth**: admin-0 countries, admin-1 states/provinces, populated places
     (major cities with population + capital flags)
   - **US Census cartographic boundaries** (1:500k): counties, county subdivisions
     (townships), places — population joined from the keyless Census Vintage-2024 estimate
     CSVs (the ACS API now requires an API key)
   - **GeoNames** `cities500`: every named place with 500+ population (~200k cities
     worldwide) with population, capital flags, and state/province membership
   - **geoBoundaries** ADM2: county/district-level polygons for ~180 countries (CC-BY)
   - **click-that-hood**: community-curated neighborhood polygons for ~200 cities
     (US-heavy; OSM-derived, ODbL)

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

   Select modes: `all`, `independent` (countries), `topPop`, `minPop`, `group`, `capitals`,
   `manual`. `js/data.js` resolves a config against its pack into the engine's quiz shape.

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

`node tools/build-artifact.mjs` → `dist/map-games.html` (~8MB): the app plus world
countries, all admin-1 packs, all US county packs, MA townships/places, and cities.
Other packs show a "not included in this bundle" message; the local app serves everything.

## Known limits (see BACKLOG.md)

- US states map: Alaska/Hawaii at true positions makes the mainland small (no Albers insets).
- Natural Earth files Russia under Europe; the Europe presets handle it with a `bounds` crop.
- admin-1 features have no population data (Natural Earth doesn't carry it), so those
  quizzes only offer all/manual selection.
