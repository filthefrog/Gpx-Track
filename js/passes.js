// Passi di montagna: versanti, passo completo o andata e ritorno.
// Funzioni pure (nessuna rete, nessun DOM): testate in tests/passes.test.mjs.
//
// Idea: dalle strade OpenStreetMap attorno al passo (Overpass) si ricostruisce il
// grafo stradale, si individuano le strade che partono dalla cima (i versanti) e
// su ciascuna si prende un punto ~1,5 km sotto la cima. Quei punti, messi come
// "passaggi" prima e dopo il passo, obbligano il percorso a salire e scendere dal
// versante scelto.

import { haversine, pointSegmentDistance } from './core.js?v=202610041215';

export const PASS = Object.freeze({
  SEARCH_RADIUS: 5000, // metri attorno al passo da chiedere a Overpass
  MAX_SNAP: 300, // la cima deve essere a meno di così da una strada
  VIA_DISTANCE: 1500, // punto di controllo sul versante, sotto la cima
  NAME_DISTANCE: 5000, // punto per dare un nome al versante
  MIN_BRANCH: 400, // versanti più corti sono stradine senza uscita
});

const DRIVABLE = [
  'motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential',
  'motorway_link', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link',
];
const CLASS_RANK = { motorway: 6, trunk: 6, primary: 5, secondary: 4, tertiary: 3, unclassified: 2, residential: 1 };

/** Query Overpass per le strade percorribili attorno al passo. */
export function overpassQuery(lat, lon, radius = PASS.SEARCH_RADIUS) {
  return (
    '[out:json][timeout:25];' +
    `way(around:${radius},${lat.toFixed(6)},${lon.toFixed(6)})[highway~"^(${DRIVABLE.join('|')})$"];` +
    'out geom;'
  );
}

function classRank(tags = {}) {
  return CLASS_RANK[String(tags.highway || '').replace(/_link$/, '')] || 0;
}

/**
 * Grafo stradale dalle "way" di Overpass (out geom).
 * nodes: Map id → [lat, lon]; adj: Map id → [{ to, way }].
 */
export function buildRoadGraph(elements) {
  const nodes = new Map();
  const adj = new Map();
  const ways = [];
  for (const el of elements || []) {
    if (el.type !== 'way' || !Array.isArray(el.nodes) || !Array.isArray(el.geometry)) continue;
    if (el.nodes.length !== el.geometry.length || el.nodes.length < 2) continue;
    const tags = el.tags || {};
    const way = { id: el.id, tags, name: tags.ref || tags.name || '', rank: classRank(tags), nodes: el.nodes };
    ways.push(way);
    el.nodes.forEach((id, i) => {
      nodes.set(id, [el.geometry[i].lat, el.geometry[i].lon]);
      if (!adj.has(id)) adj.set(id, []);
      if (i > 0) {
        const prev = el.nodes[i - 1];
        adj.get(id).push({ to: prev, way });
        adj.get(prev).push({ to: id, way });
      }
    });
  }
  return { nodes, adj, ways };
}

/**
 * Aggancia la cima al grafo: se il punto più vicino sta a metà di un segmento,
 * aggiunge un nodo virtuale che lo divide. Restituisce l'id del nodo o null.
 */
export function attachSummit(graph, summit, maxDist = PASS.MAX_SNAP) {
  let best = null;
  for (const way of graph.ways) {
    for (let i = 1; i < way.nodes.length; i++) {
      const a = graph.nodes.get(way.nodes[i - 1]);
      const b = graph.nodes.get(way.nodes[i]);
      const d = pointSegmentDistance(summit, a, b);
      if (!best || d < best.d) best = { d, way, i, a, b };
    }
  }
  if (!best || best.d > maxDist) return null;
  const { way, i, a, b } = best;
  const ida = way.nodes[i - 1];
  const idb = way.nodes[i];
  // vicino a un estremo: si usa quel nodo
  if (haversine(summit, a) < 15) return ida;
  if (haversine(summit, b) < 15) return idb;
  // proiezione sul segmento (piano locale)
  const k = Math.cos((a[0] * Math.PI) / 180);
  const dx = (b[1] - a[1]) * k;
  const dy = b[0] - a[0];
  const t = Math.max(0, Math.min(1, (((summit[1] - a[1]) * k) * dx + (summit[0] - a[0]) * dy) / (dx * dx + dy * dy || 1)));
  const id = 'cima';
  graph.nodes.set(id, [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
  const unlink = (from, to) => graph.adj.set(from, graph.adj.get(from).filter((e) => !(e.to === to && e.way === way)));
  unlink(ida, idb);
  unlink(idb, ida);
  graph.adj.set(id, [{ to: ida, way }, { to: idb, way }]);
  graph.adj.get(ida).push({ to: id, way });
  graph.adj.get(idb).push({ to: id, way });
  return id;
}

function bearing(a, b) {
  const toRad = Math.PI / 180;
  const y = Math.sin((b[1] - a[1]) * toRad) * Math.cos(b[0] * toRad);
  const x = Math.cos(a[0] * toRad) * Math.sin(b[0] * toRad) - Math.sin(a[0] * toRad) * Math.cos(b[0] * toRad) * Math.cos((b[1] - a[1]) * toRad);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

function angleDiff(a, b) {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

function interpolate(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/**
 * Segue la strada dalla cima lungo il primo segmento `first`, tenendo agli incroci
 * la stessa strada (stesso nome o numero, poi la classe più alta e la svolta più dolce).
 * Restituisce il versante con il punto di controllo e il punto per il nome.
 */
function walkBranch(graph, start, first) {
  const path = [graph.nodes.get(start)];
  let prev = start;
  let cur = first.to;
  let way = first.way;
  let dist = 0;
  let via = null;
  let end = null;
  const seen = new Set([start]);
  for (;;) {
    const a = graph.nodes.get(prev);
    const b = graph.nodes.get(cur);
    const seg = haversine(a, b);
    if (!via && dist + seg >= PASS.VIA_DISTANCE) via = interpolate(a, b, (PASS.VIA_DISTANCE - dist) / seg);
    if (!end && dist + seg >= PASS.NAME_DISTANCE) end = interpolate(a, b, (PASS.NAME_DISTANCE - dist) / seg);
    dist += seg;
    path.push(b);
    seen.add(cur);
    if (end) break;
    const heading = bearing(a, b);
    const options = (graph.adj.get(cur) || []).filter((e) => !seen.has(e.to));
    if (!options.length) break;
    options.sort((x, y) => {
      const same = (e) => (way.name && e.way.name === way.name ? 1 : 0);
      const turn = (e) => angleDiff(heading, bearing(b, graph.nodes.get(e.to)));
      return same(y) - same(x) || y.way.rank - x.way.rank || turn(x) - turn(y);
    });
    prev = cur;
    cur = options[0].to;
    way = options[0].way;
  }
  return {
    bearing: bearing(path[0], path[Math.min(path.length - 1, 3)]),
    length: end ? PASS.NAME_DISTANCE : dist,
    via: via || path[Math.max(1, Math.floor(path.length * 0.6))],
    end: end || path[path.length - 1],
    road: first.way.name,
    rank: first.way.rank,
  };
}

const COMPASS = ['nord', 'nord-est', 'est', 'sud-est', 'sud', 'sud-ovest', 'ovest', 'nord-ovest'];

/** "nord", "sud-ovest"… dalla direzione in gradi. */
export function compassLabel(deg) {
  return COMPASS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
}

/**
 * Versanti del passo dalle strade attorno: [{ via, end, bearing, compass, length, road }].
 * Ordinati per importanza (classe della strada e lunghezza); le stradine senza uscita sono escluse.
 * Restituisce [] se la cima non è vicina a una strada.
 */
export function passSides(elements, summit) {
  const graph = buildRoadGraph(elements);
  const start = attachSummit(graph, summit);
  if (start == null) return [];
  const branches = (graph.adj.get(start) || []).map((e) => walkBranch(graph, start, e));
  const sides = branches
    .filter((b) => b.length >= PASS.MIN_BRANCH)
    .sort((a, b) => b.rank - a.rank || b.length - a.length);
  // due rami quasi paralleli (strada a doppia carreggiata) sono lo stesso versante
  const out = [];
  for (const s of sides) if (!out.some((o) => angleDiff(o.bearing, s.bearing) < 30)) out.push(s);
  return out.slice(0, 4).map((s) => ({ ...s, compass: compassLabel(s.bearing) }));
}

/** Versante più vicino a un punto (per esempio la tappa precedente): indice in `sides`. */
export function nearestSide(sides, point) {
  if (!point || !sides.length) return 0;
  let best = 0;
  sides.forEach((s, i) => {
    if (haversine(s.end, point) < haversine(sides[best].end, point)) best = i;
  });
  return best;
}

/** Il versante "dall'altra parte" rispetto a `up`: quello con direzione più opposta. */
export function oppositeSide(sides, up) {
  let best = -1;
  let bestDiff = -1;
  sides.forEach((s, i) => {
    if (i === up) return;
    const d = angleDiff(s.bearing, sides[up].bearing);
    if (d > bestDiff) {
      bestDiff = d;
      best = i;
    }
  });
  return best;
}

/**
 * Tappe da mandare al calcolo: i passi in modalità "completo" o "andata e ritorno"
 * diventano versante di salita → cima → versante di discesa (o di nuovo quello di salita).
 * I punti aggiunti sono "passaggi" ausiliari (aux), da non esportare come tappe.
 */
export function expandStops(stops, loop = false) {
  const out = [];
  stops.forEach((s, i) => {
    const p = s.pass;
    // solo le tappe intermedie: partenza e arrivo restano dove sono
    const intermediate = i > 0 && (i < stops.length - 1 || loop);
    if (!intermediate || !p || p.mode === 'auto' || !p.sides || !p.sides[p.up]) {
      out.push(s);
      return;
    }
    const up = p.sides[p.up];
    const down = p.mode === 'full' ? p.sides[p.down] : up;
    if (!down) {
      out.push(s);
      return;
    }
    const aux = (side) => ({ lat: side.via[0], lon: side.via[1], name: s.name, type: 'through', aux: true, snap: false });
    out.push(aux(up));
    // per tornare indietro serve una sosta in cima (inversione consentita)
    out.push({ ...s, type: p.mode === 'half' ? 'break' : s.type, snap: false });
    out.push(aux(down));
  });
  return out;
}

/**
 * Come passa il percorso dalla cima: "crossed" se sale da una parte e scende dall'altra,
 * "outandback" se torna indietro sulla stessa strada, "unknown" se non è chiaro.
 */
export function passCrossing(shape, summit, cum) {
  let k = -1;
  let best = Infinity;
  shape.forEach((p, i) => {
    const d = haversine(p, summit);
    if (d < best) {
      best = d;
      k = i;
    }
  });
  if (k < 0 || best > 400) return 'unknown';
  const at = (target) => {
    let i = k;
    if (target < cum[k]) while (i > 0 && cum[i] > target) i--;
    else while (i < shape.length - 1 && cum[i] < target) i++;
    return shape[i];
  };
  const before = at(cum[k] - 700);
  const after = at(cum[k] + 700);
  if (cum[k] < 700 || cum[cum.length - 1] - cum[k] < 700) return 'unknown';
  return haversine(before, after) < 80 ? 'outandback' : 'crossed';
}
