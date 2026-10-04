// Metodo strutturato per i link di Google Maps e Apple Maps (milestone M3).
// Funzioni pure, testate in tests/legs.test.mjs.
//
// Google e Apple non importano un GPX: accettano partenza, arrivo e pochi punti intermedi,
// poi ricalcolano il percorso a modo loro. Per tenerli sul giro voluto si aggiungono dei
// "punti di forzatura" (anchor) sulla strada scelta e si divide il giro in tratte, una per link.

import { haversine, cumulativeDistances } from './core.js?v=202610041740';

// Tutte le costanti in un posto solo (limiti verificati il 4/10/2026, vedi docs/verifiche.md)
export const LINKS = Object.freeze({
  GOOGLE_MOBILE_WAYPOINTS: 3, // documentazione Google Maps URLs: 3 su browser mobile
  GOOGLE_DESKTOP_WAYPOINTS: 9, // 9 altrove
  APPLE_WAYPOINTS: 3, // Apple non dichiara un limite: si parte prudenti, DA VERIFICARE su iPhone
  GOOGLE_MAX_URL: 2048, // caratteri
  ANCHOR_EVERY_KM: 10, // un punto di forzatura al massimo ogni ~10 km
  DIVERGENCE_M: 300, // oltre questa distanza dalla strada "veloce" il giro diverge
  JUNCTION_GAP_M: 60, // distanza minima dei punti di forzatura dagli incroci
  MIN_GAP_M: 800, // punti di forzatura più vicini di così tra loro o a una tappa si scartano
  SAMPLE_M: 100, // passo del confronto con la strada veloce
  DECIMALS: 5, // coordinate nei link (~1 m)
});

// ---------------------------------------------------------------------------
// Confronto con la strada "veloce": griglia per cercare in fretta il segmento più vicino
// ---------------------------------------------------------------------------

const CELL = 0.01; // gradi (~1 km)

function buildGrid(line) {
  const grid = new Map();
  const key = (i, j) => `${i}:${j}`;
  for (let k = 1; k < line.length; k++) {
    const a = line[k - 1];
    const b = line[k];
    const i0 = Math.floor(Math.min(a[0], b[0]) / CELL);
    const i1 = Math.floor(Math.max(a[0], b[0]) / CELL);
    const j0 = Math.floor(Math.min(a[1], b[1]) / CELL);
    const j1 = Math.floor(Math.max(a[1], b[1]) / CELL);
    for (let i = i0; i <= i1; i++)
      for (let j = j0; j <= j1; j++) {
        const id = key(i, j);
        if (!grid.has(id)) grid.set(id, []);
        grid.get(id).push(k);
      }
  }
  return { grid, key };
}

function segDistance(p, a, b) {
  const k = Math.cos((p[0] * Math.PI) / 180);
  const ax = a[1] * k;
  const ay = a[0];
  const dx = b[1] * k - ax;
  const dy = b[0] - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((p[1] * k - ax) * dx + (p[0] - ay) * dy) / len2)) : 0;
  return haversine(p, [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
}

/** Distanza in metri dalla linea `other` (Infinity se oltre ~1 km: basta sapere che è lontana). */
function distanceToGrid(p, other, idx) {
  const i = Math.floor(p[0] / CELL);
  const j = Math.floor(p[1] / CELL);
  let best = Infinity;
  for (let di = -1; di <= 1; di++)
    for (let dj = -1; dj <= 1; dj++) {
      const segs = idx.grid.get(idx.key(i + di, j + dj));
      if (!segs) continue;
      for (const k of segs) best = Math.min(best, segDistance(p, other[k - 1], other[k]));
    }
  return best;
}

/**
 * Tratti del giro voluto lontani più di `threshold` metri dalla strada veloce.
 * Restituisce [{ from, to }] in metri lungo il giro.
 */
export function divergences(shape, fastShape, threshold = LINKS.DIVERGENCE_M, step = LINKS.SAMPLE_M) {
  if (!fastShape || fastShape.length < 2) return [];
  const idx = buildGrid(fastShape);
  const cum = cumulativeDistances(shape);
  const total = cum[cum.length - 1];
  const out = [];
  let open = null;
  let seg = 1;
  for (let d = 0; d <= total; d += step) {
    while (seg < shape.length - 1 && cum[seg] < d) seg++;
    const a = shape[seg - 1];
    const b = shape[seg];
    const len = cum[seg] - cum[seg - 1];
    const t = len ? (d - cum[seg - 1]) / len : 0;
    const p = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    const far = distanceToGrid(p, fastShape, idx) > threshold;
    if (far && !open) open = { from: d, to: d };
    else if (far) open.to = d;
    else if (open) {
      out.push(open);
      open = null;
    }
  }
  if (open) out.push(open);
  return out;
}

// ---------------------------------------------------------------------------
// Punti di forzatura
// ---------------------------------------------------------------------------

/** Punto alla distanza d lungo la geometria. */
function pointAt(shape, cum, d) {
  let lo = 1;
  let hi = shape.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] < d) lo = mid + 1;
    else hi = mid;
  }
  const a = shape[lo - 1];
  const b = shape[lo];
  const len = cum[lo] - cum[lo - 1];
  const t = len ? (d - cum[lo - 1]) / len : 0;
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/**
 * Sposta la distanza d a metà di un tratto di strada, lontano dagli incroci
 * (`junctions` = distanze delle manovre, ordinate).
 */
export function awayFromJunctions(d, junctions, total, gap = LINKS.JUNCTION_GAP_M) {
  let a = 0;
  let b = total;
  for (const j of junctions) {
    if (j <= d) a = j;
    else {
      b = j;
      break;
    }
  }
  if (b - a < 2 * gap) return (a + b) / 2; // tratto corto: a metà
  return Math.min(b - gap, Math.max(a + gap, d));
}

/**
 * Punti di forzatura sul giro: uno ogni ~10 km e due dentro ogni tratto in cui il giro
 * si allontana dalla strada veloce. Mai sugli incroci, mai troppo vicini tra loro o alle tappe.
 * `stopsAt` = distanze delle tappe lungo il giro; `junctionsAt` = distanze delle manovre.
 * Restituisce [{ lat, lon, at, reason: 'distanza' | 'deviazione' }] ordinati.
 */
export function placeAnchors({ shape, stopsAt, junctionsAt = [], divergent = [], everyKm = LINKS.ANCHOR_EVERY_KM }) {
  const cum = cumulativeDistances(shape);
  const total = cum[cum.length - 1];
  const junctions = [...junctionsAt].sort((x, y) => x - y);
  const wanted = [];
  // dove il giro diverge dalla strada veloce: dentro il tratto, sulla strada voluta
  for (const r of divergent) {
    const len = r.to - r.from;
    if (len < 2 * LINKS.MIN_GAP_M) wanted.push({ at: (r.from + r.to) / 2, reason: 'deviazione' });
    else {
      wanted.push({ at: r.from + len * 0.25, reason: 'deviazione' });
      wanted.push({ at: r.from + len * 0.75, reason: 'deviazione' });
    }
  }
  // e comunque almeno ogni ~10 km tra una tappa e l'altra
  const stops = [...stopsAt].sort((x, y) => x - y);
  const step = everyKm * 1000;
  for (let s = 1; s < stops.length; s++) {
    const a = stops[s - 1];
    const b = stops[s];
    const n = Math.floor((b - a) / step);
    for (let k = 1; k <= n; k++) {
      const at = a + ((b - a) * k) / (n + 1);
      wanted.push({ at, reason: 'distanza' });
    }
  }
  wanted.sort((x, y) => x.at - y.at);
  const out = [];
  for (const w of wanted) {
    const at = awayFromJunctions(w.at, junctions, total);
    const nearStop = stops.some((s) => Math.abs(s - at) < LINKS.MIN_GAP_M);
    const prev = out[out.length - 1];
    if (nearStop) continue;
    if (prev && at - prev.at < LINKS.MIN_GAP_M) {
      if (w.reason === 'deviazione' && prev.reason === 'distanza') out[out.length - 1] = { ...prev, at, reason: w.reason };
      continue;
    }
    out.push({ at, reason: w.reason });
  }
  return out.map((a) => {
    const [lat, lon] = pointAt(shape, cum, a.at);
    return { lat, lon, at: a.at, reason: a.reason };
  });
}

// ---------------------------------------------------------------------------
// Tratte e link
// ---------------------------------------------------------------------------

/**
 * Sequenza tappe + punti di forzatura, ordinata lungo il giro.
 * `stops` = [{ lat, lon, name, at }], `anchors` = risultato di placeAnchors.
 */
export function routePointsSequence(stops, anchors) {
  // a parità di distanza le tappe restano nel loro ordine, prima dei punti di forzatura (sort stabile)
  return [
    ...stops.map((s) => ({ lat: s.lat, lon: s.lon, name: s.name, at: s.at, kind: 'tappa' })),
    ...anchors.map((a) => ({ lat: a.lat, lon: a.lon, at: a.at, kind: 'anchor', reason: a.reason })),
  ].sort((x, y) => x.at - y.at || (x.kind === 'tappa' ? 0 : 1) - (y.kind === 'tappa' ? 0 : 1));
}

/**
 * Divide la sequenza in tratte da al massimo `maxWaypoints` punti intermedi.
 * Tratte consecutive condividono l'estremo. Se possibile la tratta finisce su una tappa
 * (un posto dove ci si ferma comunque) invece che su un punto di forzatura.
 */
export function splitLegs(points, maxWaypoints) {
  const legs = [];
  let start = 0;
  while (start < points.length - 1) {
    let end = Math.min(points.length - 1, start + maxWaypoints + 1);
    if (end < points.length - 1) {
      // preferisce chiudere su una tappa, se ce n'è una nella seconda metà della tratta
      for (let k = end; k > start + Math.ceil((maxWaypoints + 1) / 2); k--) {
        if (points[k].kind === 'tappa') {
          end = k;
          break;
        }
      }
    }
    legs.push(points.slice(start, end + 1));
    start = end;
  }
  return legs;
}

const fmt = (p, dec = LINKS.DECIMALS) => `${p.lat.toFixed(dec)},${p.lon.toFixed(dec)}`;

/** Link di Google Maps per una tratta (formato Maps URLs, api=1). */
export function googleLink(leg) {
  const origin = leg[0];
  const dest = leg[leg.length - 1];
  const mid = leg.slice(1, -1);
  const params = [`api=1`, `origin=${fmt(origin)}`, `destination=${fmt(dest)}`, `travelmode=driving`];
  if (mid.length) params.push(`waypoints=${mid.map((p) => fmt(p)).join('%7C')}`);
  return `https://www.google.com/maps/dir/?${params.join('&')}`;
}

/**
 * Link di Apple Maps per una tratta (unified Maps URLs, iOS 18.4+): source, destination,
 * waypoint ripetuto, mode e avoid (tolls, highways) come da documentazione Apple.
 */
export function appleLink(leg, { avoidHighways = false, avoidTolls = false } = {}) {
  const origin = leg[0];
  const dest = leg[leg.length - 1];
  const params = [`source=${fmt(origin)}`, `destination=${fmt(dest)}`];
  for (const p of leg.slice(1, -1)) params.push(`waypoint=${fmt(p)}`);
  params.push('mode=driving');
  const avoid = [avoidTolls && 'tolls', avoidHighways && 'highways'].filter(Boolean);
  if (avoid.length) params.push(`avoid=${avoid.join(',')}`);
  return `https://maps.apple.com/directions?${params.join('&')}`;
}

/** Lunghezza in km della tratta lungo il giro (dagli estremi). */
export function legKm(leg) {
  return (leg[leg.length - 1].at - leg[0].at) / 1000;
}

/**
 * Tratte pronte per l'interfaccia, per una piattaforma:
 * [{ points, url, km, anchors, forced, tooLong }].
 */
export function buildLinks(points, platform, opts = {}) {
  const max =
    platform === 'apple' ? LINKS.APPLE_WAYPOINTS : platform === 'google-desktop' ? LINKS.GOOGLE_DESKTOP_WAYPOINTS : LINKS.GOOGLE_MOBILE_WAYPOINTS;
  return splitLegs(points, max).map((leg) => {
    const url = platform === 'apple' ? appleLink(leg, opts) : googleLink(leg);
    const anchors = leg.slice(1, -1).filter((p) => p.kind === 'anchor');
    return {
      points: leg,
      url,
      km: legKm(leg),
      anchors: anchors.length,
      forced: anchors.filter((a) => a.reason === 'deviazione').length,
      tooLong: platform !== 'apple' && url.length > LINKS.GOOGLE_MAX_URL,
    };
  });
}

/**
 * Modalità "solo tappe": senza percorso calcolato (servizio fuori uso o quota finita)
 * i link si fanno comunque con le sole tappe, e Google/Apple calcolano la strada da soli.
 */
export function stopsOnlySequence(stops) {
  let at = 0;
  return stops.map((s, i) => {
    if (i > 0) at += haversine([stops[i - 1].lat, stops[i - 1].lon], [s.lat, s.lon]);
    return { lat: s.lat, lon: s.lon, name: s.name, at, kind: 'tappa' };
  });
}
