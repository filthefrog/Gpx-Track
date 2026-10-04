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
