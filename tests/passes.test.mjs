import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  overpassQuery,
  buildRoadGraph,
  passSides,
  compassLabel,
  nearestSide,
  oppositeSide,
  expandStops,
  passCrossing,
} from '../js/passes.js';
import { haversine, cumulativeDistances, routeLocations, distanceToLine } from '../js/core.js';
import { straight } from './fixture.mjs';
import { SUMMIT, network } from './pass-fixture.mjs';

test('overpassQuery: strade percorribili attorno al passo', () => {
  const q = overpassQuery(46.5286, 10.4532);
  assert.match(q, /^\[out:json\]/);
  assert.match(q, /way\(around:5000,46\.528600,10\.453200\)/);
  assert.match(q, /secondary\|tertiary/);
  assert.ok(!/track|path|footway/.test(q));
  assert.match(q, /out geom;$/);
});

test('buildRoadGraph: nodi condivisi collegano le strade', () => {
  const { elements } = network();
  const g = buildRoadGraph(elements);
  const summitId = elements[0].nodes[0];
  // dalla cima: sud, nord-est e la stradina
  assert.equal(g.adj.get(summitId).length, 3);
  assert.equal(g.ways.length, 5);
});

for (const splitAtSummit of [true, false]) {
  test(`passSides: due versanti principali (strada ${splitAtSummit ? 'divisa' : 'intera'} alla cima)`, () => {
    const { elements, south, northEast } = network({ splitAtSummit });
    const sides = passSides(elements, SUMMIT);
    assert.equal(sides.length, 2, 'la stradina senza uscita è esclusa');
    const bySouth = sides.find((s) => s.compass === 'sud');
    const byNE = sides.find((s) => s.compass === 'nord-est');
    assert.ok(bySouth && byNE, sides.map((s) => s.compass).join());
    // il punto di controllo è sulla strada del versante, ~1,5 km sotto la cima
    for (const [side, road] of [[bySouth, south], [byNE, northEast]]) {
      assert.ok(distanceToLine(side.via, road) < 1, 'punto sulla strada');
      assert.ok(Math.abs(haversine(SUMMIT, side.via) - 1500) < 30);
      assert.equal(side.road, 'SS38');
    }
    // dopo il bivio a 2,5 km il versante sud continua sulla SS38, non sulla SS301
    assert.ok(distanceToLine(bySouth.end, south) < 1);
    assert.ok(Math.abs(bySouth.length - 5000) < 5);
  });
}

test('passSides: cima un po\' fuori strada (nodo "saddle") e nessuna strada vicina', () => {
  const { elements } = network();
  const offRoad = [SUMMIT[0] + 0.0008, SUMMIT[1] + 0.001]; // ~110 m
  assert.equal(passSides(elements, offRoad).length, 2);
  assert.deepEqual(passSides(elements, [45, 9]), []);
  assert.deepEqual(passSides([], SUMMIT), []);
});

test('passSides: cima a metà di un segmento', () => {
  // strada rettilinea con un solo segmento lungo che attraversa la cima
  const a = straight(SUMMIT, 180, 3000, 3000)[0];
  const b = straight(SUMMIT, 0, 3000, 3000)[0];
  const sides = passSides([{ type: 'way', id: 1, nodes: [1, 2], geometry: [a, b].map(([lat, lon]) => ({ lat, lon })), tags: { highway: 'tertiary' } }], SUMMIT);
  assert.deepEqual(sides.map((s) => s.compass).sort(), ['nord', 'sud']);
});

test('compassLabel, nearestSide e oppositeSide', () => {
  assert.equal(compassLabel(0), 'nord');
  assert.equal(compassLabel(359), 'nord');
  assert.equal(compassLabel(200), 'sud');
  assert.equal(compassLabel(-90), 'ovest');
  const { elements } = network();
  const sides = passSides(elements, SUMMIT);
  const south = sides.findIndex((s) => s.compass === 'sud');
  // arrivando da sud (Bormio) si sale dal versante sud, da nord-est (Prato) dal versante nord-est
  assert.equal(nearestSide(sides, [46.2, 10.35]), south);
  assert.equal(nearestSide(sides, [47.5, 10.9]), sides.findIndex((s) => s.compass === 'nord-est'));
  assert.equal(oppositeSide(sides, south), sides.findIndex((s) => s.compass === 'nord-est'));
});

test('expandStops: passo completo, andata e ritorno, automatico', () => {
  const { elements } = network();
  const sides = passSides(elements, SUMMIT);
  const s = sides.findIndex((x) => x.compass === 'sud');
  const ne = oppositeSide(sides, s);
  const start = { lat: 43.52, lon: 13.61, name: 'Sirolo', type: 'break' };
  const end = { lat: 46.26, lon: 10.51, name: 'Ponte di Legno', type: 'break' };
  const pass = (mode) => ({ lat: SUMMIT[0], lon: SUMMIT[1], name: 'Passo dello Stelvio', type: 'through', snap: true, pass: { mode, sides, up: s, down: ne } });

  const full = expandStops([start, pass('full'), end]);
  assert.equal(full.length, 5);
  assert.deepEqual([full[1].lat, full[1].lon], sides[s].via);
  assert.deepEqual([full[3].lat, full[3].lon], sides[ne].via);
  assert.ok(full[1].aux && full[3].aux && !full[2].aux);
  assert.equal(full[2].type, 'through');
  assert.deepEqual(routeLocations(full).map((l) => l.type), ['break', 'through', 'through', 'through', 'break']);

  const half = expandStops([start, pass('half'), end]);
  assert.deepEqual([half[3].lat, half[3].lon], sides[s].via, 'si torna giù dallo stesso versante');
  assert.equal(half[2].type, 'break', 'in cima serve una sosta per tornare indietro');

  // partenza e arrivo non vengono mai espansi
  assert.equal(expandStops([pass('full'), end]).length, 2);
  assert.equal(expandStops([start, pass('full')]).length, 2);
  assert.equal(expandStops([start, pass('full')], true).length, 4, 'in un anello l\'ultima tappa è intermedia');
  const auto = expandStops([start, pass('auto'), end]);
  assert.equal(auto.length, 3);
  assert.equal(expandStops([start, end]).length, 2);
});

test('passCrossing: attraversato oppure andata e ritorno', () => {
  const up = [...straight([46.48, 10.44], 10, 5000, 50).slice().reverse(), [46.48, 10.44]].reverse();
  const top = up[up.length - 1];
  const across = [...up, ...straight(top, 40, 5000, 50)];
  const back = [...up, ...up.slice(0, -1).reverse()];
  assert.equal(passCrossing(across, top, cumulativeDistances(across)), 'crossed');
  assert.equal(passCrossing(back, top, cumulativeDistances(back)), 'outandback');
  assert.equal(passCrossing(across, [40, 10], cumulativeDistances(across)), 'unknown');
});
