import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_OPTIONS, haversine } from '../js/core.js';
import { fetchRoute, resetLearnedLimits } from '../js/services.js';
import { installValhallaFinto, SARDEGNA } from './valhalla-finto.mjs';

beforeEach(() => resetLearnedLimits());

const km = (list) => list.slice(1).reduce((a, s, i) => a + haversine([list[i].lat, list[i].lon], [s.lat, s.lon]), 0) / 1000;
const stops = () => SARDEGNA.map((s) => ({ ...s }));

async function calcola(cfg, { loop = false, list = stops() } = {}) {
  const finto = installValhallaFinto(cfg);
  try {
    const res = await fetchRoute(list, loop, { ...DEFAULT_OPTIONS });
    return { res, finto };
  } finally {
    finto.restore();
  }
}

const SCENARI = [
  ['limite moto 500 km', { distance: { motorcycle: 500000, auto: 5000000 } }],
  ['limite moto 1500 km (il caso dello screenshot)', { distance: { motorcycle: 1500000, auto: 1500000 } }],
  ['il server misura il 35% in più', { distance: { motorcycle: 1500000, auto: 1500000 }, factor: 1.35 }],
  ['il server misura il doppio', { distance: { motorcycle: 800000, auto: 4000000 }, factor: 2 }],
  ['massimo 8 località', { maxLocations: 8, distance: { motorcycle: 500000, auto: 1500000 } }],
  ['massimo 20 località e 1500 km', { maxLocations: 20, distance: { motorcycle: 1500000, auto: 1500000 } }],
  ['massimo 3 località', { maxLocations: 3, distance: { motorcycle: 900000, auto: 3000000 } }],
];

for (const loop of [false, true]) {
  for (const [nome, cfg] of SCENARI) {
    test(`31 tappe in Sardegna (${loop ? 'anello' : 'andata'}): ${nome}`, async () => {
      const { res, finto } = await calcola(cfg, { loop });
      // il percorso comprende tutte le tappe, in ordine, senza buchi
      const attesi = km(loop ? [...SARDEGNA, SARDEGNA[0]] : SARDEGNA);
      assert.ok(Math.abs(res.trip.summary.length - attesi) < 1, `km ${res.trip.summary.length} invece di ${attesi}`);
      assert.equal(res.trip.legs.length, loop ? 31 : 30);
      // le richieste andate a buon fine rispettano i limiti del server; i tentativi a vuoto sono pochi
      assert.ok(finto.requests.length < 90, `${finto.requests.length} richieste`);
      assert.ok(res.trip.summary.length > 0);
    });
  }
}

test('un giro che sta nei limiti si calcola con una sola richiesta', async () => {
  const vicine = [0, 30, 7, 29].map((i) => ({ ...SARDEGNA[i] })); // Santa Teresa, La Maddalena, Olbia, Budoni
  const { res, finto } = await calcola({}, { list: vicine });
  assert.equal(finto.requests.length, 1);
  assert.equal(res.trip.legs.length, 3);
});

test('i limiti imparati si ricordano: il ricalcolo non ritenta il giro intero', async () => {
  const cfg = { maxLocations: 8, distance: { motorcycle: 500000, auto: 1500000 }, factor: 1.4 };
  const prima = await calcola(cfg);
  const seconda = await calcola(cfg);
  assert.ok(seconda.finto.requests.length <= prima.finto.requests.length);
  // nessun tentativo a vuoto con tutte le 31 località insieme
  assert.ok(seconda.finto.requests.every((r) => r.locations <= 8), JSON.stringify(seconda.finto.requests.map((r) => r.locations)));
});

test('una tratta oltre il limite del profilo moto si calcola come auto, con avviso', async () => {
  // Cagliari → Santa Teresa (circa 290 km) con un limite moto di 200 km
  const due = [SARDEGNA[10], SARDEGNA[0]].map((s) => ({ ...s }));
  const { res } = await calcola({ distance: { motorcycle: 200000, auto: 5000000 } }, { list: due });
  assert.equal(res.costing, 'auto');
  assert.match(res.warning, /auto/);
  assert.equal(res.trip.legs.length, 1);
});

test('una tratta che anche il profilo auto rifiuta è un errore vero e chiaro', async () => {
  const due = [SARDEGNA[10], SARDEGNA[0]].map((s) => ({ ...s }));
  await assert.rejects(calcola({ distance: { motorcycle: 100000, auto: 100000 } }, { list: due }), (e) => e.error_code === 154);
});

test('errori che non c\'entrano con i limiti non vengono mascherati', async () => {
  const finto = installValhallaFinto({ failCosting: ['motorcycle', 'auto'] });
  try {
    await assert.rejects(fetchRoute(stops().slice(0, 3), false, { ...DEFAULT_OPTIONS }), (e) => e.error_code === 125);
  } finally {
    finto.restore();
  }
});
