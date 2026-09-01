# The data pipeline

Everything the game quizzes on comes from bulk open-data downloads — no scraping, no API
keys, no accounts. This doc explains where each dataset comes from, how it's processed,
the normalized format quizzes consume, and how to plug in your own data for your own
country or city.

## TL;DR

```sh
node tools/build-packs.mjs all     # ~30–60 min first run, ~800MB cached in tools/cache/
node tools/serve.mjs               # → http://localhost:8017
```

Re-runs are incremental: every download and conversion is cached and skipped if present.
To force a refresh of one dataset, delete its files from `tools/cache/` and re-run.

## Sources

| Dataset | Source | What it provides | License |
|---|---|---|---|
| Countries (admin-0) | [Natural Earth](https://www.naturalearthdata.com/) 1:50m | 241 country polygons, population, continent, sovereignty type | Public domain |
| States/provinces (admin-1) | Natural Earth 1:10m | First-level divisions for 206 countries | Public domain |
| Major world cities | Natural Earth populated places 1:10m | ~3,100 cities ≥100k pop + all national capitals, with population + capital flags | Public domain |
| All cities ≥500 pop | [GeoNames](https://download.geonames.org/export/dump/) `cities500` | ~200k places worldwide with population, capital flag, state/province membership | CC-BY 4.0 |
| Districts (admin-2) | [geoBoundaries](https://www.geoboundaries.org/) gbOpen | County/district polygons for ~180 countries | CC-BY 4.0 |
| US counties, townships, places | [US Census cartographic boundaries](https://www.census.gov/geographies/mapping-files/time-series/geo/cartographic-boundary.html) 1:500k | All US counties, county subdivisions, and incorporated places, with stable GEOIDs | Public domain |
| US population | [Census Vintage 2024 estimates](https://www.census.gov/programs-surveys/popest.html) CSVs | Population for every US county/township/place (the ACS *API* now needs a key; these CSVs don't) | Public domain |
| Neighborhoods | [click-that-hood](https://github.com/codeforgermany/click_that_hood) | Community-curated neighborhood polygons for ~250 cities | ODbL (OSM-derived) |
| City layers (transit lines & stations, major roads, rivers, trails, parks, landmarks) | [OpenStreetMap](https://www.openstreetmap.org/) via the [Overpass API](https://overpass-api.de/) | Per-city queries for the cities in `tools/cities.json` | ODbL |
| ZIP codes | Census ZCTA cartographic boundaries (2020) | All ~33k ZIP polygons, clipped per city | Public domain |
| School districts | Census unified school district boundaries (2023) | ~10k districts, split per state | Public domain |

If you redistribute generated packs, keep the attributions above (GeoNames and
geoBoundaries require attribution; click-that-hood data is ODbL share-alike).

## Pipeline steps

`tools/build-packs.mjs <step>` — each runs standalone, `all` runs everything in order:

1. **`download`** — curl + unzip Natural Earth and Census shapefiles into `tools/cache/`.
2. **`convert`** — shapefiles → GeoJSON via [mapshaper](https://github.com/mbloch/mapshaper)
   (run through `npx`, no install needed), with per-dataset simplification (countries 12%,
   admin-1 6%, US layers 22–25%) and coordinate precision trimming. Simplification uses
   `keep-shapes` so tiny islands survive.
3. **`pops`** — download the two Census estimate CSVs and build a GEOID → population map.
4. **`geonames`** — download `cities500.zip`, `countryInfo.txt` (ISO2→ISO3 mapping), and
   `admin1CodesASCII.txt` (state/province names for cities).
5. **`adm2`** — query the geoBoundaries catalog API once, download each country's
   simplified ADM2 GeoJSON (8 parallel fetches, skip-if-present), then mapshaper each
   to 30% / 3-decimal precision.
6. **`hoods`** — download the click-that-hood repo zip, mapshaper each city to
   25% / 4-decimal precision (neighborhoods need finer precision than countries).
7. **`osm`** — for each city in `tools/cities.json`, fetch seven layers from Overpass
   (transit lines/stations, major roads, rivers & canals, trails, parks, landmarks), one
   throttled query per city per layer, cached per file so re-runs only fetch what's
   missing. **Overpass is a shared community server** — this is the one step that isn't a
   bulk download, which is why city layers are fetched for a defined list rather than
   "everywhere". To add a city: append `{slug, label, lat, lon, r}` (r = bounding-box
   radius in degrees) to `tools/cities.json` and re-run `osm` + `emit`. Road segments are
   merged by name into MultiLineStrings and capped at the 120 longest; parks at the 60
   largest; landmarks are filtered to OSM features carrying a `wikidata` tag (a decent
   notability proxy).
8. **`civic`** — download Census ZCTA (ZIP) and unified-school-district boundaries;
   ZIPs are clipped to each city's box, school districts split per state.
9. **`emit`** — read all converted GeoJSON, normalize properties, join populations,
   attach continent/country/capital metadata, and write:
   - `data/packs/**.json` — one pack per quizzable map (~1,000 packs, ~170MB)
   - `data/index.json` — the catalog: every pack's id, kind, label, count, plus the
     menu lists the builder UI renders (continents, countries, US states, cities…)
   - `data/groups.json` — membership lists (NATO, EU, G7, G20, ASEAN) by ISO A3

## The pack format

A pack is one JSON file: a set of quizzable features on one map.

```jsonc
{
  "kind": "polygon",            // or "point" (pins) or "line" (transit/roads/rivers)
  "features": [
    {
      "id": "2500107000",        // stable unique id (never quiz on names — they collide)
      "name": "Boston",          // what the player is asked to find
      "pop": 673458,             // population, or null (enables top-N / min-pop filters)
      "capital": 1,              // optional, cities only
      "continent": "…",          // optional — anything here becomes scope-filterable
      "country": "USA",
      "county": "Suffolk",
      "admin1": "Massachusetts",
      "geometry": { "type": "MultiPolygon", "coordinates": [] }
      // point packs have "lon" and "lat" instead of "geometry"
    }
  ]
}
```

A quiz is then a small declarative config over a pack (see `data/presets.json`):

```jsonc
{
  "title": "China: 20 Biggest Cities",
  "pack": "cities",
  "scope": { "country": "CHN" },            // filter which features are on the map
  "select": { "mode": "topPop", "n": 20 },  // filter which of those are quizzed
  "bounds": [-25, 34, 45, 72]               // optional viewport crop (lon/lat box)
}
```

Select modes: `all`, `independent` (countries), `topPop`, `minPop`, `group`, `capitals`,
`manual` (explicit `ids` or `names`).

## Bring your own data

Any GeoJSON of named polygons or points can become a quiz in one command:

```sh
node tools/add-pack.mjs my-city-districts.geojson \
  --id my-city-districts \
  --label "Districts of My City" \
  --name-prop NAME            # which property holds the display name
  # optional: --pop-prop POPULATION   enables top-N/min-pop filters
  # optional: --id-prop GEOID         stable ids (defaults to the feature index)
```

This writes `data/packs/custom/<id>.json` and registers it in `data/index.json`; it then
appears in the builder under **Custom packs**. Custom packs survive pipeline re-runs
(`emit` preserves them). Point GeoJSON (cities, stations…) works the same way and renders
as pins.

Where to find GeoJSON for your area:

- **Your city's open-data portal** (search "<city> open data neighborhoods/districts
  geojson") — usually the most authoritative for local boundaries.
- **OpenStreetMap via [Overpass Turbo](https://overpass-turbo.eu/)** — query any boundary
  or feature type, export as GeoJSON.
- **National statistics/mapping agencies** (Eurostat GISCO, UK ONS, Statistics Canada…) —
  official administrative boundaries.
- **[geoBoundaries](https://www.geoboundaries.org/)** ADM3–ADM5 — deeper admin levels than
  the ADM2 the pipeline pulls.

Tip: run big files through mapshaper first (`npx mapshaper in.geojson -simplify 20%
keep-shapes -o precision=0.0001 out.geojson`) — the game doesn't need survey precision.

## Regenerating from scratch

`tools/cache/`, `data/packs/`, `data/index.json`, `data/groups.json`, and `dist/` are all
generated and gitignored (except `data/packs/custom/`, which is yours). A fresh clone just
runs `node tools/build-packs.mjs all`. Node 18+ required (uses global `fetch`); mapshaper
is fetched by `npx` automatically.
