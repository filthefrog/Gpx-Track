import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseGpx, gpxToStops, resampleShape, elevationStats, cumulativeDistances, buildTrackGpx, buildRouteGpx, buildTurnByTurnGpx, parseTrip } from '../js/core.js';
import { makeTrip, straight } from './fixture.mjs';

test('parseGpx: legge rotte, tracce e waypoint (anche i GPX esportati dall\'app)', () => {
  const { trip, stops } = makeTrip();
  const parsed = parseTrip(trip);
  const rte = parseGpx(buildRouteGpx({ name: 'Giro & co', stops, parsed }).xml);
  assert.equal(rte.kind, 'rte');
  assert.equal(rte.name, 'Giro & co');
  assert.equal(rte.points[0].name, 'Partenza & co <test>');
  const trk = parseGpx(buildTrackGpx({ name: 'T', stops, parsed }));
  assert.equal(trk.kind, 'trk');
  assert.ok(trk.points.length > 5);
  const tbt = parseGpx(buildTurnByTurnGpx({ name: 'B', stops, parsed }).xml);
  assert.equal(tbt.kind, 'rte');
  const wpt = parseGpx('<?xml version="1.0"?><gpx><wpt lat="45.1" lon="9.1"><name>A</name></wpt><wpt lon="9.2" lat="45.2"/></gpx>');
  assert.deepEqual(wpt, { name: '', kind: 'wpt', points: [{ lat: 45.1, lon: 9.1, name: 'A' }, { lat: 45.2, lon: 9.2, name: '' }] });
  assert.equal(parseGpx('<html></html>'), null);
  assert.equal(parseGpx('<gpx><wpt lat="1" lon="2"/></gpx>'), null);
});

test('gpxToStops: rotte limitate a 25 tappe, tracce trasformate in passaggi ogni 15 km', () => {
  const many = { kind: 'rte', points: Array.from({ length: 60 }, (_, i) => ({ lat: 45 + i * 0.01, lon: 9, name: `P${i}` })) };
  const r = gpxToStops(many);
  assert.equal(r.length, 25);
  assert.equal(r[0].name, 'P0');
  assert.equal(r[24].name, 'P59');
  const line = [[45, 9], ...straight([45, 9], 0, 100000, 200)]; // 100 km
  const t = gpxToStops({ kind: 'trk', points: line.map(([lat, lon]) => ({ lat, lon, name: '' })) });
  assert.equal(t[0].type, 'break');
  assert.equal(t[t.length - 1].type, 'break');
  assert.ok(t.slice(1, -1).every((s) => s.type === 'through'));
  assert.ok(t.length >= 7 && t.length <= 8, `tappe: ${t.length}`);
});

test('resampleShape ed elevationStats: profilo altimetrico', () => {
  const line = [[45, 9], ...straight([45, 9], 90, 10000, 10)];
  const r = resampleShape(line, 101);
  assert.equal(r.length, 101);
  const cum = cumulativeDistances(r);
  assert.ok(Math.abs(cum[50] - cum[100] / 2) < 1, "punti a distanza regolare");
  // salita a 2000 m con piccole oscillazioni, poi discesa
  const prof = [];
  for (let i = 0; i <= 100; i++) prof.push([i * 100, 1000 + (i <= 50 ? i * 20 : (100 - i) * 20) + (i % 2 ? 1 : -1)]);
  const s = elevationStats(prof);
  assert.ok(Math.abs(s.up - 1000) <= 6, `salita ${s.up}`);
  assert.ok(Math.abs(s.down - 1000) <= 6, `discesa ${s.down}`);
  assert.equal(s.max, 1999); // in cima l'oscillazione di prova vale -1
  assert.equal(elevationStats([]), null);
});

test('profileAt: quota interpolata e pendenza media', async () => {
  const { profileAt } = await import('../js/core.js');
  // salita costante del 10% per 1 km, poi piano
  const prof = [[0, 100], [500, 150], [1000, 200], [2000, 200]];
  const a = profileAt(prof, 250);
  assert.equal(a.h, 125);
  assert.ok(Math.abs(a.grade - 10) < 1e-9);
  assert.equal(profileAt(prof, 1600).grade, 0);
  // fuori dal profilo si resta agli estremi
  assert.equal(profileAt(prof, -50).h, 100);
  assert.equal(profileAt(prof, 5000).h, 200);
});

test('pointAtDistance: punto alla distanza lungo la geometria', async () => {
  const { pointAtDistance, cumulativeDistances } = await import('../js/core.js');
  const shape = [[45, 10], [45, 10.01], [45, 10.02]];
  const cum = cumulativeDistances(shape);
  const mid = pointAtDistance(shape, cum, cum[2] / 2);
  assert.ok(Math.abs(mid[1] - 10.01) < 1e-6);
  assert.deepEqual(pointAtDistance(shape, cum, -1), shape[0]);
  assert.deepEqual(pointAtDistance(shape, cum, cum[2] + 10), shape[2]);
  const q = pointAtDistance(shape, cum, cum[1] * 0.25);
  assert.ok(Math.abs(q[1] - 10.0025) < 1e-6);
});

test('limite di località: lettura del messaggio e divisione in pezzi', async () => {
  const { isLocationsError, locationLimit, splitForLocations } = await import('../js/core.js');
  assert.equal(isLocationsError({ error_code: 150 }), true);
  assert.equal(isLocationsError({ error_code: 154 }), false);
  assert.equal(locationLimit({ error: 'Exceeded max locations of 20.' }), 20);
  assert.equal(locationLimit({ error: 'Exceeded max locations: 8' }), 8);
  assert.equal(locationLimit({ error: 'altro' }), null);
  const mk = (n, over = {}) => Array.from({ length: n }, (_, i) => ({ lat: 45, lon: 10 + i / 100, type: 'break', ...(over[i] || {}) }));
  // 25 tappe, al massimo 10 per richiesta: i pezzi si agganciano e coprono tutto
  const chunks = splitForLocations(mk(25), 10);
  assert.ok(chunks.every(([a, b]) => b - a + 1 <= 10));
  assert.equal(chunks[0][0], 0);
  assert.equal(chunks.at(-1)[1], 24);
  for (let i = 1; i < chunks.length; i++) assert.equal(chunks[i][0], chunks[i - 1][1]);
  // meno tappe del limite: un solo pezzo
  assert.deepEqual(splitForLocations(mk(5), 10), [[0, 4]]);
  // il taglio evita i passaggi e i punti dei versanti
  const stops = mk(15, { 9: { type: 'through' }, 8: { aux: true }, 7: { type: 'through' } });
  const [first] = splitForLocations(stops, 10);
  assert.ok(first[1] <= 6, `taglio a ${first[1]}`);
  assert.equal(stops[first[1]].type, 'break');
  // limite minimo 2: ogni tratta da sola
  assert.deepEqual(splitForLocations(mk(4), 2), [[0, 1], [1, 2], [2, 3]]);
});

test('nextChunkEnd: pezzi entro distanza e località, tagli sulle soste', async () => {
  const { nextChunkEnd } = await import('../js/core.js');
  // punti a distanza di circa 11,1 km uno dall'altro (0,1° di latitudine)
  const mk = (n, over = {}) => Array.from({ length: n }, (_, i) => ({ lat: 45 + i / 10, lon: 10, type: 'break', ...(over[i] || {}) }));
  const stops = mk(20);
  // nessun limite: tutto in un pezzo
  assert.equal(nextChunkEnd(stops, 0), 19);
  // 50 km: al massimo 4 tratte (4 × 11,1 = 44,5 km) → fine all'indice 4
  assert.equal(nextChunkEnd(stops, 0, { maxMeters: 50000 }), 4);
  // 5 località al massimo → fine all'indice 4
  assert.equal(nextChunkEnd(stops, 0, { maxLocations: 5 }), 4);
  // partendo da un indice interno
  assert.equal(nextChunkEnd(stops, 4, { maxLocations: 5 }), 8);
  // la prima tratta supera il limite: da sola
  assert.equal(nextChunkEnd(stops, 0, { maxMeters: 5000 }), -1);
  // il taglio evita passaggi e punti ausiliari
  const s2 = mk(20, { 4: { type: 'through' }, 3: { aux: true } });
  const cut = nextChunkEnd(s2, 0, { maxLocations: 5 });
  assert.ok(cut <= 2, `taglio a ${cut}`);
  assert.equal(s2[cut].type, 'break');
  // percorrendo tutto il giro i pezzi si agganciano e coprono tutto
  let at = 0;
  const ends = [];
  while (at < stops.length - 1) {
    const e = nextChunkEnd(stops, at, { maxMeters: 60000, maxLocations: 6 });
    assert.ok(e > at);
    ends.push(e);
    at = e;
  }
  assert.equal(ends.at(-1), 19);
});
