// Accesso ai servizi gratuiti: Valhalla (percorsi) e Nominatim (luoghi).
import { DEFAULT_OPTIONS, haversine, buildValhallaRequest, valhallaUrl, isCostingError, isSnapError, isDistanceError, distanceLimit, isLocationsError, locationLimit, nextChunkEnd, mergeTrips, parseTrip, curvature, pickScenic, resampleShape, encodePolyline } from './core.js?v=202610221952';
import { parseCoordinates, queryVariants, rankPlaces, placeName, placeContext } from './places.js?v=202610221952';
import { overpassQuery, passSides } from './passes.js?v=202610221952';

export const VALHALLA_URL = 'https://valhalla1.openstreetmap.de/route';
export const HEIGHT_URL = 'https://valhalla1.openstreetmap.de/height';

const wait = (ms, signal) =>
  new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    if (signal) signal.addEventListener('abort', () => (clearTimeout(t), reject(new DOMException('Annullato', 'AbortError'))), { once: true });
  });

/** Problemi passeggeri (rete, server occupato o in errore): vale la pena riprovare. */
function transient(err) {
  return !!err && (err.network || err.timeout || err.status === 429 || err.status >= 500);
}
export const NOMINATIM_URL = 'https://nominatim.openstreetmap.org';
export const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';

/** Errore con i dettagli di Valhalla (error_code, status HTTP, problema di rete). */
export class RouteError extends Error {
  constructor(message, extra = {}) {
    super(message);
    Object.assign(this, extra);
  }
}

const ROUTE_TIMEOUT = 60000;

async function getJson(url, signal) {
  // senza risposta entro un minuto si smette di aspettare (il server pubblico a volte è sovraccarico)
  const ctrl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ctrl.abort();
  }, ROUTE_TIMEOUT);
  const stop = () => ctrl.abort();
  if (signal) signal.addEventListener('abort', stop);
  let res;
  try {
    res = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
  } catch (e) {
    if (timedOut) throw new RouteError('Tempo scaduto', { timeout: true });
    if (e.name === 'AbortError') throw e;
    throw new RouteError('Errore di rete', { network: true });
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', stop);
  }
  let body = null;
  try {
    body = await res.json();
  } catch {
    // corpo non JSON (per esempio una pagina di errore del proxy)
  }
  return { res, body };
}

async function requestRoute(stops, loop, options, costing, snap, signal, alternates = 0) {
  try {
    return await requestRouteOnce(stops, loop, options, costing, snap, signal, alternates);
  } catch (e) {
    // un secondo tentativo dopo una breve pausa: il server pubblico a volte è solo occupato
    if (!transient(e) || e.timeout) throw e;
    await wait(1500, signal);
    return requestRouteOnce(stops, loop, options, costing, snap, signal, alternates);
  }
}

async function requestRouteOnce(stops, loop, options, costing, snap, signal, alternates) {
  const req = buildValhallaRequest(stops, loop, options, costing, { snap, alternates });
  const { res, body } = await getJson(valhallaUrl(VALHALLA_URL, req), signal);
  if (!res.ok || !body || !body.trip) {
    throw new RouteError((body && body.error) || `HTTP ${res.status}`, {
      status: res.status,
      error_code: body && body.error_code,
      error: body && body.error,
    });
  }
  // le alternative arrivano solo se richieste e se il server le trova
  return { trip: body.trip, alternates: (body.alternates || []).map((a) => a.trip).filter(Boolean) };
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
  if (options && options.style === 'scenic') return fetchScenic(stops, loop, options, signal);
  // limiti già visti in un calcolo precedente: se il giro li supera si parte direttamente a pezzi
  const all = loop && stops.length >= 2 ? [...stops, stops[0]] : stops;
  if ((learned.locs && all.length > learned.locs * learned.locations) || (learned.meters && chainMeters(all) > learned.meters * learned.distance))
    return fetchInPieces(stops, loop, options, signal, null);
  try {
    return await fetchWhole(stops, loop, options, signal);
  } catch (e) {
    if (!isLocationsError(e) && !isDistanceError(e)) throw e;
    return fetchInPieces(stops, loop, options, signal, e);
  }
}

/**
 * Percorso panoramico: per ogni tratto tra due tappe si chiedono al server fino a 3 percorsi
 * (Valhalla dà le alternative solo tra due punti), se ne misurano le curve e si tiene il più
 * ricco di curve tra quelli che costano al massimo il 40% di tempo in più del più veloce.
 * Autostrade sempre evitate; sterrato secondo le preferenze.
 */
async function fetchScenic(stops, loop, options, signal) {
  const all = loop && stops.length >= 2 ? [...stops, { ...stops[0], type: 'break' }] : stops;
  const trips = [];
  let considered = 0;
  let extraTime = 0;
  let withAlternatives = 0;
  let costing = 'motorcycle';
  let warning = null;
  for (let i = 1; i < all.length; i++) {
    const pair = [{ ...all[i - 1], type: 'break' }, { ...all[i], type: 'break' }];
    let res;
    try {
      res = await fetchWhole(pair, false, options, signal, false, 2);
    } catch (e) {
      if (!isDistanceError(e)) throw e;
      res = await fetchWhole(pair, false, options, signal, true, 2);
      warning = `Una tratta supera il limite di distanza del profilo moto: è calcolata come per un'auto. Aggiungi una tappa intermedia.`;
    }
    if (res.costing === 'auto') costing = 'auto';
    const cands = [res.trip, ...res.alternates];
    const scored = cands.map((t) => {
      const p = parseTrip(t);
      const c = curvature(p.shape, p.maneuvers.map((m) => m.begin));
      return { time: t.summary.time, degPerKm: c.degPerKm };
    });
    const k = pickScenic(scored);
    considered += cands.length;
    if (cands.length > 1) withAlternatives++;
    extraTime += scored[k].time - Math.min(...scored.map((x) => x.time));
    trips.push(cands[k]);
  }
  return {
    trip: mergeTrips(trips),
    costing,
    warning: warning || (costing === 'auto' ? AUTO_WARNING : null),
    scenic: { segments: all.length - 1, considered, withAlternatives, extraTime },
  };
}

// Quanto il server "misura" in più rispetto alla somma in linea d'aria che calcoliamo noi: si impara dagli
// errori e si ricorda per i giri successivi, ma solo dopo un calcolo riuscito (un fallimento non deve
// peggiorare i giri seguenti).
const learned = { distance: 0.9, locations: 1, meters: 0, locs: 0 };

/** Azzera quanto imparato dal server (per i test). */
export function resetLearnedLimits() {
  Object.assign(learned, { distance: 0.9, locations: 1, meters: 0, locs: 0 });
}

/**
 * Strada "veloce" tra le tappe, come la sceglierebbero Google o Apple: profilo auto,
 * autostrade e pedaggi ammessi. Serve solo per capire dove il giro se ne allontana
 * (link di Google Maps e Apple Mappe). Restituisce la geometria [[lat, lon], ...].
 * Se il server rifiuta il giro intero (troppe tappe o chilometri) lo si calcola a pezzi.
 */
export async function fetchFastShape(stops, loop, signal) {
  const options = { ...DEFAULT_OPTIONS, highways: 1, avoidTolls: false, avoidFerries: false, avoidUnpaved: true, style: 'direct' };
  const pts = stops.map((s) => ({ ...s, type: 'break' }));
  let res;
  try {
    res = await fetchWhole(pts, loop, options, signal, true);
  } catch (e) {
    if (!isLocationsError(e) && !isDistanceError(e)) throw e;
    res = await fetchInPieces(pts, loop, options, signal, e, true);
  }
  return parseTrip(res.trip).shape;
}

/**
 * Giro che il server rifiuta in una sola richiesta (troppe località, errore 150, o troppi chilometri, errore 154):
 * si calcola a pezzi consecutivi e si uniscono i risultati.
 *  - i limiti si leggono dal messaggio del server, con un margine; se un pezzo viene rifiutato lo stesso (il server
 *    misura in modo diverso dal nostro) il pezzo si accorcia e si riprova, fino a trovare la misura giusta;
 *  - i tagli cadono su soste vere, mai su un passaggio o dentro la salita di un passo;
 *  - una tratta che da sola supera il limite del profilo moto si calcola con il profilo auto (con un avviso).
 */
async function fetchInPieces(stops, loop, options, signal, err, autoOnly = false) {
  const all = loop && stops.length >= 2 ? [...stops, { ...stops[0], type: 'break' }] : stops;
  // limiti del server, quando si conoscono (si aggiornano a ogni errore)
  let serverMeters = (isDistanceError(err) && distanceLimit(err)) || learned.meters || Infinity;
  let serverLocs = (isLocationsError(err) && (locationLimit(err) || 20)) || learned.locs || Infinity;
  let dScale = learned.distance;
  let lScale = learned.locations;
  const trips = [];
  let costing = 'motorcycle';
  let usedAuto = false;
  let start = 0;
  let guard = 0;
  let forceAutoAt = -1; // tratta singola rifiutata come moto: si riprova come auto
  while (start < all.length - 1) {
    if (++guard > 400) throw err; // sicurezza contro cicli infiniti: non si dovrebbe mai arrivare qui
    const end = nextChunkEnd(all, start, { maxMeters: serverMeters * dScale, maxLocations: serverLocs * lScale });
    const single = end < 0 || forceAutoAt === start;
    const slice = all.slice(start, (single ? start + 1 : end) + 1);
    try {
      // una tratta oltre il limite del profilo moto va calcolata come auto
      const res = await fetchWhole(slice, false, options, signal, single || autoOnly);
      trips.push(res.trip);
      if (res.costing === 'auto') costing = 'auto';
      if (single && !autoOnly) usedAuto = true;
      start += slice.length - 1;
    } catch (e) {
      if (single) throw e; // una tratta da sola che il server rifiuta anche come auto: errore vero
      if (isDistanceError(e)) {
        if (slice.length <= 2) forceAutoAt = start;
        else if (Number.isFinite(serverMeters)) dScale = Math.max(0.02, dScale * 0.7);
        else serverMeters = distanceLimit(e) || chainMeters(slice) * 0.7; // primo errore di distanza: ora si conosce
      } else if (isLocationsError(e) && slice.length > 2) {
        if (Number.isFinite(serverLocs)) lScale = Math.max(0.1, lScale * 0.6);
        else serverLocs = locationLimit(e) || Math.max(2, Math.floor(slice.length * 0.6));
      } else throw e;
    }
  }
  learned.distance = dScale;
  learned.locations = lScale;
  if (Number.isFinite(serverMeters)) learned.meters = serverMeters;
  if (Number.isFinite(serverLocs)) learned.locs = serverLocs;
  let warning = null;
  if (usedAuto) warning = 'Una tratta supera il limite di distanza del profilo moto del server: è calcolata come per un\'auto. Aggiungi una tappa intermedia per restare sul profilo moto.';
  else if (costing === 'auto') warning = AUTO_WARNING;
  return { trip: mergeTrips(trips), costing, warning };
}

/** Somma in metri delle distanze in linea d'aria tra le tappe consecutive. */
function chainMeters(list) {
  return list.slice(1).reduce((a, s, i) => a + haversine([list[i].lat, list[i].lon], [s.lat, s.lon]), 0);
}

async function fetchWhole(stops, loop, options, signal, forceAuto = false, alternates = 0) {
  const attempt = async (snap) => {
    if (!motorcycleRejected && !forceAuto) {
      try {
        const r = await requestRoute(stops, loop, options, 'motorcycle', snap, signal, alternates);
        return { ...r, costing: 'motorcycle', warning: null };
      } catch (e) {
        if (!isCostingError(e)) throw e;
        motorcycleRejected = true;
      }
    }
    const r = await requestRoute(stops, loop, options, 'auto', snap, signal, alternates);
    return { ...r, costing: 'auto', warning: AUTO_WARNING };
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
    const get = () => fetch(`${NOMINATIM_URL}/${path}?${qs}`, { headers: { Accept: 'application/json' } });
    try {
      res = await get();
      if (res.status >= 500) throw new Error('server');
    } catch {
      // un secondo tentativo (rispettando sempre 1 richiesta al secondo)
      await wait(1100);
      try {
        res = await get();
      } catch {
        throw new Error('Impossibile contattare il servizio di ricerca. Controlla la connessione e riprova.');
      }
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

// ---------------------------------------------------------------------------
// Quote del percorso (Valhalla /height)
// ---------------------------------------------------------------------------

/**
 * Profilo altimetrico del percorso: [[distanza m, quota m], ...] su al massimo 250 punti.
 * Restituisce null se il servizio non risponde (il profilo è un di più, non blocca nulla).
 */
export async function fetchElevation(shape, signal) {
  const pts = resampleShape(shape, 250);
  const req = { encoded_polyline: encodePolyline(pts, 6), shape_format: 'polyline6', range: true };
  try {
    const { res, body } = await getJson(valhallaUrl(HEIGHT_URL, req), signal);
    if (!res.ok || !body || !Array.isArray(body.range_height)) return null;
    return body.range_height.filter((p) => Array.isArray(p) && p[1] != null && p[1] > -1000);
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    return null;
  }
}
