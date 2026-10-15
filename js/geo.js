/*
 * Pure geometry helpers — no DOM. Runs in the browser (window.Geo) and in
 * node (module.exports) so the projection math is unit-testable.
 *
 * Two projections, picked by extent:
 *  - equirectangular with cos(mid-lat) x-scaling for city/state/country scale
 *  - the Natural Earth projection (polynomial pseudocylindrical) for
 *    continent/world scale, where equirectangular distorts badly
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Geo = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const RAD = Math.PI / 180;

  // walks Polygon/MultiPolygon (closed parts) and LineString/MultiLineString (open)
  function eachPart(geometry, fn) {
    if (!geometry) return;
    const t = geometry.type, c = geometry.coordinates;
    if (t === 'Polygon') for (const ring of c) fn(ring, true);
    else if (t === 'MultiPolygon') for (const poly of c) for (const ring of poly) fn(ring, true);
    else if (t === 'LineString') fn(c, false);
    else if (t === 'MultiLineString') for (const line of c) fn(line, false);
  }

  const isLine = (g) => g && (g.type === 'LineString' || g.type === 'MultiLineString');

  function eachCoord(features, fn) {
    for (const f of features) {
      if (f.geometry) eachPart(f.geometry, (part) => { for (const c of part) fn(c[0], c[1]); });
      else if (typeof f.lon === 'number') fn(f.lon, f.lat);
    }
  }

  function lonLatBounds(features) {
    let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
    eachCoord(features, (lon, lat) => {
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    });
    return { minLon, maxLon, minLat, maxLat };
  }

  // raw projections: lon/lat degrees -> unfitted planar coords (y grows north)
  function equirectCos(midLat) {
    const k = Math.cos(midLat * RAD);
    return (lon, lat) => [lon * k, lat];
  }

  function naturalEarth1(lon, lat) {
    const l = lon * RAD, p = lat * RAD, p2 = p * p, p4 = p2 * p2;
    return [
      l * (0.8707 - 0.131979 * p2 - 0.013791 * p4 +
        p4 * p4 * p2 * (0.003971 - 0.001529 * p2)),
      p * (1.007226 + p2 * (0.015085 + p4 * (-0.044475 + 0.028874 * p2 - 0.005916 * p4))),
    ];
  }

  /*
   * Antimeridian handling: find the widest empty longitude gap and cut the
   * map there, so e.g. the USA (Aleutians at +172°E) or Russia render
   * contiguously instead of stretching across the whole ±180° range.
   * Returns a lon-remapping function.
   */
  function lonCut(features) {
    const occupied = new Array(360).fill(false);
    eachCoord(features, (lon) => {
      occupied[((Math.round(lon) % 360) + 540) % 360] = true; // bin index for [-180,180)
    });
    let bestStart = 0, bestLen = 0, runStart = -1;
    for (let i = 0; i < 720; i++) {
      if (!occupied[i % 360]) {
        if (runStart < 0) runStart = i;
        if (i - runStart + 1 > bestLen && runStart < 360) {
          bestLen = i - runStart + 1;
          bestStart = runStart;
        }
      } else runStart = -1;
    }
    if (bestLen < 30) return (lon) => lon; // no meaningful gap (true world map)
    const g = ((bestStart + bestLen / 2) % 360) - 180; // cut meridian inside the gap
    return (lon) => ((((lon - g) % 360) + 360) % 360) - 180;
  }

  // Sutherland–Hodgman against one vertical line: the part of a closed ring
  // with x <= bound (keepLeft) or x >= bound. A half-plane is convex, so the
  // result is a single valid ring (possibly empty).
  function clipRing(ring, bound, keepLeft) {
    const inside = (p) => (keepLeft ? p[0] <= bound : p[0] >= bound);
    const cross = (a, b) => {
      const t = (bound - a[0]) / (b[0] - a[0]);
      return [bound, a[1] + t * (b[1] - a[1])];
    };
    const out = [];
    let prev = ring[ring.length - 1];
    for (const cur of ring) {
      if (inside(cur)) {
        if (!inside(prev)) out.push(cross(prev, cur));
        out.push(cur);
      } else if (inside(prev)) out.push(cross(prev, cur));
      prev = cur;
    }
    return out;
  }

  /*
   * A geometry as drawable parts in cut-space longitude. A ring the cut
   * meridian passes through (Russia or the US behind a Pacific-centred map)
   * would otherwise smear a stripe across the map, since its two halves land
   * on opposite edges. Unwrap such a ring so it's continuous, then clip one
   * copy to each edge — the shape renders as two pieces, one per edge.
   */
  function cutParts(geometry, cut) {
    const parts = [];
    eachPart(geometry, (part, isRing) => {
      const pts = part.map((c) => [cut(c[0]), c[1]]);
      if (!isRing) { parts.push({ pts, ring: false }); return; }
      let lo = Infinity, hi = -Infinity;
      for (let i = 0; i < pts.length; i++) {
        if (i > 0) {
          const d = pts[i][0] - pts[i - 1][0];
          if (d > 180) pts[i][0] -= 360;
          else if (d < -180) pts[i][0] += 360;
        }
        if (pts[i][0] < lo) lo = pts[i][0];
        if (pts[i][0] > hi) hi = pts[i][0];
      }
      if (lo >= -180 && hi <= 180) { parts.push({ pts, ring: true }); return; }
      for (const off of [-360, 0, 360]) {
        const shifted = pts.map((p) => [p[0] + off, p[1]]);
        const piece = clipRing(clipRing(shifted, 180, true), -180, false);
        if (piece.length >= 3) parts.push({ pts: piece, ring: true });
      }
    });
    return parts;
  }

  /*
   * Build a render scene from normalized pack features.
   *   features: [{id, name, geometry}] or [{id, name, lon, lat}] (points)
   *   context:  [{geometry}] — background-only shapes (may be empty)
   *   opts.bounds: [minLon, minLat, maxLon, maxLat] — fit the viewport to this
   *     window instead of the data extent (geometry may overflow off-map)
   * Returns {width, height, shapes, context} where polygon shapes carry an
   * SVG path `d` and point shapes carry planar {x, y}.
   */
  function buildScene(features, context, width, opts) {
    // the antimeridian cut comes from the quiz features alone — context can span
    // the globe (e.g. countries behind a US map) and would erase the gap
    const cut = lonCut(features);
    const fit = opts?.bounds;

    let b;
    if (fit) {
      b = { minLon: cut(fit[0]), maxLon: cut(fit[2]), minLat: fit[1], maxLat: fit[3] };
    } else {
      // fit the viewport to the quiz features; context is backdrop and may overflow
      b = { minLon: Infinity, maxLon: -Infinity, minLat: Infinity, maxLat: -Infinity };
      eachCoord(features, (lon, lat) => {
        const l = cut(lon);
        if (l < b.minLon) b.minLon = l;
        if (l > b.maxLon) b.maxLon = l;
        if (lat < b.minLat) b.minLat = lat;
        if (lat > b.maxLat) b.maxLat = lat;
      });
      const padLon = (b.maxLon - b.minLon) * 0.05 || 0.01;
      const padLat = (b.maxLat - b.minLat) * 0.05 || 0.01;
      b.minLon -= padLon; b.maxLon += padLon;
      b.minLat -= padLat; b.maxLat += padLat;
    }
    const world = (b.maxLon - b.minLon) > 110 || (b.maxLat - b.minLat) > 65;
    const project = world ? naturalEarth1 : equirectCos((b.minLat + b.maxLat) / 2);

    // fit box: sample the bounds rectangle's edges through the projection
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let i = 0; i <= 48; i++) {
      const lon = b.minLon + ((b.maxLon - b.minLon) * i) / 48;
      const lat = b.minLat + ((b.maxLat - b.minLat) * i) / 48;
      for (const [x, y] of [
        project(lon, b.minLat), project(lon, b.maxLat),
        project(b.minLon, lat), project(b.maxLon, lat),
      ]) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
    const scale = width / (maxX - minX);
    const height = (maxY - minY) * scale;
    // cut-space longitude in, screen px out; px() is the raw-longitude version
    const pxCut = (x, lat) => {
      const [X, Y] = project(x, lat);
      return [(X - minX) * scale, (maxY - Y) * scale];
    };
    const px = (lon, lat) => pxCut(cut(lon), lat);

    const toPath = (geometry) => cutParts(geometry, cut).map(({ pts, ring }) =>
      'M' + pts.map(([x, lat]) => {
        const [X, Y] = pxCut(x, lat);
        return X.toFixed(2) + ' ' + Y.toFixed(2);
      }).join('L') + (ring ? 'Z' : '')
    ).join('');

    const shapes = features.map((f) => {
      if (f.geometry) {
        return { id: f.id, name: f.name, d: toPath(f.geometry), line: isLine(f.geometry) };
      }
      const [x, y] = px(f.lon, f.lat);
      return { id: f.id, name: f.name, x, y };
    });

    // reference layers ride along in the same projection but never influence the
    // fit — they're an underlay, and the SVG viewBox clips whatever overflows
    const reference = {};
    for (const [layer, geoms] of Object.entries(opts?.reference || {})) {
      if (!Array.isArray(geoms)) continue;
      reference[layer] = geoms.map((g) => ({ d: toPath(g), line: isLine(g) }))
        .filter((s) => s.d);
    }

    return {
      width, height,
      shapes,
      context: (context || []).map((f) => toPath(f.geometry)),
      reference,
    };
  }

  return { lonLatBounds, buildScene, naturalEarth1, equirectCos };
});
