// Accesso ai servizi gratuiti: Valhalla (percorsi) e Nominatim (luoghi).
import { buildValhallaRequest, valhallaUrl, isCostingError, isSnapError } from './core.js';
import { parseCoordinates, queryVariants, rankPlaces, placeName, placeContext } from './places.js';
import { overpassQuery, passSides } from './passes.js';

export const VALHALLA_URL = 'https://valhalla1.openstreetmap.de/route';
export const NOMINATIM_URL = 'https://nominatim.openstreetmap.org';
export const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';

/** Errore con i dettagli di Valhalla (error_code, status HTTP, problema di rete). */
export class RouteError extends Error {
  constructor(message, extra = {}) {
    super(message);
    Object.assign(this, extra);
  }
}

async function getJson(url, signal) {
  let res;
  try {
    res = await fetch(url, { signal, headers: { Accept: 'application/json' } });
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    throw new RouteError('Errore di rete', { network: true });
  }
  let body = null;
  try {
    body = await res.json();
  } catch {
    // corpo non JSON (per esempio una pagina di errore del proxy)
  }
  return { res, body };
}

async function requestRoute(stops, loop, options, costing, snap, signal) {
  const req = buildValhallaRequest(stops, loop, options, costing, { snap });
  const { res, body } = await getJson(valhallaUrl(VALHALLA_URL, req), signal);
  if (!res.ok || !body || !body.trip) {
    throw new RouteError((body && body.error) || `HTTP ${res.status}`, {
      status: res.status,
      error_code: body && body.error_code,
      error: body && body.error,
    });
  }
  return body.trip;
}

const AUTO_WARNING =
  'Il server non supporta il profilo moto: il percorso è calcolato come per un\'auto. Controlla le strade strette o vietate alle moto.';

// se il server ha già rifiutato "motorcycle", non lo richiediamo a ogni ricalcolo
let motorcycleRejected = false;

/**
 * Calcola il percorso con costing "motorcycle"; se il server non lo supporta
 * riprova con "auto". Se una località non ha strade "vere" vicine (errore 171),
 * riprova senza il filtro che esclude le strade di servizio.
 * Restituisce { trip, costing, warning }.
 */
export async function fetchRoute(stops, loop, options, signal) {
  const attempt = async (snap) => {
    if (!motorcycleRejected) {
      try {
        return { trip: await requestRoute(stops, loop, options, 'motorcycle', snap, signal), costing: 'motorcycle', warning: null };
      } catch (e) {
        if (!isCostingError(e)) throw e;
        motorcycleRejected = true;
      }
    }
    return { trip: await requestRoute(stops, loop, options, 'auto', snap, signal), costing: 'auto', warning: AUTO_WARNING };
  };
  try {
    return await attempt(true);
  } catch (e) {
    if (!isSnapError(e) || !stops.some((s) => s.snap)) throw e;
    return attempt(false);
  }
}

// ---------------------------------------------------------------------------
// Nominatim: al massimo una richiesta al secondo, in coda
// ---------------------------------------------------------------------------

let queue = Promise.resolve();
let lastRequest = 0;

function throttled(fn) {
  const run = queue.then(async () => {
    const wait = lastRequest + 1000 - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastRequest = Date.now();
    return fn();
  });
  // la coda continua anche se una richiesta fallisce
  queue = run.catch(() => {});
  return run;
}

async function nominatim(path, params) {
  const qs = new URLSearchParams({ format: 'jsonv2', 'accept-language': 'it', addressdetails: '1', ...params });
  return throttled(async () => {
    let res;
    try {
      res = await fetch(`${NOMINATIM_URL}/${path}?${qs}`, { headers: { Accept: 'application/json' } });
    } catch {
      throw new Error('Impossibile contattare il servizio di ricerca. Controlla la connessione e riprova.');
    }
    if (res.status === 429 || res.status === 403)
      throw new Error('Il servizio di ricerca ha limitato le richieste. Aspetta un minuto e riprova.');
    if (!res.ok) throw new Error(`La ricerca non è riuscita (HTTP ${res.status}). Riprova tra poco.`);
    return res.json();
  });
}

function coordLabel(lat, lon) {
  return `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
}

/**
 * Cerca un luogo. Accetta nomi ("Passo Gavia", "Bormio, Sondrio"), coordinate e
 * link di Google/Apple Maps o OpenStreetMap.
 * `near` = [lat, lon] della tappa precedente, per preferire gli omonimi vicini.
 * Restituisce i candidati migliori: [{ lat, lon, name, context, kind, category }].
 */
export async function searchPlaces(query, { near = null } = {}) {
  const coords = parseCoordinates(query);
  if (coords) {
    const [lat, lon] = coords;
    const place = await reverseGeocode(lat, lon).catch(() => null);
    return [{ lat, lon, name: place ? place.name : coordLabel(lat, lon), context: place ? place.context : coordLabel(lat, lon), kind: 'Coordinate', category: 'coords' }];
  }
  for (const v of queryVariants(query)) {
    const list = await nominatim('search', { q: v.q, limit: '8', extratags: '1' });
    if (list.length) return rankPlaces(list, { near, kind: v.kind }).slice(0, 6);
  }
  return [];
}

/** Nome e contesto del punto alle coordinate date. */
export async function reverseGeocode(lat, lon) {
  const r = await nominatim('reverse', { lat: String(lat), lon: String(lon), zoom: '16' });
  if (!r || r.error) return null;
  return { name: placeName(r), context: placeContext(r) };
}

/** Comune o paese alle coordinate date (per dare un nome ai versanti di un passo). */
async function townAt(lat, lon) {
  const r = await nominatim('reverse', { lat: String(lat), lon: String(lon), zoom: '13' });
  const a = (r && r.address) || {};
  return a.village || a.town || a.city || a.hamlet || a.municipality || '';
}

// ---------------------------------------------------------------------------
// Overpass: strade attorno a un passo
// ---------------------------------------------------------------------------

/**
 * Versanti del passo: [{ via, end, bearing, compass, length, road, place }].
 * `place` è il paese verso cui scende il versante (può mancare).
 */
export async function fetchPassSides(lat, lon) {
  let res;
  try {
    res = await fetch(`${OVERPASS_URL}?data=${encodeURIComponent(overpassQuery(lat, lon))}`);
  } catch {
    throw new Error('Impossibile leggere le strade del passo: controlla la connessione e riprova.');
  }
  if (res.status === 429 || res.status === 504)
    throw new Error('Il servizio delle strade (Overpass) è occupato. Riprova tra un minuto.');
  if (!res.ok) throw new Error(`Lettura delle strade del passo non riuscita (HTTP ${res.status}). Riprova tra poco.`);
  const body = await res.json();
  const sides = passSides(body.elements || [], [lat, lon]);
  for (const side of sides) {
    side.place = await townAt(side.end[0], side.end[1]).catch(() => '');
  }
  return sides;
}
