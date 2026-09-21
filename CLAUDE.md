# Working on Map Games

Orientation for an AI agent (or a human) picking this up cold. Read
[DECISIONS.md](DECISIONS.md) before changing architecture — it records why things are the
way they are, and the traps already paid for.

## Get it running

```sh
node tools/fetch-packs.mjs   # quiz data (not in git — see DECISIONS.md §3)
node tools/serve.mjs         # → http://localhost:8017
```

A server is required: packs load via `fetch`, which `file://` blocks.

## Where things live

| Path | What |
|---|---|
| `index.html` | All markup: header/HUD, home, builder, play views |
| `js/app.js` | View routing, quiz library, the builder UI |
| `js/data.js` | Pack loading; resolves a quiz config into a renderable quiz |
| `js/geo.js` | Projections, antimeridian cut, GeoJSON → SVG paths. Pure, node-testable |
| `js/engine.js` | Rendering + the game loop (guessing, scoring, zoom/pan, hover) |
| `css/styles.css` | Theme tokens (light/dark) and all styling |
| `tools/build-packs.mjs` | The data pipeline — one function per step |
| `tools/cities.json` | The cities that get their own OSM layer fetch |
| `data/presets.json` | Starter quiz library (hand-written configs) |

## Conventions

- **No dependencies in the app.** The pipeline may shell out to `npx mapshaper`.
- **Comments explain why, not what.** Match the surrounding density — sparse, and only
  where a reader would otherwise be puzzled.
- **Theme via tokens.** Never hardcode a color; add a token to all three theme blocks
  (`:root`, the `prefers-color-scheme: dark` block, and `[data-theme="dark"]`).
- **Targets key on stable IDs**, never names (GEOID, ISO codes, OSM ids). Names collide.

## Before you commit

```sh
node --check js/*.js                 # syntax
node tools/test-resolve.mjs          # resolves every preset through the real code
```

Then look at it. A map bug is usually invisible to tests and obvious in a screenshot:

```sh
# any preset can be deep-linked and shot headlessly
chrome --headless --disable-gpu --screenshot=out.png --window-size=1400,900 \
  --virtual-time-budget=9000 "http://localhost:8017/?play=boston-neighborhoods"
```

To drive the UI (builder, clicking, hover), inject a script into a copy of `index.html`
and `--dump-dom` the result — see the git history for examples. Note that synthetic
`PointerEvent`s have no active pointer, so `setPointerCapture` throws; it's wrapped in a
try/catch for exactly this reason.

## Changing the pipeline

Steps are independent and cached — `node tools/build-packs.mjs <step>`:
`download`, `convert`, `pops`, `geonames`, `adm2`, `hoods`, `osm`, `basemaps`, `civic`,
`emit`. Only `emit` is fast; the rest download. To force a refresh, delete the relevant
files under `tools/cache/` first.

`emit` is the only step that writes `data/packs/` and `data/index.json`. If you change
pack *shape*, update `js/data.js` to match and re-run `emit` alone.

Adding a city to the OSM layers: append `{slug, label, lat, lon, r}` to
`tools/cities.json`, then run `osm` and `emit`.

## Shipping

```sh
node tools/build-artifact.mjs        # dist/map-games.html, must stay under 16MB
node tools/release-packs.mjs --publish   # tiered tarballs → GitHub release
```

The artifact inlines a curated subset of packs and drops presets whose packs aren't
included, so the shared build never offers a card that errors.

## Current state

The data era is essentially closed: ~1,350 packs spanning world countries down to city
transit lines and ZIP codes. The highest-value remaining work is gameplay, not data —
spaced repetition first. See [BACKLOG.md](BACKLOG.md), which records what was deferred
and why.
