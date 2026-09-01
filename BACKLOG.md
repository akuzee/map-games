# Backlog

Deferred ideas, with why they were deferred. Nothing here is committed-to.

(Done since the POC: flexible builder, point-city quizzes, population filters,
membership groups, quiz library, stable-ID targets.)

## From the original brief

- **Spaced repetition** — track per-item performance across sessions (localStorage first) and
  bias/schedule prompts toward weak items. Deferred: needs a persistence design; now that the
  library exists it's the next high-value feature.
- **Other geographic features** — rivers, mountains, lakes, etc. (line targets, not just
  polygons/points). Deferred: needs line hit-testing (click radius) and a Natural Earth
  physical-features pipeline step.
- **Official-source neighborhoods** — the click-that-hood dataset (now integrated) covers
  ~200 cities but is community-maintained. City open-data portals (Boston, NYC NTAs,
  Chicago community areas, SF, LA Times boundaries…) are more authoritative; worth a
  per-city curation pass for cities the user actually studies. OSM/Overpass admin_level
  9–10 remains the fallback for cities in neither.

## Next up: street-level city quizzes (feasibility confirmed 2026-09-01)

Train lines, highways/main roads, and public spaces for US cities. Verified with live
queries — the data exists and is good:

- **Transit lines**: OSM route relations carry names, official brand colors, and refs
  (checked: MBTA returns Red/Orange/Blue with `colour: #DA291C` etc.; dedupe by `ref` —
  one relation per direction). Alternative: agency GTFS feeds (`shapes.txt` + route
  colors; MBTA's is a public 39MB zip) — cleaner geometry, one integration per agency.
- **Major roads**: OSM `highway=motorway|trunk|primary` (checked: central Boston = 4,385
  way segments merging into 197 distinct named roads — Mass Ave, Beacon St, Comm Ave…).
  Segments must be merged by name into MultiLineStrings; same-named streets in adjacent
  municipalities merge together, so quizzes want top-N-by-length or manual selection.
- **Public spaces**: OSM `leisure=park` polygons — same mechanism, no new work.
- **Functional districts** (financial, shopping): the weak one — OSM `place=quarter` /
  `landuse=commercial|retail` is spotty and unnamed. Realistic path: manual curation via
  the custom-pack tool, not a pipeline.

Engine work required (the only real gap — everything today is polygons or points):
1. `geo.js`: project LineString/MultiLineString into open SVG paths (no Z-close).
2. `engine.js`: a third target kind `line` — visible stroked path plus an invisible fat
   hit path (`pointer-events: stroke`, non-scaling ~14px stroke) since nobody can click a
   2px line; answer colors apply to stroke, not fill.
3. Pipeline: an `overpass` step — per-city cached queries (be polite: one request per
   city per layer), merge segments by name/ref, emit `kind: "line"` packs.

## The data horizon (assessed 2026-09-01: political/admin data is essentially exhausted)

- **Physical geography** — rivers, lakes, mountain ranges/peaks, seas, deserts, islands
  via Natural Earth physical (bulk, same pipeline; engine already handles line/polygon/
  point). The biggest remaining content win — last core Seterra category missing.
- **Flags** — public-domain flag image sets keyed by ISO codes we already carry; the quiz
  is the same click mechanic with an image prompt instead of a name. Small engine change.
- **Historical borders** — CShapes 2.0 (country borders back to ~1886) for "Europe in
  1914"-style quizzes. Niche; as-we-go.
- **Heavier GIS (rasters)** — elevation/terrain shading behind physical quizzes,
  population-density surfaces (Kontur/WorldPop) for auto "top N" filters anywhere, land
  cover. Unlocks presentation and computation, not new quiz content; defer until wanted.
- **Verdict** — after physical geo + flags, the highest-value work is gameplay (spaced
  repetition above all), not more data.

## City-view layer ideas (all OSM/Overpass unless noted; same machinery as roads/transit)

- **Transit stations as points** — "stations of the Red Line" (from the same route
  relations, or GTFS `stops.txt`); pairs naturally with spaced repetition for commuters.
- **Rivers, canals, waterfronts** — line targets, same engine work as roads.
- **Bridges & tunnels** — named `man_made=bridge` / tunnels (Zakim, Ted Williams…).
- **Universities & campuses** — `amenity=university` polygons.
- **Parks + squares/plazas** — `leisure=park`, `place=square`.
- **Stadiums, arenas, museums, landmarks** — `leisure=stadium`, `tourism=museum|attraction`,
  `historic=*` (points/polygons).
- **Airports** — `aeroway=aerodrome`.
- **Trails & greenways** — `route=hiking|bicycle` relations (Emerald Necklace, Minuteman).
- **ZIP codes** — Census ZCTA polygons (bulk download, same as other Census layers).
- **Council districts / wards / school districts** — city open-data portals or NCES;
  per-city curation via the custom-pack tool.

## Ideas that came up while building

- **Brand-color reveal for transit lines** — transit packs store each line's official
  color (`color`, from OSM `colour`); on solve, the line could take its brand color
  instead of / alongside the attempt color. Stored but unused so far.
- **Overpass patience** — public Overpass mirrors rate-limit aggressively; the `osm` step
  is resumable and just needs to be left running. For bulk needs, Geofabrik extracts +
  osmium would replace the API entirely.

- **Albers-style insets for the US states map** — Alaska/Hawaii at true positions leave the
  mainland small. An inset transform (like d3's geoAlbersUsa) fixes it; applies to any
  far-flung-territory country (France's DOM, etc.).
- **Type mode** — Seterra's second mode: the region highlights and you type its name.
- **Pinch-to-zoom** — current zoom/pan is wheel + drag + buttons; two-pointer pinch not implemented.
- **Reveal-then-click** — Seterra makes you click the flashing revealed answer to continue
  (rehearsal effect); we auto-advance after a pause. Worth A/B-ing for learning value.
- **Duplicate names in one quiz** — targets key on stable IDs now, but the *prompt* is a bare
  name, so two "Springfield"s in one quiz would be ambiguous. Disambiguate prompts with the
  parent region ("Springfield, MO") when a round contains duplicate names.
- **Non-US population data** — Natural Earth admin-1 carries no population; joining Wikidata
  or GeoNames would enable "top N" filters for provinces worldwide.
- **Shareable quiz links** — configs are small JSON; encode them in the URL hash so a custom
  quiz can be sent to someone. (`?play=` currently only covers presets.)
- **Country-scoped city quizzes beyond the big list** — the cities pack keeps 100k+ and
  capitals (~3,100). GeoNames would allow smaller cities and "cities of a US state".
