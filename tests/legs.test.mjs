import { test } from 'node:test';
import assert from 'node:assert/strict';
import { haversine, cumulativeDistances } from '../js/core.js';
import {
  LINKS,
  divergences,
  awayFromJunctions,
  placeAnchors,
  routePointsSequence,
  splitLegs,
  googleLink,
  appleLink,
  buildLinks,
  stopsOnlySequence,
} from '../js/legs.js';

// Linea dritta verso est lungo il 45° parallelo, un punto ogni ~100 m.
function straight(km, lat = 45, lon0 = 10) {
  const dLon = 0.1 / (111.32 * Math.cos((lat * Math.PI) / 180));
  return Array.from({ length: km * 10 + 1 }, (_, i) => [lat, lon0 + i * dLon]);
}

test('divergences: nessuna se il giro coincide con la strada veloce', () => {
  const line = straight(20);
  assert.deepEqual(divergences(line, line), []);
});

test('divergences: trova la deviazione a nord e solo quella', () => {
  const fast = straight(20);
  // il giro voluto sale di ~1 km tra il km 8 e il km 12
  const shape = fast.map(([lat, lon], i) => (i > 80 && i < 120 ? [lat + 0.009, lon] : [lat, lon]));
  const runs = divergences(shape, fast);
  assert.equal(runs.length, 1);
  const total = cumulativeDistances(shape).at(-1);
  assert.ok(total > 20000);
  // la deviazione comincia dopo l'ottavo km e finisce prima di 13 km lungo il giro
  assert.ok(runs[0].from > 8000 && runs[0].from < 9500, `from ${runs[0].from}`);
  assert.ok(runs[0].to > runs[0].from + 2500, `to ${runs[0].to}`);
});

test('divergences: senza strada veloce non segnala nulla', () => {
  assert.deepEqual(divergences(straight(5), []), []);
});

test('awayFromJunctions: si allontana dagli incroci, a metà se il tratto è corto', () => {
  assert.equal(awayFromJunctions(1010, [1000, 5000], 10000), 1000 + LINKS.JUNCTION_GAP_M);
  assert.equal(awayFromJunctions(4990, [1000, 5000], 10000), 5000 - LINKS.JUNCTION_GAP_M);
  assert.equal(awayFromJunctions(3000, [1000, 5000], 10000), 3000);
  assert.equal(awayFromJunctions(1040, [1000, 1080], 10000), 1040);
  assert.equal(awayFromJunctions(1010, [1000, 1080], 10000), 1040);
});

test('placeAnchors: uno ogni ~10 km tra le tappe, sulla geometria', () => {
  const shape = straight(45);
  const total = cumulativeDistances(shape).at(-1);
  const anchors = placeAnchors({ shape, stopsAt: [0, total] });
  // 45 km → 4 punti, spaziati in modo uniforme
  assert.equal(anchors.length, 4);
  anchors.forEach((a) => assert.equal(a.reason, 'distanza'));
  for (let i = 1; i < anchors.length; i++) {
    const gap = anchors[i].at - anchors[i - 1].at;
    assert.ok(gap > 8000 && gap <= 10000, `gap ${gap}`);
  }
  // il punto sta sul giro
  anchors.forEach((a) => assert.ok(Math.abs(a.lat - 45) < 1e-6));
});

test('placeAnchors: niente punti nei giri corti, lontano da tappe e incroci', () => {
  const shape = straight(8);
  const total = cumulativeDistances(shape).at(-1);
  assert.deepEqual(placeAnchors({ shape, stopsAt: [0, total] }), []);

  const long = straight(25);
  const t2 = cumulativeDistances(long).at(-1);
  const plain = placeAnchors({ shape: long, stopsAt: [0, t2] });
  // un incrocio proprio sul punto previsto: il punto si sposta di almeno 60 m
  const junctionsAt = plain.map((a) => a.at);
  const moved = placeAnchors({ shape: long, stopsAt: [0, t2], junctionsAt });
  assert.equal(moved.length, plain.length);
  moved.forEach((a) => junctionsAt.forEach((j) => assert.ok(Math.abs(a.at - j) >= LINKS.JUNCTION_GAP_M - 1e-6)));
});

test('placeAnchors: due punti nelle deviazioni lunghe, uno in quelle corte', () => {
  const shape = straight(9);
  const total = cumulativeDistances(shape).at(-1);
  const long = placeAnchors({ shape, stopsAt: [0, total], divergent: [{ from: 2000, to: 6000 }] });
  assert.deepEqual(long.map((a) => [Math.round(a.at), a.reason]), [[3000, 'deviazione'], [5000, 'deviazione']]);
  const short = placeAnchors({ shape, stopsAt: [0, total], divergent: [{ from: 3000, to: 3500 }] });
  assert.deepEqual(short.map((a) => [Math.round(a.at), a.reason]), [[3250, 'deviazione']]);
  // una deviazione attaccata alla tappa non serve: la tappa tiene già il giro lì
  assert.deepEqual(placeAnchors({ shape, stopsAt: [0, total], divergent: [{ from: 100, to: 600 }] }), []);
});

test('placeAnchors: la deviazione prende il posto del punto "distanza" vicino', () => {
  const shape = straight(25);
  const total = cumulativeDistances(shape).at(-1);
  const plain = placeAnchors({ shape, stopsAt: [0, total] });
  const at = plain[0].at;
  const mixed = placeAnchors({ shape, stopsAt: [0, total], divergent: [{ from: at + 100, to: at + 500 }] });
  assert.equal(mixed.length, plain.length);
  assert.equal(mixed[0].reason, 'deviazione');
});

const P = (at, kind = 'anchor', name) => ({ lat: 45, lon: 10 + at / 100000, at, kind, name });

test('routePointsSequence: tappe e punti in ordine lungo il giro', () => {
  const seq = routePointsSequence(
    [{ lat: 45, lon: 10, name: 'A', at: 0 }, { lat: 45, lon: 11, name: 'B', at: 50000 }],
    [{ lat: 45, lon: 10.5, at: 25000, reason: 'distanza' }],
  );
  assert.deepEqual(seq.map((p) => p.kind), ['tappa', 'anchor', 'tappa']);
  assert.equal(seq[2].name, 'B');
  // tappe alla stessa distanza (per esempio un giro andata e ritorno): l'ordine resta quello dato
  const same = routePointsSequence(
    ['A', 'B', 'C'].map((name, i) => ({ lat: 45, lon: 10, name, at: i === 0 ? 0 : 5000 })),
    [{ lat: 45, lon: 10, at: 5000, reason: 'distanza' }],
  );
  assert.deepEqual(same.map((p) => p.name || p.kind), ['A', 'B', 'C', 'anchor']);
});

test('splitLegs: rispetta il limite e le tratte condividono gli estremi', () => {
  const points = Array.from({ length: 12 }, (_, i) => P(i * 1000, i === 0 || i === 11 ? 'tappa' : 'anchor'));
  for (const max of [3, 9]) {
    const legs = splitLegs(points, max);
    legs.forEach((l) => assert.ok(l.length - 2 <= max && l.length >= 2));
    for (let i = 1; i < legs.length; i++) assert.equal(legs[i][0], legs[i - 1].at(-1));
    assert.equal(legs[0][0], points[0]);
    assert.equal(legs.at(-1).at(-1), points.at(-1));
  }
  assert.equal(splitLegs(points, 9).length, 2);
  assert.equal(splitLegs(points.slice(0, 2), 3).length, 1);
});

test('splitLegs: preferisce chiudere la tratta su una tappa', () => {
  // tappa all'indice 3: con 3 punti intermedi la prima tratta arriverebbe a 4
  const points = Array.from({ length: 9 }, (_, i) => P(i * 1000, [0, 3, 8].includes(i) ? 'tappa' : 'anchor'));
  const legs = splitLegs(points, 3);
  assert.equal(legs[0].at(-1).at, 3000);
});

test('googleLink: formato Maps URLs con 5 decimali e separatore %7C', () => {
  const leg = [P(0, 'tappa'), P(1234), P(5678), P(10000, 'tappa')];
  const url = googleLink(leg);
  assert.ok(url.startsWith('https://www.google.com/maps/dir/?api=1&origin=45.00000,10.00000&destination=45.00000,10.10000'));
  assert.ok(url.includes('&travelmode=driving'));
  assert.ok(url.includes('&waypoints=45.00000,10.01234%7C45.00000,10.05678'));
  assert.ok(!googleLink([P(0), P(1)]).includes('waypoints'));
});

test('appleLink: waypoint ripetuto e avoid', () => {
  const leg = [P(0, 'tappa'), P(1234), P(5678), P(10000, 'tappa')];
  const url = appleLink(leg, { avoidHighways: true, avoidTolls: true });
  assert.ok(url.startsWith('https://maps.apple.com/directions?source=45.00000,10.00000&destination=45.00000,10.10000'));
  assert.equal(url.match(/&waypoint=/g).length, 2);
  assert.ok(url.includes('&mode=driving'));
  assert.ok(url.endsWith('&avoid=tolls,highways'));
  assert.ok(!appleLink(leg).includes('avoid'));
});

test('buildLinks: una tratta per link, conteggi e lunghezza del link', () => {
  const points = Array.from({ length: 12 }, (_, i) =>
    i === 0 || i === 11 ? P(i * 10000, 'tappa') : { ...P(i * 10000), reason: i === 5 ? 'deviazione' : 'distanza' },
  );
  const mobile = buildLinks(points, 'google-mobile');
  assert.equal(mobile.length, 3);
  assert.equal(mobile.reduce((s, l) => s + l.km, 0), 110);
  assert.equal(mobile.reduce((s, l) => s + l.anchors, 0), 10 - 2); // gli estremi di tratta non contano
  assert.equal(mobile.reduce((s, l) => s + l.forced, 0), 1);
  mobile.forEach((l) => assert.ok(!l.tooLong && l.url.length < LINKS.GOOGLE_MAX_URL));
  assert.equal(buildLinks(points, 'google-desktop').length, 2);
  assert.ok(buildLinks(points, 'apple')[0].url.startsWith('https://maps.apple.com/'));
});

test('stopsOnlySequence: solo tappe, distanze in linea d\'aria', () => {
  const stops = [{ lat: 45, lon: 10, name: 'A' }, { lat: 45.1, lon: 10, name: 'B' }, { lat: 45.2, lon: 10, name: 'C' }];
  const seq = stopsOnlySequence(stops);
  assert.equal(seq.length, 3);
  assert.equal(seq[0].at, 0);
  assert.ok(Math.abs(seq[2].at - haversine([45, 10], [45.2, 10])) < 1);
  assert.equal(buildLinks(seq, 'google-mobile').length, 1);
});
