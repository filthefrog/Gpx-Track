import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseTrip, buildTurnByTurnGpx } from '../js/core.js';
import {
  RB,
  relativeAngle,
  buildRoadbook,
  tulipSvg,
  notesSvg,
  buildOpenRallyGpx,
  turnByTurnFromGpx,
  geometryTurns,
  rbKm,
} from '../js/roadbook.js';
import { makeTrip, straight } from './fixture.mjs';

const fixture = () => {
  const { trip, stops } = makeTrip();
  const parsed = parseTrip(trip);
  return { parsed, stops, rb: buildRoadbook(parsed, { stops }) };
};

test('relativeAngle: destra positiva, sinistra negativa, sempre tra -180 e 180', () => {
  assert.equal(relativeAngle(0, 90), 90);
  assert.equal(relativeAngle(0, 270), -90);
  assert.equal(relativeAngle(350, 10), 20);
  assert.equal(relativeAngle(10, 350), -20);
  assert.equal(Math.abs(relativeAngle(0, 180)), 180);
});

test('buildRoadbook: una casella per decisione, nell\'ordine giusto', () => {
  const { rb } = fixture();
  const kinds = rb.boxes.map((b) => b.kind);
  assert.deepEqual(kinds, ['start', 'turn', 'roundabout', 'turn', 'turn', 'straight', 'turn', 'stop', 'turn', 'keep', 'straight', 'end']);
  // numerate da 1, totali crescenti, parziali coerenti
  rb.boxes.forEach((b, i) => {
    assert.equal(b.n, i + 1);
    if (i) assert.ok(b.total >= rb.boxes[i - 1].total);
    if (i) assert.ok(Math.abs(b.partial - (b.total - rb.boxes[i - 1].total)) < 0.006);
  });
  assert.equal(rb.boxes[0].total, 0);
  assert.equal(rb.boxes[1].total, 1.3);
  assert.ok(Math.abs(rb.boxes.at(-1).total - rb.totalKm) < 0.01);
});

test('buildRoadbook: svolta, CAP, rotonda e tappe', () => {
  const { rb } = fixture();
  const right = rb.boxes[1];
  assert.ok(Math.abs(right.turn - 90) <= 2, `turn ${right.turn}`);
  assert.equal(right.title, 'Destra');
  assert.ok(Math.abs(right.cap - 90) <= 2, `cap ${right.cap}`);
  assert.equal(right.road, 'SP1');
  const rnd = rb.boxes[2];
  assert.equal(rnd.exitCount, 2);
  assert.equal(rnd.title, 'Rotonda, 2ª uscita');
  // la rotonda si lascia nella stessa direzione in cui si è entrati (est): uscita dritta
  assert.ok(Math.abs(rnd.turn) <= 5, `turn ${rnd.turn}`);
  const left = rb.boxes[3];
  assert.ok(left.turn < -80 && left.turn > -100);
  assert.equal(left.title, 'Sinistra');
  assert.equal(rb.boxes[7].note, 'Tappa intermedia');
  assert.equal(rb.boxes[0].note, 'Partenza & co <test>');
  assert.equal(rb.boxes.at(-1).note, 'Arrivo');
  assert.equal(rb.boxes[9].title, 'Tieni la sinistra');
  assert.equal(rb.boxes[9].toward, 'Bormio');
});

test('buildRoadbook: caselle ravvicinate (meno di 300 m) segnalate', () => {
  const { rb } = fixture();
  for (const b of rb.boxes) assert.equal(b.close, b.n > 1 && b.partial < RB.CLOSE_KM, `casella ${b.n}`);
  // la destra su Via Breve arriva 60 m dopo la sinistra su Vicolo Corto
  assert.ok(rb.boxes[4].close);
  assert.ok(!rb.boxes[1].close);
});

test('tulipSvg e notesSvg: disegni SVG autonomi per ogni tipo di casella', () => {
  const { rb } = fixture();
  for (const b of rb.boxes) {
    const t = tulipSvg(b);
    assert.ok(t.startsWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"'));
    assert.ok(!/href=/.test(t), 'niente riferimenti esterni');
    assert.ok(t.endsWith('</svg>'));
    if (b.kind !== 'end' && b.kind !== 'stop') assert.match(t, /Z" fill="#000"\/>/); // punta della freccia
  }
  assert.match(tulipSvg(rb.boxes[2]), /<circle cx="50" cy="50" r="13"/); // la rotonda
  const notes = notesSvg(rb.boxes[0]);
  assert.match(notes, /Partenza &amp; co/);
  assert.match(notes, /&lt;test&gt;/);
  assert.match(notesSvg(rb.boxes[1]), />90°</);
});

test('buildOpenRallyGpx: valido per lo schema OpenRally v1.0.3 (xmllint)', (t) => {
  const { parsed, rb } = fixture();
  const xml = buildOpenRallyGpx({ name: 'Prova <roadbook>', boxes: rb.boxes, totalKm: rb.totalKm, shape: parsed.shape, time: new Date('2026-10-04T10:00:00Z') });
  assert.match(xml, /xmlns:openrally="http:\/\/www.openrally.org\/xmlschemas\/GpxExtensions\/v1.0.3"/);
  assert.equal((xml.match(/<wpt /g) || []).length, rb.boxes.length);
  assert.match(xml, /<openrally:distance>1.30<\/openrally:distance>/);
  assert.match(xml, /<openrally:units>metric<\/openrally:units>/);
  let hasXmllint = true;
  try {
    execFileSync('xmllint', ['--version'], { stdio: 'ignore' });
  } catch {
    hasXmllint = false;
  }
  if (!hasXmllint) return t.skip('xmllint non disponibile');
  const dir = mkdtempSync(join(tmpdir(), 'openrally-'));
  const file = join(dir, 'roadbook.gpx');
  writeFileSync(file, xml);
  const schema = new URL('./openrally/cross-country/test_wrapper.xsd', import.meta.url).pathname;
  // lancia un errore (e fa fallire il test) se il file non è valido
  execFileSync('xmllint', ['--noout', '--schema', schema, file], { stdio: 'pipe' });
});

test('turnByTurnFromGpx: dal nostro GPX turn by turn alle stesse caselle', () => {
  const { parsed, stops, rb } = fixture();
  const { xml } = buildTurnByTurnGpx({ name: 'Giro', stops, parsed, time: new Date('2026-10-04T10:00:00Z') });
  const tbt = turnByTurnFromGpx(xml);
  assert.equal(tbt.source, 'turn-by-turn');
  assert.equal(tbt.name, 'Giro');
  const again = buildRoadbook(tbt, { stops: tbt.stops });
  assert.deepEqual(again.boxes.map((b) => b.kind), rb.boxes.map((b) => b.kind));
  again.boxes.forEach((b, i) => {
    assert.ok(Math.abs(b.total - rb.boxes[i].total) < 0.05, `casella ${i + 1}: ${b.total} vs ${rb.boxes[i].total}`);
    if (b.kind === 'turn') assert.equal(Math.sign(b.turn), Math.sign(rb.boxes[i].turn));
  });
  assert.equal(again.boxes[2].exitCount, 2);
  assert.equal(again.boxes[7].note, 'Tappa intermedia');
});

test('turnByTurnFromGpx: traccia senza indicazioni, svolte dalla forma della strada', () => {
  const a = [45, 10];
  const north = straight(a, 0, 500);
  const east = straight(north.at(-1), 90, 500);
  const south = straight(east.at(-1), 180, 400);
  const pts = [a, ...north, ...east, ...south];
  const xml = `<?xml version="1.0"?><gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>Solo traccia</name><trkseg>${pts
    .map(([la, lo]) => `<trkpt lat="${la}" lon="${lo}"/>`)
    .join('')}</trkseg></trk></gpx>`;
  const tbt = turnByTurnFromGpx(xml);
  assert.equal(tbt.source, 'geometry');
  assert.equal(tbt.name, 'Solo traccia');
  const rb = buildRoadbook(tbt);
  assert.deepEqual(rb.boxes.map((b) => b.kind), ['start', 'turn', 'turn', 'end']);
  assert.ok(Math.abs(rb.boxes[1].total - 0.5) < 0.03);
  assert.ok(Math.abs(rb.boxes[1].turn - 90) <= 3);
  assert.equal(rb.boxes[1].title, 'Destra');
  assert.ok(Math.abs(rb.boxes[2].total - 1.0) < 0.03);
  assert.ok(Math.abs(rb.boxes.at(-1).total - 1.4) < 0.03);
});

test('geometryTurns: una curva dolce non è una casella', () => {
  // curva ampia: 10° ogni 100 m
  const pts = [[45, 10]];
  for (let i = 0; i < 9; i++) pts.push(...straight(pts.at(-1), i * 10, 100));
  assert.deepEqual(geometryTurns(pts), []);
});

test('turnByTurnFromGpx: file non GPX', () => {
  assert.equal(turnByTurnFromGpx('ciao'), null);
  assert.equal(rbKm(12.3456), '12,35');
});
