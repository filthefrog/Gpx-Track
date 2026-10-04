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
  // il trattino dentro un nome non divide
  assert.deepEqual(splitPlaces('Sesto San Giovanni-Nord'), ['Sesto San Giovanni-Nord']);
});
