import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  NAV,
  buildRouteIndex,
  projectOnRoute,
  pointAtDistance,
  progress,
  Tracker,
  easeAngle,
  formatDistance,
  maneuverIcon,
  spokenAlert,
} from '../js/nav.js';
import { parseTrip, haversine } from '../js/core.js';
import { makeTrip, straight } from './fixture.mjs';

const M_PER_DEG = 111320;

function index() {
  return buildRouteIndex(parseTrip(makeTrip().trip));
}

test('projectOnRoute: posizione GPS accanto alla strada → distanza percorsa e scostamento', () => {
  const idx = index();
  const k = 30; // punto sul primo rettilineo (verso nord)
  const p = [idx.shape[k][0], idx.shape[k][1] + 10 / (M_PER_DEG * Math.cos((idx.shape[k][0] * Math.PI) / 180))]; // 10 m a est
  const r = projectOnRoute(idx, p);
  assert.ok(Math.abs(r.s - idx.cum[k]) < 1, `s ${r.s} vs ${idx.cum[k]}`);
  assert.ok(Math.abs(r.offset - 10) < 0.5, `offset ${r.offset}`);
  // con l'ultima posizione nota cerca vicino e trova lo stesso punto
  const h = projectOnRoute(idx, p, idx.cum[k] - 50);
  assert.ok(Math.abs(h.s - r.s) < 1);
});

test('projectOnRoute: su un andata e ritorno la finestra evita di saltare sul ritorno', () => {
  const out = [[46, 10], ...straight([46, 10], 0, 2000, 20)];
  const shape = [...out, ...out.slice(0, -1).reverse().map(([la, lo]) => [la, lo + 0.00002])];
  const idx = buildRouteIndex({ shape, maneuvers: [{ begin: 0, type: 1, time: 0 }], legs: [] });
  const p = out[20]; // 400 m dall'inizio, ma vicino anche al ritorno (a 3600 m)
  assert.ok(projectOnRoute(idx, p, 380).s < 600, 'all\'andata con la posizione precedente');
  assert.ok(projectOnRoute(idx, p, 3550).s > 3400, 'al ritorno con la posizione precedente');
});

test('pointAtDistance: punto sulla traccia e direzione di marcia', () => {
  const idx = index();
  const north = pointAtDistance(idx, 300);
  assert.ok(Math.abs(north.heading) < 2 || Math.abs(north.heading - 360) < 2, `nord: ${north.heading}`);
  const east = pointAtDistance(idx, 1700); // sulla SP1, verso est
  assert.ok(Math.abs(east.heading - 90) < 2, `est: ${east.heading}`);
  assert.deepEqual(pointAtDistance(idx, -5).point, idx.shape[0]);
  const end = pointAtDistance(idx, 1e9).point;
  assert.ok(haversine(end, idx.shape[idx.shape.length - 1]) < 0.1);
});

test('progress: prossima manovra, distanza, rimanente e arrivo', () => {
  const idx = index();
  const p = progress(idx, 1000);
  assert.match(p.next.instruction, /Via Uno diventa Via Due|Svolta a destra su SP1/);
  assert.equal(p.next.at > 1000, true);
  assert.ok(Math.abs(p.remaining - (idx.total - 1000)) < 0.01);
  assert.ok(p.remainingTime > 0 && p.remainingTime < idx.maneuvers.reduce((a, m) => a + m.time, 0));
  assert.equal(p.arrived, false);
  assert.equal(progress(idx, idx.total - 10).arrived, true);
});

test('Tracker: la freccia scorre fluida tra un dato GPS e l\'altro', () => {
  const tr = new Tracker();
  const v = 20; // m/s (72 km/h)
  const frames = [];
  let t = 0;
  for (let sec = 0; sec <= 10; sec++) {
    // GPS ogni secondo, con un errore di ±6 m
    const noise = (sec % 2 ? 1 : -1) * 6;
    tr.fix(sec * v + noise, v, sec * 1000);
    for (let f = 0; f < 60; f++) {
      t = sec * 1000 + f * (1000 / 60);
      frames.push(tr.frame(t));
    }
  }
  for (let i = 1; i < frames.length; i++) {
    const step = frames[i] - frames[i - 1];
    assert.ok(step >= 0, `mai indietro (frame ${i}: ${step})`);
    assert.ok(step < 1.2, `nessuno scatto (frame ${i}: ${step.toFixed(2)} m in 16 ms)`);
  }
  // dopo 10 s è vicino a dove dice il GPS
  assert.ok(Math.abs(frames[frames.length - 1] - 10 * v) < 25);
});

test('Tracker: senza GPS si ferma dopo qualche secondo; un salto grande indietro si applica', () => {
  const tr = new Tracker();
  tr.fix(0, 10, 0);
  tr.fix(10, 10, 1000);
  let s = 0;
  for (let t = 1000; t <= 20000; t += 16) s = tr.frame(t);
  assert.ok(s < 10 + 10 * NAV.MAX_EXTRAPOLATION + 5, `non corre all'infinito: ${s}`);
  // ricalcolo: la nuova posizione è 200 m indietro
  tr.fix(s - 200, 10, 20100);
  const after = tr.frame(20116);
  assert.ok(after < s - 150);
});

test('easeAngle, formatDistance, maneuverIcon e spokenAlert', () => {
  assert.equal(Math.round(easeAngle(350, 10, 0.5)), 0);
  assert.equal(Math.round(easeAngle(10, 350, 0.5)), 0);
  assert.equal(easeAngle(90, 90, 0.3), 90);
  assert.equal(formatDistance(347), '350 m');
  assert.equal(formatDistance(1234), '1,2 km');
  assert.equal(formatDistance(23456), '23 km');
  assert.equal(maneuverIcon(10), 'right');
  assert.equal(maneuverIcon(26), 'roundabout');
  assert.equal(maneuverIcon(4), 'arrive');
  assert.equal(maneuverIcon(999), 'straight');
  assert.equal(spokenAlert({ verbalAlert: 'Svolta a destra su SP1.' }, 290), 'Tra 300 metri, svolta a destra su SP1.');
  assert.equal(spokenAlert({ instruction: 'Prendi la 2ª uscita.' }, 1240), 'Tra 1,2 chilometri, prendi la 2ª uscita.');
});
