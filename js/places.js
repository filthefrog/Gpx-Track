// Funzioni pure per trovare e descrivere i luoghi (risultati Nominatim).
// Nessun accesso a rete o DOM: testate in tests/places.test.mjs.

import { haversine } from './core.js?v=202610041832';

// ---------------------------------------------------------------------------
// Coordinate scritte a mano o incollate da una mappa
// ---------------------------------------------------------------------------

function dmsToDecimal(deg, min = 0, sec = 0, hemi = '') {
  const v = Number(deg) + Number(min) / 60 + Number(sec) / 3600;
  return /[SWO]/i.test(hemi) ? -v : v;
}

function valid(lat, lon) {
  return Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? [lat, lon] : null;
}

/**
 * Riconosce coordinate in un testo: "46.5286, 10.4532", "46,5286 10,4532",
 * "46°31'43\"N 10°27'11\"E", link di Google Maps (@lat,lon oppure q=lat,lon),
 * link di OpenStreetMap (#map=z/lat/lon) e Apple Maps (ll=lat,lon).
 * Restituisce [lat, lon] oppure null.
 */
export function parseCoordinates(text) {
  const t = String(text || '').trim();
  if (!t) return null;
  let m = t.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/) || t.match(/[?&](?:q|ll|query|destination|daddr|center)=(-?\d+\.\d+)(?:,|%2C)\s*(-?\d+\.\d+)/i);
  if (m) return valid(Number(m[1]), Number(m[2]));
  m = t.match(/#map=\d+\/(-?\d+\.\d+)\/(-?\d+\.\d+)/);
  if (m) return valid(Number(m[1]), Number(m[2]));
  // gradi, primi, secondi con emisfero
  m = t.match(
    /^(\d{1,3})[°º\s]\s*(\d{1,2})?['′\s]?\s*(\d{1,2}(?:[.,]\d+)?)?["″]?\s*([NS])[\s,;]+(\d{1,3})[°º\s]\s*(\d{1,2})?['′\s]?\s*(\d{1,2}(?:[.,]\d+)?)?["″]?\s*([EOW])$/i,
  );
  if (m) {
    const n = (v) => (v ? v.replace(',', '.') : 0);
    return valid(dmsToDecimal(m[1], m[2], n(m[3]), m[4]), dmsToDecimal(m[5], m[6], n(m[7]), m[8]));
  }
  // decimali: con il punto ("46.52, 10.45") o con la virgola italiana ("46,52 10,45" / "46,52; 10,45")
  m = t.match(/^(-?\d{1,2}\.\d+)\s*[,;\s]\s*(-?\d{1,3}\.\d+)$/) || t.match(/^(-?\d{1,2},\d+)\s*[;\s]\s*(-?\d{1,3},\d+)$/);
  if (m) return valid(Number(m[1].replace(',', '.')), Number(m[2].replace(',', '.')));
  return null;
}

// ---------------------------------------------------------------------------
// Varianti della ricerca
// ---------------------------------------------------------------------------

const GENERIC = {
  passo: 'pass',
  valico: 'pass',
  colle: 'pass',
  forcella: 'pass',
  sella: 'pass',
  giogo: 'pass',
  col: 'pass',
  lago: 'water',
  monte: 'peak',
  cima: 'peak',
};
const PREPOSITIONS = /^(?:(?:di|del|dello|della|dei|degli|delle|de|da|dal|dallo|dalla)\s+|(?:d|dell|dall|l)['’]\s*)/i;

/**
 * Ricerche da provare in ordine, finché una dà risultati.
 * "Passo Gavia" → ["Passo Gavia", "Gavia" (cercando un passo)].
 * Restituisce [{ q, kind }] dove kind è il tipo di luogo atteso (o null).
 */
export function queryVariants(query) {
  const q = String(query || '').replace(/\s+/g, ' ').trim();
  if (!q) return [];
  const out = [{ q, kind: null }];
  const [head, ...rest] = q.split(',');
  const words = head.trim().split(' ');
  const kind = GENERIC[words[0].toLowerCase()];
  if (kind) {
    out[0].kind = kind;
    const core = words.slice(1).join(' ').replace(PREPOSITIONS, '').trim();
    if (core.length >= 3) out.push({ q: [core, ...rest].join(','), kind });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Tipo di luogo e contesto
// ---------------------------------------------------------------------------

const ROAD_TYPES = new Set([
  'motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential',
  'service', 'living_street', 'road', 'track', 'pedestrian',
]);

/** Categoria interna del risultato: city, town, village, hamlet, pass, peak, water, road, admin, poi, other. */
export function placeCategory(r) {
  const cls = r.category || r.class || '';
  const type = r.type || '';
  const extra = r.extratags || {};
  if (type === 'saddle' || type === 'mountain_pass' || extra.mountain_pass === 'yes') return 'pass';
  if (cls === 'place') {
    if (type === 'city') return 'city';
    if (type === 'town') return 'town';
    if (type === 'village') return 'village';
    if (['hamlet', 'isolated_dwelling', 'locality', 'farm', 'neighbourhood', 'quarter', 'suburb'].includes(type)) return 'hamlet';
  }
  if (cls === 'boundary' && type === 'administrative') return 'admin';
  if (cls === 'natural' && (type === 'peak' || type === 'volcano')) return 'peak';
  if (cls === 'natural' && type === 'water') return 'water';
  if (cls === 'water' || type === 'lake' || type === 'reservoir') return 'water';
  if (cls === 'highway' && ROAD_TYPES.has(type)) return 'road';
  if (['amenity', 'tourism', 'shop', 'leisure', 'historic', 'building', 'aeroway', 'railway'].includes(cls)) return 'poi';
  return 'other';
}

const CATEGORY_LABEL = {
  city: 'Città',
  town: 'Città',
  village: 'Paese',
  hamlet: 'Località',
  pass: 'Passo',
  peak: 'Vetta',
  water: 'Lago',
  road: 'Strada',
  admin: 'Comune',
  poi: 'Luogo',
  other: 'Luogo',
};

export function placeKindLabel(r) {
  return CATEGORY_LABEL[placeCategory(r)];
}

/** Sigla della provincia dal codice ISO (es. "IT-SO" → "SO"). */
function provinceCode(a) {
  const iso = a['ISO3166-2-lvl6'] || '';
  const m = iso.match(/^IT-([A-Z]{2})$/);
  return m ? m[1] : '';
}

function townOf(a) {
  return a.city || a.town || a.village || a.hamlet || a.municipality || a.suburb || '';
}

/** Nome breve del luogo: "Passo dello Stelvio", "Via Roma 3, Sirolo", "Sirolo". */
export function placeName(r) {
  const a = r.address || {};
  const town = townOf(a);
  const road = a.road || a.pedestrian || a.path || '';
  const named = r.name && r.name !== road ? r.name : '';
  if (named) return named;
  if (road) return [a.house_number ? `${road} ${a.house_number}` : road, town].filter(Boolean).join(', ');
  if (town) return town;
  return (r.display_name || '').split(',').slice(0, 2).join(',').trim() || 'Punto sulla mappa';
}

/**
 * Dove si trova il luogo, per distinguere i risultati omonimi:
 * "Valdidentro (SO), Lombardia" oppure "Bormio, Lombardia" o "Grigioni, Svizzera".
 */
export function placeContext(r) {
  const a = r.address || {};
  const name = placeName(r);
  const town = townOf(a);
  const prov = provinceCode(a) || '';
  const parts = [];
  if (town && !name.includes(town)) parts.push(prov ? `${town} (${prov})` : town);
  else if (prov) parts.push(`Prov. ${prov}`);
  else if (a.county && !name.includes(a.county)) parts.push(a.county);
  if (a.state && a.state !== town) parts.push(a.state);
  if (a.country_code && a.country_code !== 'it' && a.country) parts.push(a.country);
  return parts.join(', ');
}

// ---------------------------------------------------------------------------
// Ordine dei risultati
// ---------------------------------------------------------------------------

const CATEGORY_BONUS = {
  city: 0.3,
  town: 0.28,
  village: 0.24,
  pass: 0.3,
  admin: 0.18,
  hamlet: 0.1,
  peak: 0.05,
  water: 0.05,
  poi: 0,
  road: -0.05,
  other: -0.05,
};

/**
 * Punteggio di un risultato: importanza di Nominatim, tipo di luogo (un giro in moto
 * passa per paesi e passi), tipo atteso dalla ricerca ("Passo …") e distanza dalla
 * tappa precedente (un omonimo a 800 km è quasi sempre quello sbagliato).
 */
export function scorePlace(r, { near = null, kind = null } = {}) {
  const cat = placeCategory(r);
  let score = Number(r.importance) || 0;
  score += CATEGORY_BONUS[cat] ?? 0;
  if (kind && cat === kind) score += 0.35;
  if (kind === 'pass' && cat !== 'pass' && cat !== 'road') score -= 0.1;
  if (near) {
    const km = haversine(near, [Number(r.lat), Number(r.lon)]) / 1000;
    score -= Math.min(0.5, km / 1200);
  }
  return score;
}

/**
 * Converte e ordina i risultati Nominatim, eliminando i doppioni
 * (stesso nome a meno di 1 km: per esempio il comune e il suo centro abitato).
 */
export function rankPlaces(results, opts = {}) {
  const list = results
    .map((r, i) => ({
      lat: Number(r.lat),
      lon: Number(r.lon),
      name: placeName(r),
      context: placeContext(r),
      kind: placeKindLabel(r),
      category: placeCategory(r),
      score: scorePlace(r, opts),
      order: i,
    }))
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon))
    .sort((a, b) => b.score - a.score || a.order - b.order);
  const out = [];
  for (const p of list) {
    if (out.some((q) => q.name === p.name && haversine([q.lat, q.lon], [p.lat, p.lon]) < 1000)) continue;
    out.push(p);
  }
  return out;
}

/** Vero se il luogo va agganciato a una strada vera (non a vialetti o sentieri). */
export function snapsToRoad(category) {
  return ['city', 'town', 'village', 'hamlet', 'admin', 'pass', 'peak', 'water'].includes(category);
}

/** Separa un elenco incollato ("Sirolo\nStelvio" o "Sirolo; Stelvio") nelle singole località. */
export function splitPlaces(text) {
  return String(text || '')
    .split(/\r?\n|;|\s+[→>–-]\s+/)
    // numerazione "1. " / "2) " / "- ": serve lo spazio dopo, altrimenti "44.49, 11.34" perderebbe "44."
    .map((s) => s.replace(/^\s*(?:\d+[.)]|[-•*])\s+/, '').trim())
    .filter(Boolean);
}
