import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseCoordinates,
  queryVariants,
  placeCategory,
  placeName,
  placeContext,
  rankPlaces,
  scorePlace,
  snapsToRoad,
  splitPlaces,
  pickByNeighbours,
  parseRoad,
  roadQuery,
  chooseRoadPoints,
  farOffKm,
  shorterOrder,
  photonCandidates,
} from '../js/places.js';
import { routeLocations, buildValhallaRequest, isSnapError } from '../js/core.js';

// Risultati in formato Nominatim jsonv2 (addressdetails=1, extratags=1)
const SIROLO = {
  lat: '43.5228', lon: '13.6155', category: 'place', type: 'town', importance: 0.45, name: 'Sirolo',
  address: { town: 'Sirolo', county: 'Ancona', 'ISO3166-2-lvl6': 'IT-AN', state: 'Marche', country: 'Italia', country_code: 'it' },
  display_name: 'Sirolo, Ancona, Marche, Italia',
};
const GAVIA_PASS = {
  lat: '46.3437', lon: '10.4876', category: 'natural', type: 'saddle', importance: 0.32, name: 'Passo di Gavia',
  address: { village: 'Valfurva', county: 'Sondrio', 'ISO3166-2-lvl6': 'IT-SO', state: 'Lombardia', country: 'Italia', country_code: 'it' },
};
const GAVIA_STREET = {
  lat: '45.4781', lon: '9.2273', category: 'highway', type: 'residential', importance: 0.2, name: 'Via Gavia',
  address: { road: 'Via Gavia', city: 'Milano', 'ISO3166-2-lvl6': 'IT-MI', state: 'Lombardia', country: 'Italia', country_code: 'it' },
};
const STELVIO_PASS = {
  lat: '46.5286', lon: '10.4532', category: 'highway', type: 'unclassified', importance: 0.42, name: 'Passo dello Stelvio',
  extratags: { mountain_pass: 'yes', ele: '2757' },
  address: { village: 'Valdidentro', county: 'Sondrio', 'ISO3166-2-lvl6': 'IT-SO', state: 'Lombardia', country: 'Italia', country_code: 'it' },
};
const STELVIO_PARK = {
  lat: '46.45', lon: '10.6', category: 'boundary', type: 'national_park', importance: 0.5, name: 'Parco Nazionale dello Stelvio',
  address: { state: 'Lombardia', country: 'Italia', country_code: 'it' },
};
const CASTEL_SAN_PIETRO_BO = {
  lat: '44.398', lon: '11.589', category: 'place', type: 'town', importance: 0.4, name: 'Castel San Pietro Terme',
  address: { town: 'Castel San Pietro Terme', 'ISO3166-2-lvl6': 'IT-BO', state: 'Emilia-Romagna', country: 'Italia', country_code: 'it' },
};
const SAN_PIETRO_TI = {
  lat: '46.21', lon: '9.02', category: 'place', type: 'village', importance: 0.4, name: 'Castel San Pietro',
  address: { village: 'Castel San Pietro', county: 'Distretto di Mendrisio', state: 'Ticino', country: 'Svizzera', country_code: 'ch' },
};

test('parseCoordinates: decimali, virgola italiana, gradi e link', () => {
  assert.deepEqual(parseCoordinates('46.5286, 10.4532'), [46.5286, 10.4532]);
  assert.deepEqual(parseCoordinates('46.5286 10.4532'), [46.5286, 10.4532]);
  assert.deepEqual(parseCoordinates('46,5286 10,4532'), [46.5286, 10.4532]);
  assert.deepEqual(parseCoordinates('46,5286; 10,4532'), [46.5286, 10.4532]);
  assert.deepEqual(parseCoordinates('-33.86, 151.2'), [-33.86, 151.2]);
  const dms = parseCoordinates('46°31\'43"N 10°27\'11"E');
  assert.ok(Math.abs(dms[0] - 46.52861) < 1e-4 && Math.abs(dms[1] - 10.45306) < 1e-4);
  assert.deepEqual(parseCoordinates('https://www.google.com/maps/place/Stelvio/@46.5286,10.4532,15z'), [46.5286, 10.4532]);
  assert.deepEqual(parseCoordinates('https://maps.google.com/?q=46.5286,10.4532'), [46.5286, 10.4532]);
  assert.deepEqual(parseCoordinates('https://maps.apple.com/?ll=46.5286,10.4532&q=Stelvio'), [46.5286, 10.4532]);
  assert.deepEqual(parseCoordinates('https://www.openstreetmap.org/#map=15/46.5286/10.4532'), [46.5286, 10.4532]);
});

test('parseCoordinates: i nomi e i numeri civici non sono coordinate', () => {
  assert.equal(parseCoordinates('Sirolo'), null);
  assert.equal(parseCoordinates('Via Roma 12, Sirolo'), null);
  assert.equal(parseCoordinates('SS38 km 12'), null);
  assert.equal(parseCoordinates('95.1, 10.2'), null);
  assert.equal(parseCoordinates(''), null);
});

test('queryVariants: per i passi prova anche il nome senza "Passo di"', () => {
  assert.deepEqual(queryVariants('  Sirolo  '), [{ q: 'Sirolo', kind: null }]);
  assert.deepEqual(queryVariants('Passo Gavia'), [
    { q: 'Passo Gavia', kind: 'pass' },
    { q: 'Gavia', kind: 'pass' },
  ]);
  assert.deepEqual(queryVariants('passo dello Stelvio, Sondrio'), [
    { q: 'passo dello Stelvio, Sondrio', kind: 'pass' },
    { q: 'Stelvio, Sondrio', kind: 'pass' },
  ]);
  assert.deepEqual(queryVariants("Colle dell'Agnello").map((v) => v.q), ["Colle dell'Agnello", 'Agnello']);
  assert.equal(queryVariants('').length, 0);
});

test('queryVariants: parentesi, strade e abbreviazioni scritte alla buona', () => {
  const qs = (t) => queryVariants(t).map((v) => v.q);
  // il caso del giro Osimo → Livorno
  const fipili = qs('Firenze Nord (superstrada Fi-Pi-Li)');
  assert.ok(fipili.includes('Firenze Nord'));
  assert.ok(fipili.includes('Firenze Nord, Strada di grande comunicazione Firenze-Pisa-Livorno'));
  assert.ok(fipili.includes('Firenze'));
  for (const w of ['Firenze nord PPL', 'Firenze nord fipili', 'Firenze Nord (superstrada fi pi li)'])
    assert.ok(qs(w).some((q) => /Firenze-Pisa-Livorno/.test(q)), w);
  assert.deepEqual(qs('Livorno Porto'), ['Livorno Porto', 'Porto di Livorno', 'Livorno']);
  assert.ok(qs('Borgo S. Lorenzo').includes('Borgo San Lorenzo'));
  assert.deepEqual(queryVariants('P.so della Futa')[1], { q: 'Passo della Futa', kind: 'pass' });
  assert.ok(qs('SS 71, Arezzo').includes('Strada statale 71, Arezzo'));
  assert.ok(qs('Città di Castello').includes('Citta di Castello'));
  assert.ok(qs('Uscita Firenze Nord').includes('Firenze'));
  // nessun doppione e non troppe richieste
  for (const t of ['Firenze Nord (superstrada Fi-Pi-Li)', 'Passo dello Spino', 'Livorno Porto']) {
    const l = qs(t).map((x) => x.toLowerCase());
    assert.equal(new Set(l).size, l.length);
    assert.ok(l.length <= 7);
  }
});

test('splitPlaces: il giro con frecce e parentesi si divide nelle 10 tappe', () => {
  const t = 'Osimo → Bocca Trabaria → Città di Castello → Passo dello Spino → Borgo San Lorenzo → Barberino di Mugello → Firenzuola → Passo della Futa → Firenze Nord (superstrada Fi-Pi-Li) → Livorno Porto';
  const parts = splitPlaces(t);
  assert.equal(parts.length, 10);
  assert.equal(parts[8], 'Firenze Nord (superstrada Fi-Pi-Li)');
});

test('placeCategory: lo svincolo autostradale è una strada', () => {
  assert.equal(placeCategory({ category: 'highway', type: 'motorway_junction' }), 'road');
});

test('placeCategory: passi riconosciuti come nodo naturale o come strada con mountain_pass', () => {
  assert.equal(placeCategory(GAVIA_PASS), 'pass');
  assert.equal(placeCategory(STELVIO_PASS), 'pass');
  assert.equal(placeCategory(SIROLO), 'town');
  assert.equal(placeCategory(GAVIA_STREET), 'road');
  assert.equal(placeCategory({ category: 'boundary', type: 'administrative' }), 'admin');
});

test('placeName e placeContext: nome breve e dove si trova', () => {
  assert.equal(placeName(SIROLO), 'Sirolo');
  assert.equal(placeContext(SIROLO), 'Prov. AN, Marche');
  assert.equal(placeName(STELVIO_PASS), 'Passo dello Stelvio');
  assert.equal(placeContext(STELVIO_PASS), 'Valdidentro (SO), Lombardia');
  assert.equal(placeName(GAVIA_STREET), 'Via Gavia, Milano');
  assert.equal(placeContext(GAVIA_STREET), 'Prov. MI, Lombardia');
  assert.equal(placeContext(SAN_PIETRO_TI), 'Distretto di Mendrisio, Ticino, Svizzera');
  assert.equal(placeName({ address: { road: 'Via Roma', house_number: '3', village: 'Bormio' } }), 'Via Roma 3, Bormio');
});

test('rankPlaces: per "Passo Gavia" il passo batte la via di Milano', () => {
  const ranked = rankPlaces([GAVIA_STREET, GAVIA_PASS], { kind: 'pass' });
  assert.equal(ranked[0].name, 'Passo di Gavia');
  assert.equal(ranked[0].kind, 'Passo');
  assert.equal(ranked[0].context, 'Valfurva (SO), Lombardia');
});

test('rankPlaces: il passo batte il parco nazionale più "importante"', () => {
  const ranked = rankPlaces([STELVIO_PARK, STELVIO_PASS], { kind: 'pass' });
  assert.equal(ranked[0].name, 'Passo dello Stelvio');
});

test('rankPlaces: a parità di nome vince il luogo vicino alla tappa precedente', () => {
  const nearBologna = [44.49, 11.34];
  const nearComo = [45.81, 9.08];
  assert.equal(rankPlaces([SAN_PIETRO_TI, CASTEL_SAN_PIETRO_BO], { near: nearBologna })[0].context, 'Prov. BO, Emilia-Romagna');
  assert.equal(rankPlaces([CASTEL_SAN_PIETRO_BO, SAN_PIETRO_TI], { near: nearComo })[0].context, 'Distretto di Mendrisio, Ticino, Svizzera');
  assert.ok(scorePlace(SAN_PIETRO_TI, { near: nearComo }) > scorePlace(SAN_PIETRO_TI, { near: nearBologna }));
});

test('rankPlaces: elimina i doppioni vicini e i risultati senza coordinate', () => {
  const dup = { ...SIROLO, category: 'boundary', type: 'administrative', lat: '43.521', importance: 0.5 };
  const ranked = rankPlaces([SIROLO, dup, { name: 'Rotto', lat: 'x', lon: 'y' }]);
  assert.equal(ranked.length, 1);
});

test('snapsToRoad e routeLocations: filtro strade solo per i luoghi trovati con la ricerca', () => {
  assert.ok(snapsToRoad('village') && snapsToRoad('pass'));
  assert.ok(!snapsToRoad('road') && !snapsToRoad('poi'));
  const stops = [
    { lat: 43.5228, lon: 13.6155, snap: true },
    { lat: 46.0, lon: 10.0, type: 'through' },
    { lat: 46.259, lon: 10.5096, snap: true },
  ];
  const locs = routeLocations(stops, false, { snap: true });
  assert.deepEqual(locs[0].search_filter, { min_road_class: 'residential' });
  assert.equal(locs[1].search_filter, undefined);
  assert.equal(routeLocations(stops, false)[0].search_filter, undefined);
  assert.ok(buildValhallaRequest(stops, false).locations[2].search_filter);
  assert.equal(buildValhallaRequest(stops, false, undefined, 'motorcycle', { snap: false }).locations[2].search_filter, undefined);
  assert.ok(isSnapError({ error_code: 171 }) && !isSnapError({ error_code: 442 }));
});

test('splitPlaces: elenchi incollati in vari formati', () => {
  assert.deepEqual(splitPlaces('Sirolo\nPasso dello Stelvio\n\n Ponte di Legno '), ['Sirolo', 'Passo dello Stelvio', 'Ponte di Legno']);
  assert.deepEqual(splitPlaces('Sirolo; Stelvio; Gavia'), ['Sirolo', 'Stelvio', 'Gavia']);
  assert.deepEqual(splitPlaces('Sirolo → Stelvio → Gavia'), ['Sirolo', 'Stelvio', 'Gavia']);
  assert.deepEqual(splitPlaces('1. Sirolo\n2) Stelvio\n- Gavia'), ['Sirolo', 'Stelvio', 'Gavia']);
  // coordinate con il punto: non sono un elenco numerato
  assert.deepEqual(splitPlaces('Sirolo\n44.49, 11.34\nStelvio'), ['Sirolo', '44.49, 11.34', 'Stelvio']);
  // il trattino dentro un nome non divide
  assert.deepEqual(splitPlaces('Sesto San Giovanni-Nord'), ['Sesto San Giovanni-Nord']);
});

test('pickByNeighbours: tra due omonimi sceglie quello che non allunga il giro', () => {
  const ok = (name, lat, lon, extra = {}) => ({ status: 'ok', name, lat, lon, ...extra });
  const near = { lat: 44.15, lon: 11.4, name: 'Futa' };
  const far = { lat: 45.6, lon: 9.5, name: 'Futa (altro)' };
  const stops = [
    ok('Firenzuola', 44.12, 11.38),
    ok('Futa', far.lat, far.lon, { candidates: [far, near] }),
    ok('Firenze', 43.77, 11.25),
  ];
  const picks = pickByNeighbours(stops);
  assert.equal(picks.length, 1);
  assert.equal(picks[0].index, 1);
  assert.equal(picks[0].candidate, near);
  // scelta a mano o già vicina: non si tocca
  assert.deepEqual(pickByNeighbours([stops[0], { ...stops[1], manual: true }, stops[2]]), []);
  assert.deepEqual(pickByNeighbours([stops[0], { ...stops[1], lat: near.lat, lon: near.lon }, stops[2]]), []);
  // senza vicini da una parte non si decide
  assert.deepEqual(pickByNeighbours([stops[1], stops[2]]), []);
});

test('farOffKm: avvisa solo per tappe molto fuori dal giro, non per i giri di andata e ritorno', () => {
  const p = (lat, lon) => ({ status: 'ok', lat, lon });
  assert.ok(farOffKm([p(44.12, 11.38), p(45.6, 9.5), p(43.77, 11.25)], 1) > 100);
  assert.equal(farOffKm([p(44.12, 11.38), p(44.0, 11.3), p(43.77, 11.25)], 1), 0);
  // andata e ritorno alla stessa partenza: la meta lontana è voluta
  assert.equal(farOffKm([p(43.52, 13.6), p(46.5, 10.4), p(43.52, 13.6)], 1), 0);
  assert.equal(farOffKm([p(43.52, 13.6), p(46.5, 10.4)], 0), 0);
});

test('parseRoad: riconosce le strade scritte in tanti modi', () => {
  const label = (t) => (parseRoad(t) || {}).label;
  for (const t of ['S.S. 123', 'SS123', 'ss 123', 'S.S. n° 123', 'Strada Statale 123', 'statale 123', "SS 123 dell'Abetone"]) assert.equal(label(t), 'SS 123', t);
  assert.equal(label('SS 3 bis'), 'SS 3 bis');
  assert.equal(label('S.P. 45'), 'SP 45');
  assert.equal(label('SP45'), 'SP 45');
  assert.equal(label('Strada provinciale 9'), 'SP 9');
  assert.equal(label('SR 71'), 'SR 71');
  assert.equal(label('A14'), 'A 14');
  assert.equal(label('Autostrada A1'), 'A 1');
  assert.equal(label('E45'), 'E 45');
  for (const t of ['Fi Pi Li', 'Fi-Pi-Li', 'FIPILI', 'Firenze Pisa Livorno', 'Firenze-Pisa-Livorno', 'superstrada PPL']) assert.equal(label(t), 'Fi-Pi-Li', t);
  // località normali non diventano strade
  for (const t of ['Siena', 'Sassari', 'A Roma', 'Passo Gavia', 'S. Lorenzo', 'Ascoli', 'Assisi', '46.5, 10.4', 'Sestri Levante', 'Pisa', 'Spoleto', 'Roma Eur', 'Savona']) assert.equal(parseRoad(t), null, t);
});

test('roadQuery e chooseRoadPoints: la strada tra la tappa prima e quella dopo', () => {
  const q = roadQuery(parseRoad('SS 123'), [43.5, 11], [43.7, 11.4]);
  assert.match(q, /way\["highway"\]\["ref"~"\(\^\|;\) \*SS \*123/);
  assert.match(q, /out geom/);
  assert.match(roadQuery(parseRoad('Fi-Pi-Li'), [43.77, 11.25]), /Firenze\.\?Pisa\.\?Livorno/);
  // tappe molto distanti: due cerchi invece di un rettangolo enorme
  assert.match(roadQuery(parseRoad('A14'), [43.5, 13.5], [44.5, 11.3]), /around:35000/);

  // una strada dritta verso est a lat 43.6, da lon 11.0 a 11.6
  const way = { geometry: Array.from({ length: 61 }, (_, i) => ({ lat: 43.6, lon: 11 + i * 0.01 })) };
  const p = chooseRoadPoints([way], [43.55, 11.05], [43.62, 11.55]);
  assert.deepEqual(p.before, [43.6, 11.05]);
  assert.deepEqual(p.after, [43.6, 11.55]);
  assert.ok(Math.abs(p.mid[1] - 11.3) < 0.02);
  // solo una tappa vicina: un punto solo
  assert.deepEqual(chooseRoadPoints([way], [43.55, 11.05]), { mid: [43.6, 11.05], before: null, after: null });
  // strada troppo lontana (oltre 40 km): non è quella
  assert.equal(chooseRoadPoints([way], [45, 11.05]), null);
  assert.equal(chooseRoadPoints([], [43.55, 11.05]), null);
});

test('scorePlace: con tappa prima e dopo vince l\'omonimo che non allunga il giro', () => {
  const mk = (lat, lon) => ({ lat: String(lat), lon: String(lon), category: 'place', type: 'town', importance: 0.5, name: 'X', address: {} });
  const prev = [44.12, 11.38];
  const next = [43.77, 11.25];
  const good = scorePlace(mk(43.95, 11.3), { near: prev, next });
  const bad = scorePlace(mk(45.6, 9.5), { near: prev, next });
  assert.ok(good > bad + 0.3);
});

test('shorterOrder: propone un ordine più corto solo se il risparmio è grande', () => {
  const p = (lat, lon) => ({ lat, lon });
  // partenza, arrivo e due tappe messe in ordine "a zig zag"
  const zig = [p(43, 11), p(43, 13), p(43.05, 11.5), p(43.1, 12.5), p(43.1, 14)];
  const r = shorterOrder(zig);
  assert.ok(r && r.saved > 25000);
  assert.equal(r.order[0], 0);
  assert.equal(r.order.at(-1), 4);
  assert.deepEqual([...r.order].sort(), [0, 1, 2, 3, 4]);
  // già in ordine: niente da proporre
  assert.equal(shorterOrder([p(43, 11), p(43, 11.5), p(43, 12), p(43, 12.5), p(43, 13)]), null);
  assert.equal(shorterOrder([p(43, 11), p(44, 12), p(45, 13)]), null);
  // anello: la partenza resta ferma
  const loop = shorterOrder([p(43, 11), p(43, 13), p(43.05, 11.5), p(43.1, 12.5), p(43.1, 12.9)], true);
  assert.ok(!loop || loop.order[0] === 0);
});

test('photonCandidates: risultati di Photon ordinati per vicinanza alle tappe, senza doppioni', () => {
  const f = (name, lon, lat, key, value, extra = {}) => ({ geometry: { coordinates: [lon, lat] }, properties: { name, osm_key: key, osm_value: value, state: 'Toscana', ...extra } });
  const geo = {
    features: [
      f('Firenzuola', 9.5, 45.4, 'place', 'village', { county: 'Lodi' }), // omonimo lontano
      f('Firenzuola', 11.38, 44.12, 'place', 'town', { county: 'Firenze' }),
      f('Firenzuola', 11.381, 44.1205, 'place', 'hamlet'), // doppione a meno di 1 km
      f('Passo della Futa', 11.3, 44.1, 'natural', 'saddle'),
      { geometry: null, properties: { name: 'Rotto' } },
      f('', 11, 44, 'place', 'town'),
    ],
  };
  const out = photonCandidates(geo, { near: [43.77, 11.25], next: [44.5, 11.3] });
  assert.equal(out[0].name === 'Firenzuola' || out[0].name === 'Passo della Futa', true);
  assert.deepEqual(out.map((c) => c.name).filter((n) => n === 'Firenzuola').length, 2); // lontano e vicino restano, il doppione no
  assert.equal(out.findIndex((c) => c.lat === 44.12) < out.findIndex((c) => c.lat === 45.4), true);
  assert.equal(out.find((c) => c.name === 'Passo della Futa').category, 'pass');
  assert.equal(out.every((c) => c.fuzzy), true);
  assert.deepEqual(photonCandidates(null), []);
});
