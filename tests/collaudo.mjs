// Collaudo con i servizi reali: Sirolo → Passo dello Stelvio → Passo del Gavia → Ponte di Legno,
// evitando le autostrade. Richiede accesso a Internet (Node 18+).
//
//   node tests/collaudo.mjs
//
// Verifica che:
//  1. i GPX traccia e rotta siano XML ben formato (e validi per lo schema GPX 1.1
//     se è disponibile xmllint e si passa GPX_XSD=/percorso/gpx.xsd);
//  2. la traccia segua le strade: scarto massimo dalla geometria Valhalla ≤ 4 m in entrambe
//     le direzioni, più un controllo indipendente di map matching (/trace_attributes);
//  3. i punti della rotta non cadano su strade parallele né in mezzo agli incroci (/locate).
// I file generati finiscono in collaudo/.
import { mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import {
  buildValhallaRequest,
  valhallaUrl,
  isCostingError,
  parseTrip,
  buildTrackGpx,
  buildRouteGpx,
  buildRoutePoints,
  simplifyRDP,
  keyIndices,
  distanceToLine,
  haversine,
  cumulativeDistances,
  encodePolyline,
  gpxFileName,
  formatKm,
  formatDuration,
} from '../js/core.js';
import { parseXml, findAll } from './xml.mjs';

const VALHALLA = process.env.VALHALLA_URL || 'https://valhalla1.openstreetmap.de';
const NOMINATIM = process.env.NOMINATIM_URL || 'https://nominatim.openstreetmap.org';
const UA = 'TracceMoto-collaudo/1.0 (https://github.com/filthefrog/Gpx-Track)';
const OUT = new URL('../collaudo/', import.meta.url);

const PLACES = [
  { q: 'Sirolo, Ancona', fallback: [43.5228, 13.6155] },
  { q: 'Passo dello Stelvio', fallback: [46.5286, 10.4532] },
  { q: 'Passo di Gavia', fallback: [46.3437, 10.4876] },
  { q: 'Ponte di Legno, Brescia', fallback: [46.259, 10.5096] },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const ok = (msg) => console.log(`  ✔ ${msg}`);
const ko = (msg) => {
  failures++;
  console.log(`  ✘ ${msg}`);
};
const check = (cond, msg) => (cond ? ok(msg) : ko(msg));

async function getJson(url, init = {}) {
  const res = await fetch(url, { ...init, headers: { 'User-Agent': UA, Accept: 'application/json', ...(init.headers || {}) } });
  const body = await res.json().catch(() => null);
  return { res, body };
}

async function valhalla(path, req) {
  await sleep(1100); // server pubblico: niente raffiche
  const { res, body } = await getJson(valhallaUrl(`${VALHALLA}/${path}`, req));
  if (!res.ok) {
    const err = new Error(`${path}: HTTP ${res.status} ${body ? JSON.stringify(body) : ''}`);
    Object.assign(err, body || {});
    throw err;
  }
  return body;
}

async function geocode() {
  const stops = [];
  for (const p of PLACES) {
    await sleep(1100);
    let lat = p.fallback[0];
    let lon = p.fallback[1];
    let name = p.q.split(',')[0];
    try {
      const qs = new URLSearchParams({ q: p.q, format: 'jsonv2', limit: '1', 'accept-language': 'it' });
      const { body } = await getJson(`${NOMINATIM}/search?${qs}`);
      if (body && body[0]) {
        lat = Number(body[0].lat);
        lon = Number(body[0].lon);
        name = body[0].name || name;
      }
    } catch {
      console.log(`  (Nominatim non disponibile per "${p.q}": uso le coordinate di riserva)`);
    }
    stops.push({ lat, lon, name, type: 'break', snap: true });
  }
  return stops;
}

function xmlChecks(label, xml, file) {
  try {
    parseXml(xml);
    ok(`${label}: XML ben formato`);
  } catch (e) {
    ko(`${label}: ${e.message}`);
  }
  try {
    execFileSync('xmllint', ['--noout', file], { stdio: 'pipe' });
    ok(`${label}: xmllint senza errori`);
    if (process.env.GPX_XSD) {
      execFileSync('xmllint', ['--noout', '--schema', process.env.GPX_XSD, file], { stdio: 'pipe' });
      ok(`${label}: valido per lo schema GPX 1.1`);
    }
  } catch (e) {
    if (e.code === 'ENOENT') console.log('  (xmllint non installato: salto il controllo esterno)');
    else ko(`${label}: ${String(e.stderr || e.message).trim()}`);
  }
}

/**
 * Scarto in metri tra la geometria originale e quella semplificata, nei due versi.
 * I vertici semplificati sono un sottoinsieme di quelli originali (stessi oggetti),
 * quindi ogni segmento semplificato corrisponde a un tratto preciso di strada.
 */
function twoWayDeviation(orig, simp, step) {
  let origToTrack = 0;
  let trackToOrig = 0;
  let a = 0;
  for (let j = 1; j < simp.length; j++) {
    let b = a + 1;
    while (orig[b] !== simp[j]) b++;
    const road = orig.slice(a, b + 1);
    for (let i = a; i <= b; i++) origToTrack = Math.max(origToTrack, distanceToLine(orig[i], [simp[j - 1], simp[j]]));
    const len = haversine(simp[j - 1], simp[j]);
    for (let d = step; d < len; d += step) {
      const t = d / len;
      const p = [simp[j - 1][0] + (simp[j][0] - simp[j - 1][0]) * t, simp[j - 1][1] + (simp[j][1] - simp[j - 1][1]) * t];
      trackToOrig = Math.max(trackToOrig, distanceToLine(p, road));
    }
    a = b;
  }
  return { origToTrack, trackToOrig };
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  console.log('1. Tappe (Nominatim)');
  const stops = await geocode();
  stops.forEach((s, i) => console.log(`  ${i + 1}. ${s.name} (${s.lat.toFixed(5)}, ${s.lon.toFixed(5)})`));

  console.log('2. Percorso (Valhalla, autostrade: Evita)');
  const options = { highways: 0, avoidTolls: false, avoidFerries: false, avoidUnpaved: true, style: 'direct' };
  let costing = 'motorcycle';
  let body;
  try {
    body = await valhalla('route', buildValhallaRequest(stops, false, options, costing));
  } catch (e) {
    if (!isCostingError(e)) throw e;
    costing = 'auto';
    console.log('  ⚠ il server rifiuta "motorcycle": uso "auto"');
    body = await valhalla('route', buildValhallaRequest(stops, false, options, costing));
  }
  const parsed = parseTrip(body.trip);
  console.log(`  ${formatKm(parsed.summary.length)} · ${formatDuration(parsed.summary.time)} · ${parsed.maneuvers.length} manovre · costing ${costing}`);
  parsed.legs.forEach((l, i) => console.log(`  tratta ${i + 1}: ${formatKm(l.length)} · ${formatDuration(l.time)}`));
  const motorway = parsed.maneuvers.filter((m) => /autostrada|A\d+\b|E\d+\b/.test(m.instruction));
  check(motorway.length === 0, `nessuna istruzione su autostrade (${motorway.length} trovate${motorway.length ? `: ${motorway.slice(0, 3).map((m) => m.instruction).join(' | ')}` : ''})`);
  check(/[àèéìòù]|Svolta|Prendi|Continua|Guida/i.test(parsed.maneuvers.map((m) => m.instruction).join(' ')), 'istruzioni in italiano');

  console.log('3. GPX');
  const name = 'Collaudo Sirolo Stelvio Gavia Ponte di Legno';
  const now = new Date();
  const trackXml = buildTrackGpx({ name, stops, parsed, time: now });
  const route = buildRouteGpx({ name, stops, parsed, time: now });
  const trackFile = new URL(gpxFileName(name, now, 'traccia'), OUT);
  const routeFile = new URL(gpxFileName(name, now, 'rotta'), OUT);
  writeFileSync(trackFile, trackXml);
  writeFileSync(routeFile, route.xml);
  xmlChecks('traccia', trackXml, trackFile.pathname);
  xmlChecks('rotta', route.xml, routeFile.pathname);
  const trkpts = findAll(parseXml(trackXml), 'trkpt').map((t) => [Number(t.attrs.lat), Number(t.attrs.lon)]);
  console.log(`  traccia: ${parsed.shape.length} punti originali → ${trkpts.length} dopo la semplificazione`);
  console.log(`  rotta: ${route.count} punti (${route.stops} tappe e ${route.shaping} di passaggio)`);

  console.log('4. La traccia segue le strade');
  const simplified = simplifyRDP(parsed.shape, 4, keyIndices(parsed));
  const dev = twoWayDeviation(parsed.shape, simplified, 5);
  check(dev.origToTrack <= 4.01, `ogni punto Valhalla entro 4 m dalla traccia (max ${dev.origToTrack.toFixed(2)} m)`);
  check(dev.trackToOrig <= 4.01, `la traccia resta entro 4 m dalla strada (max ${dev.trackToOrig.toFixed(2)} m)`);
  // map matching indipendente su tratti di traccia
  const cum = cumulativeDistances(simplified);
  const chunkM = 40000;
  let worst = 0;
  let matched = 0;
  for (let start = 0, i0 = 0; i0 < simplified.length - 1; start += chunkM) {
    let i1 = i0;
    while (i1 < simplified.length - 1 && cum[i1] < start + chunkM) i1++;
    // densifico ogni 50 m perché il matcher lavora meglio con punti ravvicinati
    const pts = densify(simplified.slice(i0, i1 + 1), 50);
    try {
      const res = await valhalla('trace_attributes', {
        encoded_polyline: encodePolyline(pts, 6),
        shape_match: 'map_snap',
        costing: 'auto',
        filters: { attributes: ['matched.distance_from_trace_point', 'matched.type'], action: 'include' },
      });
      for (const m of res.matched_points || []) {
        if (m.type === 'unmatched') worst = Infinity;
        else worst = Math.max(worst, m.distance_from_trace_point || 0);
        matched++;
      }
    } catch (e) {
      console.log(`  (trace_attributes non riuscito sul tratto ${(start / 1000).toFixed(0)} km: ${e.message.slice(0, 120)})`);
    }
    i0 = i1;
  }
  if (matched) check(worst <= 8, `map matching: ${matched} punti, distanza massima dalla strada ${worst.toFixed(1)} m`);

  console.log('5. Punti della rotta: niente strade parallele o incroci');
  const pts = buildRoutePoints(parsed, stops, false).filter((p) => p.kind === 'shaping');
  const RADIUS = 20;
  const problems = [];
  for (let k = 0; k < pts.length; k += 20) {
    const batch = pts.slice(k, k + 20);
    const res = await valhalla('locate', {
      locations: batch.map((p) => ({ lat: p.lat, lon: p.lon, radius: RADIUS })),
      costing: 'auto',
      verbose: true,
    });
    res.forEach((loc, j) => {
      const p = batch[j];
      const m = parsed.maneuvers[p.maneuverIndex];
      const ways = new Map();
      for (const e of loc.edges || []) {
        const d = haversine([p.lat, p.lon], [e.correlated_lat, e.correlated_lon]);
        if (d > RADIUS) continue;
        const names = ((e.edge_info && e.edge_info.names) || []).join('/');
        const id = e.way_id ?? (e.edge_info && e.edge_info.way_id);
        ways.set(id, { names, d });
      }
      const distinctNames = new Set([...ways.values()].map((w) => w.names));
      const nearest = [...ways.values()].sort((a, b) => a.d - b.d)[0];
      const label = `${m.km.toFixed(1)} km "${m.instruction}"`;
      if (!ways.size) problems.push(`${label}: nessuna strada entro ${RADIUS} m`);
      else if (ways.size > 1 && distinctNames.size > 1)
        problems.push(`${label}: ${ways.size} strade entro ${RADIUS} m (${[...distinctNames].join(' | ') || 'senza nome'})`);
      else if (nearest.d > 5) problems.push(`${label}: a ${nearest.d.toFixed(1)} m dalla strada`);
      else if (m.streetNames.length && nearest.names && !m.streetNames.some((n) => nearest.names.split('/').includes(n)))
        problems.push(`${label}: la strada più vicina è "${nearest.names}", non "${m.streetNames.join('/')}"`);
      const fromTurn = haversine(parsed.shape[m.begin], [p.lat, p.lon]);
      if (fromTurn < 35) problems.push(`${label}: solo ${fromTurn.toFixed(0)} m dalla svolta`);
    });
  }
  check(problems.length === 0, `${pts.length} punti di passaggio controllati, ${problems.length} sospetti`);
  for (const p of problems.slice(0, 30)) console.log(`     - ${p}`);

  console.log(failures ? `\nCollaudo: ${failures} controlli falliti.` : '\nCollaudo superato.');
  console.log(`File in ${OUT.pathname}`);
  process.exitCode = failures ? 1 : 0;
}

function densify(line, step) {
  const out = [line[0]];
  for (let i = 1; i < line.length; i++) {
    const d = haversine(line[i - 1], line[i]);
    const n = Math.floor(d / step);
    for (let k = 1; k <= n; k++) {
      const t = (k * step) / d;
      if (t < 1) out.push([line[i - 1][0] + (line[i][0] - line[i - 1][0]) * t, line[i - 1][1] + (line[i][1] - line[i - 1][1]) * t]);
    }
    out.push(line[i]);
  }
  return out;
}

main().catch((e) => {
  console.error(`\nCollaudo interrotto: ${e.message}`);
  if (e.cause) console.error(`Causa: ${e.cause.message || e.cause}`);
  process.exitCode = 2;
});
