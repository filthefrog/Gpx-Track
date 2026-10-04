import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  decodePolyline,
  encodePolyline,
  haversine,
  distanceToLine,
  simplifyRDP,
  bestInsertionIndex,
  buildValhallaRequest,
  valhallaUrl,
  isCostingError,
  explainValhallaError,
  parseTrip,
  keyIndices,
  routeShapingPoints,
  buildRoutePoints,
  buildTrackGpx,
  buildRouteGpx,
  roadbookText,
  encodeState,
  decodeState,
  gpxFileName,
  defaultTripName,
  formatDuration,
  formatKm,
} from '../js/core.js';
import { makeTrip, straight, START } from './fixture.mjs';
import { parseXml, findAll, child } from './xml.mjs';

const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

// ---------------------------------------------------------------------------
// Polyline
// ---------------------------------------------------------------------------

test('decodePolyline: esempio di riferimento con precisione 6', () => {
  const pts = decodePolyline('_izlhA~rlgdF_{geC~ywl@_kwzCn`{nI', 6);
  assert.deepEqual(pts, [
    [38.5, -120.2],
    [40.7, -120.95],
    [43.252, -126.453],
  ]);
});

test('decodePolyline: esempio Google con precisione 5', () => {
  const pts = decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@', 5);
  assert.deepEqual(pts, [
    [38.5, -120.2],
    [40.7, -120.95],
    [43.252, -126.453],
  ]);
});

test('decodePolyline: andata e ritorno con coordinate italiane e negative', () => {
  const pts = [
    [43.522468, 13.618123],
    [46.528634, 10.453052],
    [46.344958, 10.512444],
    [-33.868820, 151.209296],
    [0, 0],
    [-0.000001, -179.999999],
  ];
  const back = decodePolyline(encodePolyline(pts, 6), 6);
  assert.equal(back.length, pts.length);
  back.forEach((p, i) => {
    assert.ok(near(p[0], pts[i][0], 1e-6) && near(p[1], pts[i][1], 1e-6), `punto ${i}`);
  });
});

test('decodePolyline: stringa vuota e polyline troncata', () => {
  assert.deepEqual(decodePolyline(''), []);
  assert.throws(() => decodePolyline('_izlhA~rlgd'), /troncata/);
});

// ---------------------------------------------------------------------------
// Geometria e semplificazione
// ---------------------------------------------------------------------------

test('haversine: un grado di latitudine ≈ 111,2 km', () => {
  assert.ok(Math.abs(haversine([45, 10], [46, 10]) - 111195) < 50);
});

test('simplifyRDP: una retta con rumore sotto la tolleranza si riduce a 2 punti', () => {
  const line = straight([45, 10], 45, 2000, 10).map((p, i) => [p[0] + (i % 2 ? 1 : -1) * 1e-5 * 0.2, p[1]]);
  line.unshift([45, 10]);
  const s = simplifyRDP(line, 4);
  assert.equal(s.length, 2);
  assert.deepEqual(s[0], line[0]);
  assert.deepEqual(s[1], line[line.length - 1]);
});

test('simplifyRDP: ogni punto originale resta entro la tolleranza (la linea non esce dalla strada)', () => {
  // tornanti: serpentina con curve strette
  const line = [[46.5, 10.45]];
  let bearing = 0;
  for (let k = 0; k < 40; k++) {
    bearing = (bearing + 23) % 360;
    line.push(...straight(line[line.length - 1], bearing, 60, 5));
  }
  for (const tol of [1, 4, 10]) {
    const s = simplifyRDP(line, tol);
    assert.ok(s.length < line.length);
    const maxDev = Math.max(...line.map((p) => distanceToLine(p, s)));
    assert.ok(maxDev <= tol + 1e-6, `tolleranza ${tol}: scarto ${maxDev.toFixed(2)} m`);
  }
});

test('simplifyRDP: gli indici obbligati (incroci) restano nella linea', () => {
  const line = [[45, 10], ...straight([45, 10], 90, 1000, 10)];
  const keep = [17, 42, 77];
  const s = simplifyRDP(line, 4, keep);
  for (const k of keep) assert.ok(s.includes(line[k]), `indice ${k}`);
  assert.equal(s.length, 2 + keep.length);
});

test('simplifyRDP: linee corte restano invariate', () => {
  assert.deepEqual(simplifyRDP([[1, 2]]), [[1, 2]]);
  assert.deepEqual(simplifyRDP([[1, 2], [3, 4]]), [[1, 2], [3, 4]]);
});

// ---------------------------------------------------------------------------
// Tappa intermedia
// ---------------------------------------------------------------------------

test('bestInsertionIndex: inserisce nel tratto che allunga meno il giro', () => {
  const stops = [
    [43.52, 13.62], // Sirolo
    [44.49, 11.34], // Bologna
    [45.46, 9.19], // Milano
  ];
  assert.equal(bestInsertionIndex(stops, [44.80, 10.33]), 2); // Parma: tra Bologna e Milano
  assert.equal(bestInsertionIndex(stops, [43.84, 13.02]), 1); // Fano: tra Sirolo e Bologna
});

test('bestInsertionIndex: con meno di due tappe il punto va in fondo', () => {
  assert.equal(bestInsertionIndex([], [45, 10]), 0);
  assert.equal(bestInsertionIndex([[45, 10]], [45, 11]), 1);
});

test('bestInsertionIndex: in un anello considera anche il ritorno alla partenza', () => {
  const stops = [
    [45.0, 10.0],
    [45.0, 10.5],
    [45.5, 10.5],
  ];
  const p = [45.25, 9.95]; // vicino al lato di ritorno (Nord-Est → partenza)
  assert.equal(bestInsertionIndex(stops, p, false), 1);
  assert.equal(bestInsertionIndex(stops, p, true), 3);
});

test('bestInsertionIndex: non sposta mai partenza o arrivo', () => {
  const stops = [
    [45, 10],
    [45, 11],
  ];
  assert.equal(bestInsertionIndex(stops, [44, 9]), 1);
  assert.equal(bestInsertionIndex(stops, [46, 12]), 1);
});

// ---------------------------------------------------------------------------
// Richiesta Valhalla
// ---------------------------------------------------------------------------

test('buildValhallaRequest: costing moto, preferenze e tipi di tappa', () => {
  const stops = [
    { lat: 1, lon: 2, type: 'through' },
    { lat: 3, lon: 4, type: 'through' },
    { lat: 5, lon: 6, type: 'break' },
    { lat: 7, lon: 8, type: 'through' },
  ];
  const r = buildValhallaRequest(stops, false, { highways: 0, avoidTolls: true, avoidFerries: true, avoidUnpaved: true, shortest: true });
  assert.equal(r.costing, 'motorcycle');
  assert.deepEqual(r.locations.map((l) => l.type), ['break', 'through', 'break', 'break']);
  assert.deepEqual(r.costing_options.motorcycle, {
    use_highways: 0,
    use_tolls: 0,
    use_ferry: 0,
    use_trails: 0,
    shortest: true,
  });
  assert.deepEqual(r.directions_options, { units: 'kilometers', language: 'it-IT' });
});

test('buildValhallaRequest: anello e fallback auto', () => {
  const stops = [
    { lat: 1, lon: 2 },
    { lat: 3, lon: 4, type: 'through' },
    { lat: 5, lon: 6, type: 'through' },
  ];
  const r = buildValhallaRequest(stops, true, { highways: 0.5, avoidUnpaved: false }, 'auto');
  assert.equal(r.locations.length, 4);
  assert.deepEqual(r.locations[3], { lat: 1, lon: 2, type: 'break' });
  // con l'anello l'ultima tappa dell'utente è intermedia e mantiene "through"
  assert.equal(r.locations[2].type, 'through');
  assert.equal(r.costing_options.auto.use_highways, 0.5);
  assert.equal(r.costing_options.auto.use_trails, undefined);
  const url = valhallaUrl('https://example.org/route', r);
  assert.ok(url.startsWith('https://example.org/route?json=%7B'));
  assert.deepEqual(JSON.parse(decodeURIComponent(url.split('?json=')[1])), r);
});

test('isCostingError ed explainValhallaError', () => {
  assert.ok(isCostingError({ error_code: 125, error: 'No costing method found' }));
  assert.ok(!isCostingError({ error_code: 442, error: 'No path could be found for input' }));
  const stops = [
    { name: 'A', type: 'break' },
    { name: 'Passo X', type: 'through' },
    { name: 'C', type: 'break' },
  ];
  const msg = explainValhallaError({ error_code: 442 }, stops);
  assert.match(msg, /passaggio/);
  assert.match(msg, /2\. Passo X/);
  assert.match(msg, /sosta/);
  assert.match(explainValhallaError({ error_code: 171 }, stops), /Trascina/);
  assert.match(explainValhallaError({ network: true }), /connessione/);
});

// ---------------------------------------------------------------------------
// Risposta Valhalla → percorso
// ---------------------------------------------------------------------------

test('parseTrip: unisce le tratte e riallinea gli indici delle manovre', () => {
  const { trip, shapes } = makeTrip();
  const p = parseTrip(trip);
  assert.equal(p.shape.length, shapes[0].length + shapes[1].length - 1);
  assert.equal(p.legs.length, 2);
  assert.equal(p.legs[1].startIndex, shapes[0].length - 1);
  const leg2start = p.maneuvers.find((m) => m.leg === 1);
  assert.equal(leg2start.begin, shapes[0].length - 1);
  assert.ok(near(leg2start.km, trip.legs[0].summary.length, 1e-9));
  for (const m of p.maneuvers) assert.ok(m.begin <= m.end && m.end < p.shape.length);
});

test('routeShapingPoints: un punto 120-150 m dopo ogni manovra significativa, sulla nuova strada', () => {
  const { trip } = makeTrip();
  const p = parseTrip(trip);
  const pts = routeShapingPoints(p);
  const types = pts.map((x) => p.maneuvers[x.maneuverIndex].type);
  // esclusi: partenza, "diventa", rotonda (ingresso), "continua", "mantieni dritto", arrivo, e la strada di 60 m
  assert.deepEqual(types, [10, 27, 10, 15, 14]);
  for (const x of pts) {
    const m = p.maneuvers[x.maneuverIndex];
    const road = p.shape.slice(m.begin, m.end + 1);
    assert.ok(distanceToLine([x.lat, x.lon], road) < 0.5, `${m.instruction}: fuori dalla nuova strada`);
    const fromTurn = haversine(p.shape[m.begin], [x.lat, x.lon]);
    const toNext = haversine([x.lat, x.lon], p.shape[m.end]);
    const segLen = m.length * 1000;
    if (segLen >= 165) {
      assert.ok(fromTurn >= 120 && fromTurn <= 150, `${m.instruction}: ${fromTurn.toFixed(1)} m dalla svolta`);
    } else {
      // strada corta: a metà, lontano da entrambi gli incroci
      assert.ok(fromTurn >= 40 && toNext >= 40, `${m.instruction}: troppo vicino a un incrocio`);
    }
    assert.ok(toNext >= 30, `${m.instruction}: troppo vicino all'incrocio successivo`);
  }
  // il nome è quello della nuova strada
  assert.equal(pts[1].name, 'SP2');
  assert.match(pts[1].desc, /uscita/);
});

test('buildRoutePoints: tappe in ordine e nessun punto a meno di 50 m dal precedente', () => {
  const { trip, stops } = makeTrip();
  const p = parseTrip(trip);
  const pts = buildRoutePoints(p, stops, false);
  assert.equal(pts[0].kind, 'stop');
  assert.equal(pts[pts.length - 1].kind, 'stop');
  assert.deepEqual(pts.filter((x) => x.kind === 'stop').map((x) => x.name), stops.map((s) => s.name));
  for (let i = 1; i < pts.length; i++) {
    const d = haversine([pts[i - 1].lat, pts[i - 1].lon], [pts[i].lat, pts[i].lon]);
    assert.ok(d >= 50, `punti ${i - 1}-${i} a ${d.toFixed(1)} m`);
  }
});

test('buildRoutePoints: un punto troppo vicino a una tappa viene scartato', () => {
  const { trip, stops } = makeTrip();
  const p = parseTrip(trip);
  // sposto la tappa intermedia a 20 m dal punto dopo "Svolta a sinistra su SS3"
  const shaping = routeShapingPoints(p);
  const ss3 = shaping.find((x) => x.name === 'SS3' && p.maneuvers[x.maneuverIndex].type === 15);
  const moved = stops.map((s) => ({ ...s }));
  moved[1] = { ...moved[1], lat: ss3.lat + 20 / 111320, lon: ss3.lon };
  const pts = buildRoutePoints(p, moved, false);
  assert.ok(!pts.some((x) => x.kind === 'shaping' && x.maneuverIndex === ss3.maneuverIndex));
  assert.ok(pts.some((x) => x.kind === 'stop' && x.name === 'Tappa intermedia'));
});

// ---------------------------------------------------------------------------
// GPX
// ---------------------------------------------------------------------------

test('buildTrackGpx: GPX 1.1 valido con wpt per ogni tappa e trk semplificato', () => {
  const { trip, stops } = makeTrip();
  const p = parseTrip(trip);
  const xml = buildTrackGpx({ name: 'Giro <prova> & "test"', stops, parsed: p, time: new Date('2026-10-04T08:00:00Z') });
  const gpx = parseXml(xml);
  assert.equal(gpx.name, 'gpx');
  assert.equal(gpx.attrs.version, '1.1');
  assert.equal(gpx.attrs.xmlns, 'http://www.topografix.com/GPX/1/1');
  // ordine degli elementi richiesto dallo schema GPX 1.1
  assert.deepEqual([...new Set(gpx.children.map((c) => c.name))], ['metadata', 'wpt', 'trk']);
  assert.equal(child(child(gpx, 'metadata'), 'name').text, 'Giro <prova> & "test"');
  assert.equal(child(child(gpx, 'metadata'), 'time').text, '2026-10-04T08:00:00Z');
  const wpts = findAll(gpx, 'wpt');
  assert.equal(wpts.length, 3);
  assert.equal(child(wpts[0], 'name').text, 'Partenza & co <test>');
  assert.deepEqual(wpts.map((w) => child(w, 'type').text), ['Partenza', 'Sosta', 'Arrivo']);
  const trkpts = findAll(gpx, 'trkpt').map((t) => [Number(t.attrs.lat), Number(t.attrs.lon)]);
  assert.ok(trkpts.length < p.shape.length, 'la geometria deve essere semplificata');
  // le svolte restano esatte e nessun punto originale si allontana più di 4 m
  for (const k of keyIndices(p)) {
    assert.ok(trkpts.some((t) => haversine(t, p.shape[k]) < 0.2), `incrocio ${k} mancante`);
  }
  const maxDev = Math.max(...p.shape.map((pt) => distanceToLine(pt, trkpts)));
  assert.ok(maxDev <= 4.2, `scarto massimo ${maxDev.toFixed(2)} m`);
});

test('buildRouteGpx: GPX 1.1 valido con rte, tappe e punti di passaggio', () => {
  const { trip, stops } = makeTrip();
  stops[1].type = 'through';
  const p = parseTrip(trip);
  const res = buildRouteGpx({ name: 'Giro', stops, parsed: p });
  const gpx = parseXml(res.xml);
  assert.deepEqual(gpx.children.map((c) => c.name), ['metadata', 'rte']);
  const rtepts = findAll(gpx, 'rtept');
  assert.equal(rtepts.length, res.count);
  assert.equal(res.stops, 3);
  assert.equal(res.shaping, res.count - 3);
  assert.ok(res.shaping >= 4);
  const types = rtepts.map((r) => child(r, 'type').text);
  assert.equal(types[0], 'Partenza');
  assert.equal(types[types.length - 1], 'Arrivo');
  assert.ok(types.includes('Passaggio'));
  // estensioni Garmin: destinazioni come ViaPoint, il resto come ShapingPoint
  assert.equal(gpx.attrs['xmlns:trp'], 'http://www.garmin.com/xmlschemas/TripExtensions/v1');
  const ext = rtepts.map((r) => child(child(r, 'extensions'), 'trp:ViaPoint') ? 'via' : child(child(r, 'extensions'), 'trp:ShapingPoint') ? 'shape' : '?');
  assert.equal(ext[0], 'via');
  assert.equal(ext[ext.length - 1], 'via');
  assert.equal(ext.filter((e) => e === 'via').length, 2);
  assert.ok(!ext.includes('?'));
  // ogni rtept ha lat/lon numerici e un nome
  for (const r of rtepts) {
    assert.ok(Number.isFinite(Number(r.attrs.lat)) && Number.isFinite(Number(r.attrs.lon)));
    assert.ok(child(r, 'name').text.length > 0);
    // elementi del wpt nell'ordine dello schema: name, cmt?, desc?, sym, type
    const order = r.children.map((c) => c.name);
    const schema = ['name', 'cmt', 'desc', 'sym', 'type', 'extensions'];
    assert.deepEqual(order, [...order].sort((a, b) => schema.indexOf(a) - schema.indexOf(b)));
  }
});

test('buildRouteGpx: anello con ritorno alla partenza', () => {
  const { trip, stops } = makeTrip();
  const p = parseTrip(trip);
  const res = buildRouteGpx({ name: 'Anello', stops: stops.slice(0, 2), loop: true, parsed: p });
  const gpx = parseXml(res.xml);
  const rtepts = findAll(gpx, 'rtept');
  const last = rtepts[rtepts.length - 1];
  assert.match(child(last, 'name').text, /ritorno/);
  assert.equal(child(last, 'type').text, 'Arrivo');
  assert.equal(Number(last.attrs.lat), Number(rtepts[0].attrs.lat));
});

// ---------------------------------------------------------------------------
// Roadbook, stato, nomi
// ---------------------------------------------------------------------------

test('roadbookText: km progressivi e istruzioni', () => {
  const { trip, stops } = makeTrip();
  const text = roadbookText('Giro', parseTrip(trip), stops);
  const lines = text.split('\n');
  assert.equal(lines[0], 'Giro');
  assert.match(text, /\s0,0 km {2}Guida verso nord su Via Uno\./);
  assert.match(text, /1,3 km {2}Svolta a destra su SP1\./);
});

test('encodeState/decodeState: andata e ritorno con accenti ed emoji', () => {
  const state = {
    name: 'Passi alpini – giù per il Gavia 🏍️',
    loop: true,
    options: { highways: 0.5, avoidTolls: true, avoidFerries: false, avoidUnpaved: false, shortest: true },
    stops: [
      { lat: 43.522468, lon: 13.618123, name: 'Sirolo', type: 'break' },
      { lat: 46.528634, lon: 10.453052, name: 'Passo dello Stelvio', type: 'through' },
    ],
  };
  const enc = encodeState(state);
  assert.match(enc, /^[A-Za-z0-9_-]+$/);
  const dec = decodeState(`#g=${enc}`);
  assert.equal(dec.name, state.name);
  assert.equal(dec.loop, true);
  assert.deepEqual(dec.options, state.options);
  assert.equal(dec.stops[1].type, 'through');
  assert.ok(near(dec.stops[0].lat, 43.52247, 1e-9));
  assert.throws(() => decodeState('#g=xyz'));
});

test('gpxFileName e defaultTripName', () => {
  const d = new Date(2026, 9, 4);
  assert.equal(gpxFileName('Stelvio & Gavia: più curve!', d, 'traccia'), 'Stelvio-Gavia-piu-curve_2026-10-04_traccia.gpx');
  assert.equal(gpxFileName('', d), 'giro_2026-10-04.gpx');
  const stops = [{ name: 'Sirolo, Ancona, Marche' }, { name: 'Ponte di Legno, Brescia' }];
  assert.equal(defaultTripName(stops), 'Sirolo - Ponte di Legno');
  assert.equal(defaultTripName(stops, true), 'Anello da Sirolo');
});

test('formattazione italiana di km e durate', () => {
  assert.equal(formatKm(1234.56), '1.234,6 km');
  assert.equal(formatDuration(59 * 60), '59 min');
  assert.equal(formatDuration(3 * 3600 + 5 * 60), '3 h 05 min');
});

test('fixture: la partenza è dove dichiarato', () => {
  const { trip } = makeTrip();
  assert.ok(haversine(parseTrip(trip).shape[0], START) < 0.2);
});
