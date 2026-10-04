// Accesso ai servizi gratuiti: Valhalla (percorsi) e Nominatim (luoghi).
import { buildValhallaRequest, valhallaUrl, isCostingError } from './core.js';

export const VALHALLA_URL = 'https://valhalla1.openstreetmap.de/route';
export const NOMINATIM_URL = 'https://nominatim.openstreetmap.org';

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

async function requestRoute(stops, loop, options, costing, signal) {
  const req = buildValhallaRequest(stops, loop, options, costing);
  const { res, body } = await getJson(valhallaUrl(VALHALLA_URL, req), signal);
  if (!res.ok || !body || !body.trip) {
    const err = new RouteError((body && body.error) || `HTTP ${res.status}`, {
      status: res.status,
      error_code: body && body.error_code,
      error: body && body.error,
    });
    throw err;
  }
  return body.trip;
}

/**
 * Calcola il percorso con costing "motorcycle"; se il server non lo supporta
 * riprova con "auto". Restituisce { trip, costing, warning }.
 */
const AUTO_WARNING =
  'Il server non supporta il profilo moto: il percorso è calcolato come per un\'auto. Controlla le strade strette o vietate alle moto.';

// se il server ha già rifiutato "motorcycle", non lo richiediamo a ogni ricalcolo
let motorcycleRejected = false;

export async function fetchRoute(stops, loop, options, signal) {
  if (!motorcycleRejected) {
    try {
      const trip = await requestRoute(stops, loop, options, 'motorcycle', signal);
      return { trip, costing: 'motorcycle', warning: null };
    } catch (e) {
      if (!isCostingError(e)) throw e;
      motorcycleRejected = true;
    }
  }
  const trip = await requestRoute(stops, loop, options, 'auto', signal);
  return { trip, costing: 'auto', warning: AUTO_WARNING };
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
  const qs = new URLSearchParams({ format: 'jsonv2', 'accept-language': 'it', ...params });
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

/** Cerca luoghi per testo. Restituisce [{ lat, lon, name, detail }]. */
export async function searchPlaces(query, near) {
  const params = { q: query, limit: '6', addressdetails: '1' };
  if (near) {
    // privilegia i risultati vicini alla zona visibile, senza escludere gli altri
    params.viewbox = near.join(',');
  }
  const list = await nominatim('search', params);
  return list.map((r) => ({
    lat: Number(r.lat),
    lon: Number(r.lon),
    name: placeName(r),
    detail: r.display_name,
  }));
}

/** Nome leggibile del punto alle coordinate date. */
export async function reverseGeocode(lat, lon) {
  const r = await nominatim('reverse', { lat: String(lat), lon: String(lon), zoom: '16', addressdetails: '1' });
  if (!r || r.error) return null;
  return placeName(r);
}

/** Nome breve: "Passo dello Stelvio", "Via Roma, Sirolo"… */
export function placeName(r) {
  const a = r.address || {};
  const town = a.village || a.town || a.city || a.hamlet || a.municipality || a.county || '';
  const road = a.road || a.pedestrian || a.path || '';
  const named = r.name && r.name !== road && r.name !== town ? r.name : '';
  const parts = [];
  if (named) parts.push(named);
  else if (road) parts.push(a.house_number ? `${road} ${a.house_number}` : road);
  if (town && !parts.includes(town)) parts.push(town);
  if (!parts.length) return (r.display_name || '').split(',').slice(0, 2).join(',').trim() || 'Punto sulla mappa';
  return parts.join(', ');
}
