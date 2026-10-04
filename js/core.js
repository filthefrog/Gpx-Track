// Funzioni pure di Tracce Moto: nessun accesso a DOM, rete o storage.
// Usate dal browser (js/app.js) e dai test Node (tests/core.test.mjs).

const EARTH_R = 6371008.8; // raggio medio terrestre in metri
const RAD = Math.PI / 180;

// ---------------------------------------------------------------------------
// Polyline (formato Google/Valhalla, precisione 6)
// ---------------------------------------------------------------------------

/** Decodifica una polyline in un array di [lat, lon]. */
export function decodePolyline(str, precision = 6) {
  const factor = 10 ** precision;
  const out = [];
  let index = 0;
  let lat = 0;
  let lon = 0;
  while (index < str.length) {
    for (let k = 0; k < 2; k++) {
      let result = 0;
      let shift = 0;
      let byte;
      do {
        if (index >= str.length) throw new Error('Polyline troncata');
        byte = str.charCodeAt(index++) - 63;
        result |= (byte & 0x1f) << shift;
        shift += 5;
      } while (byte >= 0x20);
      // l'aritmetica a 32 bit va bene: con precisione 6 i valori stanno in ±180e6 < 2^31
      const delta = result & 1 ? ~(result >>> 1) : result >>> 1;
      if (k === 0) lat += delta;
      else lon += delta;
    }
    out.push([lat / factor, lon / factor]);
  }
  return out;
}

/** Codifica un array di [lat, lon] in polyline. */
export function encodePolyline(points, precision = 6) {
  const factor = 10 ** precision;
  let prevLat = 0;
  let prevLon = 0;
  let out = '';
  const enc = (v) => {
    let n = v < 0 ? ~(v << 1) : v << 1;
    let s = '';
    while (n >= 0x20) {
      s += String.fromCharCode((0x20 | (n & 0x1f)) + 63);
      n >>>= 5;
    }
    return s + String.fromCharCode(n + 63);
  };
  for (const [la, lo] of points) {
    const lat = Math.round(la * factor);
    const lon = Math.round(lo * factor);
    out += enc(lat - prevLat) + enc(lon - prevLon);
    prevLat = lat;
    prevLon = lon;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Geometria
// ---------------------------------------------------------------------------

/** Distanza in metri tra due punti [lat, lon] (haversine). */
export function haversine(a, b) {
  const dLat = (b[0] - a[0]) * RAD;
  const dLon = (b[1] - a[1]) * RAD;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a[0] * RAD) * Math.cos(b[0] * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Proietta [lat, lon] su un piano metrico locale centrato in lat0 (equirettangolare). */
function project(p, lat0) {
  return [p[1] * RAD * EARTH_R * Math.cos(lat0 * RAD), p[0] * RAD * EARTH_R];
}

/** Distanza in metri del punto p dal segmento a-b (proiezione locale). */
export function pointSegmentDistance(p, a, b) {
  const lat0 = (a[0] + b[0]) / 2;
  const [px, py] = project(p, lat0);
  const [ax, ay] = project(a, lat0);
  const [bx, by] = project(b, lat0);
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Distanza minima in metri del punto p da una polilinea. */
export function distanceToLine(p, line) {
  if (line.length === 1) return haversine(p, line[0]);
  let best = Infinity;
  for (let i = 1; i < line.length; i++) {
    const d = pointSegmentDistance(p, line[i - 1], line[i]);
    if (d < best) best = d;
  }
  return best;
}

/** Distanze cumulative in metri lungo la polilinea. */
export function cumulativeDistances(line) {
  const cum = new Array(line.length);
  cum[0] = 0;
  for (let i = 1; i < line.length; i++) cum[i] = cum[i - 1] + haversine(line[i - 1], line[i]);
  return cum;
}

/**
 * Punto a `dist` metri lungo la polilinea partendo dall'indice `fromIndex`.
 * Restituisce [lat, lon], interpolato sul segmento giusto.
 */
export function pointAlong(line, fromIndex, dist, cum = cumulativeDistances(line)) {
  const target = cum[fromIndex] + dist;
  for (let i = fromIndex + 1; i < line.length; i++) {
    if (cum[i] >= target) {
      const seg = cum[i] - cum[i - 1];
      const t = seg === 0 ? 0 : (target - cum[i - 1]) / seg;
      const a = line[i - 1];
      const b = line[i];
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    }
  }
  return line[line.length - 1].slice();
}

/**
 * Semplificazione Ramer-Douglas-Peucker con tolleranza in metri.
 * `keep` è un insieme di indici che devono restare (incroci delle manovre, tappe):
 * la linea viene semplificata a tratti tra un indice obbligato e l'altro, così
 * passa sempre esattamente dai nodi degli incroci e non "taglia" le svolte.
 * Ogni punto originale resta entro `tolerance` metri dalla linea semplificata.
 */
export function simplifyRDP(points, tolerance = 4, keep = []) {
  const n = points.length;
  if (n <= 2) return points.slice();
  const marked = new Uint8Array(n);
  marked[0] = 1;
  marked[n - 1] = 1;
  for (const k of keep) if (k >= 0 && k < n) marked[k] = 1;

  const anchors = [];
  for (let i = 0; i < n; i++) if (marked[i]) anchors.push(i);

  // RDP iterativo (niente ricorsione: le tracce lunghe hanno decine di migliaia di punti)
  for (let a = 1; a < anchors.length; a++) {
    const stack = [[anchors[a - 1], anchors[a]]];
    while (stack.length) {
      const [first, last] = stack.pop();
      let maxD = -1;
      let idx = -1;
      for (let i = first + 1; i < last; i++) {
        const d = pointSegmentDistance(points[i], points[first], points[last]);
        if (d > maxD) {
          maxD = d;
          idx = i;
        }
      }
      if (idx !== -1 && maxD > tolerance) {
        marked[idx] = 1;
        stack.push([first, idx], [idx, last]);
      }
    }
  }
  const out = [];
  for (let i = 0; i < n; i++) if (marked[i]) out.push(points[i]);
  return out;
}

// ---------------------------------------------------------------------------
// Tappe
// ---------------------------------------------------------------------------

/**
 * Indice in cui inserire `point` come tappa intermedia in modo che il giro
 * si allunghi il meno possibile (stima in linea d'aria).
 * `stops` è un array di [lat, lon]. Con `loop` il giro torna alla partenza,
 * quindi si può inserire anche tra l'ultima tappa e il ritorno.
 * Restituisce un indice adatto a `stops.splice(index, 0, nuovo)`.
 */
export function bestInsertionIndex(stops, point, loop = false) {
  const n = stops.length;
  if (n < 2) return n;
  let best = 1;
  let bestCost = Infinity;
  const lastGap = loop ? n : n - 1;
  for (let i = 1; i <= lastGap; i++) {
    const a = stops[i - 1];
    const b = i < n ? stops[i] : stops[0];
    const cost = haversine(a, point) + haversine(point, b) - haversine(a, b);
    if (cost < bestCost - 1e-9) {
      bestCost = cost;
      best = i;
    }
  }
  return best;
}

/** Indice del punto della geometria più vicino a p. */
export function nearestShapeIndex(shape, p) {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < shape.length; i++) {
    const d = haversine(p, shape[i]);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/**
 * Indice della geometria in cui il percorso passa da ogni tappa (cercando sempre in avanti:
 * in un anello la partenza e l'arrivo coincidono ma stanno ai due estremi).
 */
export function stopShapeIndices(shape, stops) {
  const out = [];
  let from = 0;
  stops.forEach((s, i) => {
    if (i === 0) {
      out.push(0);
      return;
    }
    let best = from;
    let bestD = Infinity;
    for (let k = from; k < shape.length; k++) {
      const d = haversine([s.lat, s.lon], shape[k]);
      if (d < bestD) {
        bestD = d;
        best = k;
      }
    }
    out.push(best);
    from = best;
  });
  return out;
}

/**
 * Dove inserire un nuovo passaggio toccato sul percorso al punto `k` della geometria:
 * restituisce l'indice per `stops.splice(i, 0, nuovo)` (subito dopo l'ultima tappa già superata).
 */
export function routeInsertIndex(shape, stops, k) {
  const idx = stopShapeIndices(shape, stops);
  for (let i = 1; i < stops.length; i++) if (idx[i] >= k) return i;
  return stops.length; // dopo l'ultima tappa (in un anello: prima del ritorno alla partenza)
}

// Paesi e passi trovati con la ricerca vanno agganciati a una strada vera:
// senza filtro Valhalla può partire da un vialetto o da una carrareccia vicina al centro.
const ROAD_FILTER = { min_road_class: 'residential' };

/**
 * Elenco delle location per Valhalla (con ritorno alla partenza se richiesto).
 * Con `snap` le tappe che hanno `snap: true` escludono strade di servizio e sentieri.
 */
export function routeLocations(stops, loop = false, { snap = false } = {}) {
  const loc = (s, type) => ({
    lat: round6(s.lat),
    lon: round6(s.lon),
    type,
    ...(snap && s.snap ? { search_filter: { ...ROAD_FILTER } } : {}),
  });
  // partenza e arrivo devono essere "break"; gli intermedi seguono la scelta dell'utente
  const list = stops.map((s, i) =>
    loc(s, i === 0 || (i === stops.length - 1 && !loop) ? 'break' : s.type === 'through' ? 'through' : 'break'),
  );
  if (loop && stops.length >= 2) list.push(loc(stops[0], 'break'));
  return list;
}

// ---------------------------------------------------------------------------
// Valhalla
// ---------------------------------------------------------------------------

export const DEFAULT_OPTIONS = Object.freeze({
  highways: 1, // 0 Evita, 0.5 Se serve, 1 Normale
  avoidTolls: false,
  avoidFerries: false,
  avoidUnpaved: true,
  shortest: false,
});

/** Corpo della richiesta /route per Valhalla. */
export function buildValhallaRequest(stops, loop, options = DEFAULT_OPTIONS, costing = 'motorcycle', { snap = true } = {}) {
  const o = { ...DEFAULT_OPTIONS, ...options };
  const common = {
    use_highways: o.highways,
    use_tolls: o.avoidTolls ? 0 : 0.5,
    use_ferry: o.avoidFerries ? 0 : 0.5,
    shortest: !!o.shortest,
  };
  const costingOptions =
    costing === 'motorcycle'
      ? { ...common, use_trails: o.avoidUnpaved ? 0 : 0.5 }
      : { ...common, ...(o.avoidUnpaved ? { exclude_unpaved: true } : {}) };
  return {
    locations: routeLocations(stops, loop, { snap }),
    costing,
    costing_options: { [costing]: costingOptions },
    directions_options: { units: 'kilometers', language: 'it-IT' },
  };
}

/** URL GET con il JSON nel parametro ?json= (evita il preflight CORS). */
export function valhallaUrl(base, request) {
  return `${base}?json=${encodeURIComponent(JSON.stringify(request))}`;
}

/** Vero se il giro supera la distanza massima del server per quel profilo (errore 154). */
export function isDistanceError(err) {
  return !!err && err.error_code === 154;
}

/** Distanza massima in metri letta dal messaggio di Valhalla ("... limit: 500000 meters"), o null. */
export function distanceLimit(err) {
  const m = String((err && err.error) || '').match(/limit:?\s*([\d.]+)\s*met/i);
  return m ? Number(m[1]) : null;
}

/**
 * Divide le tappe in pezzi consecutivi che stanno sotto il limite di distanza del server
 * (Valhalla somma le distanze in linea d'aria tra le tappe). I pezzi condividono la tappa
 * di confine. Restituisce [[inizio, fine], ...] (indici inclusi) oppure null se una
 * singola tratta da sola supera il limite.
 */
export function splitForDistance(stops, maxMeters) {
  const pts = stops.map((s) => [s.lat, s.lon]);
  const chunks = [];
  let start = 0;
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const hop = haversine(pts[i - 1], pts[i]);
    if (hop > maxMeters) return null;
    if (acc + hop > maxMeters) {
      chunks.push([start, i - 1]);
      start = i - 1;
      acc = 0;
    }
    acc += hop;
  }
  chunks.push([start, pts.length - 1]);
  return chunks;
}

/** Unisce i viaggi calcolati a pezzi in un unico viaggio Valhalla. */
export function mergeTrips(trips) {
  return {
    legs: trips.flatMap((t) => t.legs),
    summary: {
      length: trips.reduce((a, t) => a + t.summary.length, 0),
      time: trips.reduce((a, t) => a + t.summary.time, 0),
    },
  };
}

/** Vero se Valhalla non trova una strada vicino a una tappa (si può riprovare senza filtro). */
export function isSnapError(err) {
  return !!err && (err.error_code === 170 || err.error_code === 171);
}

/** Vero se l'errore Valhalla indica che il costing richiesto non è disponibile. */
export function isCostingError(err) {
  if (!err) return false;
  const code = err.error_code;
  const msg = String(err.error || err.message || '').toLowerCase();
  return code === 124 || code === 125 || code === 126 || /costing/.test(msg);
}

/**
 * Traduce un errore Valhalla in un messaggio italiano che dice cosa è
 * andato storto e cosa fare. `stops` serve a nominare le tappe.
 */
export function explainValhallaError(err, stops = []) {
  const msg = explainValhallaMessage(err, stops);
  // il dettaglio tecnico aiuta a capire cosa è successo quando si chiede aiuto
  const code = err && (err.error_code || err.status);
  // per gli errori interni (non del server) si mostra il messaggio JavaScript
  const raw = String((err && (err.error || (!err.network && !err.timeout && !code ? err.message : ''))) || '');
  return code || raw ? `${msg} (Dettaglio: ${[code ? `codice ${code}` : '', raw].filter(Boolean).join(' – ')})` : msg;
}

function explainValhallaMessage(err, stops = []) {
  const code = err && err.error_code;
  const raw = String((err && (err.error || err.message)) || '');
  const hasThrough = stops.some((s, i) => i > 0 && i < stops.length - 1 && s.type === 'through');
  const throughNames = stops
    .map((s, i) => ({ s, i }))
    .filter(({ s, i }) => i > 0 && i < stops.length - 1 && s.type === 'through')
    .map(({ s, i }) => `${i + 1}. ${s.name}`)
    .join(', ');
  switch (code) {
    case 171:
    case 170:
      return 'Una tappa è troppo lontana da una strada percorribile. Trascina il marker sulla strada più vicina oppure cerca un indirizzo più preciso.';
    case 442:
    case 443:
      return hasThrough
        ? `Nessun percorso trovato. Un punto di passaggio potrebbe essere irraggiungibile senza inversione o su una strada esclusa (${throughNames}). Spostalo su una strada principale o trasformalo in "sosta".`
        : 'Nessun percorso trovato tra le tappe. Controlla che non siano su isole o su strade escluse dalle preferenze (sterrato, traghetti, autostrade) e prova ad allentare le preferenze.';
    case 154:
    case 150:
      return 'Il giro è troppo lungo o ha troppe tappe per il server gratuito. Dividilo in due giri più corti.';
    case 157:
      return 'Le preferenze escludono tutte le strade possibili. Prova ad allentarle (per esempio autostrade "Se serve" o sterrato consentito).';
    default:
      break;
  }
  if (err && err.timeout)
    return 'Il server dei percorsi non ha risposto entro un minuto (probabilmente è sovraccarico). Riprova tra poco; se il giro è molto lungo dividilo in due.';
  if (err && err.status === 429)
    return 'Il server dei percorsi ha ricevuto troppe richieste. Aspetta qualche secondo e riprova.';
  if (err && err.network)
    return 'Impossibile contattare il server dei percorsi. Controlla la connessione e riprova.';
  return 'Il calcolo del percorso non è riuscito. Riprova tra poco o modifica le tappe.';
}

// Tipi di manovra Valhalla
export const MANEUVER = Object.freeze({
  NONE: 0,
  START: 1,
  START_RIGHT: 2,
  START_LEFT: 3,
  DESTINATION: 4,
  DESTINATION_RIGHT: 5,
  DESTINATION_LEFT: 6,
  BECOMES: 7,
  CONTINUE: 8,
  STAY_STRAIGHT: 22,
  ROUNDABOUT_ENTER: 26,
  ROUNDABOUT_EXIT: 27,
  FERRY_ENTER: 28,
  FERRY_EXIT: 29,
});

const SKIPPED_MANEUVERS = new Set([
  MANEUVER.NONE,
  MANEUVER.START,
  MANEUVER.START_RIGHT,
  MANEUVER.START_LEFT,
  MANEUVER.DESTINATION,
  MANEUVER.DESTINATION_RIGHT,
  MANEUVER.DESTINATION_LEFT,
  MANEUVER.BECOMES, // cambio nome della strada
  MANEUVER.CONTINUE,
  MANEUVER.STAY_STRAIGHT,
  MANEUVER.ROUNDABOUT_ENTER, // si usa l'uscita
  MANEUVER.FERRY_ENTER, // il punto finirebbe in mare
]);

/** Vero se la manovra merita un punto di passaggio nella rotta. */
export function isSignificantManeuver(m) {
  if (SKIPPED_MANEUVERS.has(m.type)) return false;
  if (m.type >= 30 && m.type <= 36) return false; // trasporto pubblico
  if (m.type >= 39) return false; // ascensori, scale, edifici
  return true;
}

/**
 * Unisce le tratte della risposta Valhalla in un'unica geometria.
 * Restituisce { shape, legs, maneuvers, summary } con indici riferiti a `shape`.
 */
export function parseTrip(trip) {
  const shape = [];
  const legs = [];
  const maneuvers = [];
  let kmOffset = 0;
  for (const leg of trip.legs) {
    const pts = decodePolyline(leg.shape, 6);
    // l'ultimo punto di una tratta coincide con il primo della successiva
    const offset = shape.length === 0 ? 0 : shape.length - 1;
    shape.push(...(shape.length === 0 ? pts : pts.slice(1)));
    let km = kmOffset;
    for (const m of leg.maneuvers || []) {
      maneuvers.push({
        type: m.type,
        instruction: m.instruction,
        streetNames: m.street_names || m.begin_street_names || [],
        exitCount: m.roundabout_exit_count || 0,
        toward: signToward(m.sign),
        length: m.length, // km
        time: m.time, // s
        km, // km progressivi all'inizio della manovra
        begin: m.begin_shape_index + offset,
        end: m.end_shape_index + offset,
        leg: legs.length,
      });
      km += m.length || 0;
    }
    legs.push({
      length: leg.summary.length,
      time: leg.summary.time,
      startIndex: offset,
      endIndex: offset + pts.length - 1,
    });
    kmOffset += leg.summary.length;
  }
  return {
    shape,
    legs,
    maneuvers,
    summary: { length: trip.summary.length, time: trip.summary.time },
  };
}

/** Indicazioni del cartello stradale ("verso Bormio"), se Valhalla le fornisce. */
function signToward(sign) {
  if (!sign) return '';
  const list = [...(sign.exit_toward_elements || []), ...(sign.exit_branch_elements || [])].map((e) => e.text);
  return [...new Set(list)].slice(0, 2).join(' / ');
}

const MANEUVER_VERB = {
  1: 'Parti',
  2: 'Parti',
  3: 'Parti',
  4: 'Arrivo',
  5: 'Arrivo',
  6: 'Arrivo',
  7: 'Prosegui',
  8: 'Prosegui',
  9: 'Leggermente a destra',
  10: 'Destra',
  11: 'Tutto a destra',
  12: 'Inversione a U',
  13: 'Inversione a U',
  14: 'Tutto a sinistra',
  15: 'Sinistra',
  16: 'Leggermente a sinistra',
  17: 'Rampa dritto',
  18: 'Rampa a destra',
  19: 'Rampa a sinistra',
  20: 'Uscita a destra',
  21: 'Uscita a sinistra',
  22: 'Dritto',
  23: 'Tieni la destra',
  24: 'Tieni la sinistra',
  25: 'Immettiti',
  26: 'Rotonda',
  27: 'Esci dalla rotonda',
  28: 'Traghetto',
  29: 'Sbarca',
  37: 'Immettiti a destra',
  38: 'Immettiti a sinistra',
};

/**
 * Etichetta breve e leggibile di una manovra: "Destra su SP1",
 * "Rotonda, 2ª uscita su SS38", "Tieni la sinistra verso Bormio".
 */
export function maneuverLabel(m) {
  let verb = MANEUVER_VERB[m.type] || 'Prosegui';
  if (m.type === 26 && m.exitCount) verb = `Rotonda, ${m.exitCount}ª uscita`;
  const street = m.streetNames && m.streetNames[0];
  let label = verb;
  if (street) label += ` su ${street}`;
  else if (m.toward) label += ` verso ${m.toward}`;
  return label.length > 40 ? `${label.slice(0, 39)}…` : label;
}

/** Manovre da segnalare come svolte nella traccia (incluso l'ingresso in rotonda con l'uscita). */
export function turnManeuvers(parsed) {
  const skip = new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 22, 27]);
  return parsed.maneuvers.filter((m) => !skip.has(m.type) && !(m.type >= 30 && m.type <= 36) && m.type < 39);
}

function kmLabel(km) {
  return `${km.toFixed(1).replace('.', ',')} km`;
}

/** Testo completo della manovra con i dati utili per chi guida. */
export function maneuverDetail(m) {
  const parts = [m.instruction || maneuverLabel(m)];
  if (m.toward && !String(m.instruction).includes(m.toward)) parts.push(`Direzione ${m.toward}.`);
  parts.push(`A ${kmLabel(m.km)} dalla partenza.`);
  if (m.length > 0) parts.push(`Poi prosegui per ${kmLabel(m.length)} (${formatDuration(m.time)}).`);
  return parts.join(' ');
}

/**
 * Indici di shape da conservare nella semplificazione:
 * inizio di ogni manovra (incroci) e confini delle tratte.
 */
export function keyIndices(parsed) {
  const set = new Set();
  for (const m of parsed.maneuvers) set.add(m.begin);
  for (const l of parsed.legs) {
    set.add(l.startIndex);
    set.add(l.endIndex);
  }
  return [...set].sort((a, b) => a - b);
}

export const ROUTE_POINT = Object.freeze({
  TARGET: 135, // metri dopo la manovra
  MIN_AFTER: 120,
  MAX_AFTER: 150,
  MARGIN_BEFORE_NEXT: 30, // distanza minima dal prossimo incrocio
  MIN_SHORT_SEGMENT: 80, // sotto questa lunghezza la strada è troppo corta: niente punto
  MIN_SPACING: 50, // scarta punti più vicini di così al precedente
});

/**
 * Punti di passaggio della rotta: uno poco dopo ogni manovra significativa,
 * già sulla nuova strada e lontano dal prossimo incrocio.
 * Restituisce [{ lat, lon, name, desc, maneuverIndex, pos }].
 */
export function routeShapingPoints(parsed) {
  const { shape, maneuvers } = parsed;
  const cum = cumulativeDistances(shape);
  const out = [];
  maneuvers.forEach((m, idx) => {
    if (!isSignificantManeuver(m)) return;
    if (m.end <= m.begin) return;
    const segLen = cum[m.end] - cum[m.begin];
    let dist;
    if (segLen >= ROUTE_POINT.TARGET + ROUTE_POINT.MARGIN_BEFORE_NEXT) dist = ROUTE_POINT.TARGET;
    else if (segLen >= ROUTE_POINT.MIN_SHORT_SEGMENT) dist = segLen / 2;
    else return; // strada troppo corta: ci pensa il punto della manovra successiva
    const [lat, lon] = pointAlong(shape, m.begin, dist, cum);
    // all'uscita di una rotonda serve sapere quale uscita prendere: è nella manovra d'ingresso
    const prev = maneuvers[idx - 1];
    const label =
      m.type === MANEUVER.ROUNDABOUT_EXIT && prev && prev.type === MANEUVER.ROUNDABOUT_ENTER
        ? maneuverLabel({ ...prev, streetNames: m.streetNames.length ? m.streetNames : prev.streetNames })
        : maneuverLabel(m);
    out.push({
      lat,
      lon,
      name: `${kmLabel(m.km)} ${label}`,
      desc: maneuverDetail(m),
      cmt: m.instruction || '',
      maneuverIndex: idx,
      pos: cum[m.begin] + dist, // metri dall'inizio del percorso
    });
  });
  return out;
}

/**
 * Sequenza completa della rotta: tappe + punti di passaggio, in ordine,
 * senza punti a meno di 50 m dal precedente (le tappe hanno la precedenza).
 * `stops` sono le tappe dell'utente; con `loop` si aggiunge il ritorno.
 */
export function buildRoutePoints(parsed, stops, loop = false) {
  const { shape } = parsed;
  const shaping = routeShapingPoints(parsed);
  const cum = cumulativeDistances(shape);

  // posizione lungo il percorso di ogni tappa: la proiezione più vicina, cercata in avanti
  const allStops = stops.map((s, i) => ({ ...s, kind: 'stop', number: i + 1 }));
  if (loop && stops.length >= 2) allStops.push({ ...stops[0], name: `${stops[0].name} (ritorno)`, kind: 'stop', number: 1, type: 'break' });

  const stopPos = [];
  let from = 0;
  for (let i = 0; i < allStops.length; i++) {
    if (i === 0) {
      stopPos.push(0);
      continue;
    }
    if (i === allStops.length - 1) {
      stopPos.push(cum[cum.length - 1]);
      continue;
    }
    const p = [allStops[i].lat, allStops[i].lon];
    let bestI = from;
    let bestD = Infinity;
    for (let k = from; k < shape.length; k++) {
      const d = haversine(p, shape[k]);
      if (d < bestD) {
        bestD = d;
        bestI = k;
      }
    }
    stopPos.push(cum[bestI]);
    from = bestI;
  }

  const items = [
    ...allStops.map((s, i) => ({ ...s, pos: stopPos[i], order: 1 })),
    ...shaping.map((p) => ({ ...p, kind: 'shaping', order: 0 })),
  ];
  // stabile: a parità di posizione la tappa viene dopo
  items.sort((a, b) => a.pos - b.pos || a.order - b.order);

  const out = [];
  for (const it of items) {
    const prev = out[out.length - 1];
    if (prev) {
      const close = haversine([prev.lat, prev.lon], [it.lat, it.lon]) < ROUTE_POINT.MIN_SPACING;
      if (close && it.kind === 'shaping') continue;
      if (close && it.kind === 'stop' && prev.kind === 'shaping') out.pop();
    }
    out.push(it);
  }
  return out;
}

// ---------------------------------------------------------------------------
// GPX 1.1
// ---------------------------------------------------------------------------

export function escapeXml(s) {
  return String(s ?? '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

const coord = (v) => (Math.round(v * 1e6) / 1e6).toFixed(6);

const TRP_NS = 'http://www.garmin.com/xmlschemas/TripExtensions/v1';

const OSMAND_NS = 'https://osmand.net';

function gpxHeader(name, time, desc, garmin = false, osmand = false) {
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    // OsmAnd legge le indicazioni di un <rte> solo se il file dichiara di venire dal suo router
    `<gpx version="1.1" creator="${osmand ? 'OsmAndRouter' : 'Tracce Moto'}" xmlns="http://www.topografix.com/GPX/1/1" ` +
    (garmin ? `xmlns:trp="${TRP_NS}" ` : '') +
    (osmand ? `xmlns:osmand="${OSMAND_NS}" ` : '') +
    'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ' +
    'xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">\n' +
    '  <metadata>\n' +
    `    <name>${escapeXml(name)}</name>\n` +
    (desc ? `    <desc>${escapeXml(desc)}</desc>\n` : '') +
    `    <time>${time}</time>\n` +
    '  </metadata>\n'
  );
}

function tripDescription(parsed, stops) {
  const names = stops.map((s) => String(s.name).split(',')[0]).join(' → ');
  return `${names ? `${names} · ` : ''}${formatKm(parsed.summary.length)} · ${formatDuration(parsed.summary.time)}`;
}

function stopTypeLabel(stops, i, loop) {
  if (i === 0) return 'Partenza';
  if (i === stops.length - 1 && !loop) return 'Arrivo';
  return stops[i].type === 'through' ? 'Passaggio' : 'Sosta';
}

/**
 * GPX "Traccia": un <wpt> per tappa e un <trk> con la geometria semplificata.
 * `parsed` è il risultato di parseTrip.
 */
export function buildTrackGpx({ name, stops, loop = false, parsed, tolerance = 4, time = new Date(), turns = true }) {
  const iso = toIsoSeconds(time);
  const simplified = simplifyRDP(parsed.shape, tolerance, keyIndices(parsed));
  const desc = tripDescription(parsed, stops);
  let x = gpxHeader(name, iso, desc);
  stops.forEach((s, i) => {
    x +=
      `  <wpt lat="${coord(s.lat)}" lon="${coord(s.lon)}">\n` +
      `    <name>${escapeXml(s.name)}</name>\n` +
      `    <sym>${i === 0 ? 'Flag, Green' : i === stops.length - 1 && !loop ? 'Flag, Red' : 'Flag, Blue'}</sym>\n` +
      `    <type>${stopTypeLabel(stops, i, loop)}</type>\n` +
      '  </wpt>\n';
  });
  // una svolta = un wpt sull'incrocio, con nome breve e istruzione completa:
  // le app e i navigatori che mostrano i waypoint della traccia li annunciano in avvicinamento
  if (turns) {
    for (const m of turnManeuvers(parsed)) {
      const [la, lo] = parsed.shape[m.begin];
      x +=
        `  <wpt lat="${coord(la)}" lon="${coord(lo)}">\n` +
        `    <name>${escapeXml(`${kmLabel(m.km)} ${maneuverLabel(m)}`)}</name>\n` +
        `    <cmt>${escapeXml(m.instruction || '')}</cmt>\n` +
        `    <desc>${escapeXml(maneuverDetail(m))}</desc>\n` +
        '    <sym>Navaid, White</sym>\n' +
        '    <type>Svolta</type>\n' +
        '  </wpt>\n';
    }
  }
  x += `  <trk>\n    <name>${escapeXml(name)}</name>\n    <desc>${escapeXml(desc)}</desc>\n    <trkseg>\n`;
  for (const [la, lo] of simplified) x += `      <trkpt lat="${coord(la)}" lon="${coord(lo)}"/>\n`;
  x += '    </trkseg>\n  </trk>\n</gpx>\n';
  return x;
}

/**
 * GPX "Rotta": un <rte> con le tappe e i punti di passaggio dopo le manovre.
 * Le estensioni Garmin (ignorate dagli altri programmi) dicono ai navigatori
 * Garmin/BMW quali punti sono destinazioni (ViaPoint) e quali solo punti di
 * forma (ShapingPoint), così non annunciano l'arrivo a ogni svolta.
 * Restituisce { xml, count, stops, shaping }.
 */
export function buildRouteGpx({ name, stops, loop = false, parsed, time = new Date() }) {
  const iso = toIsoSeconds(time);
  const points = buildRoutePoints(parsed, stops, loop);
  const desc = tripDescription(parsed, stops);
  let x = gpxHeader(name, iso, desc, true);
  x += `  <rte>\n    <name>${escapeXml(name)}</name>\n`;
  for (const p of points) {
    if (p.kind === 'stop') {
      const idx = p.number - 1;
      const isReturn = loop && p === points[points.length - 1];
      const label = isReturn ? 'Arrivo' : stopTypeLabel(stops, idx, loop);
      x +=
        `    <rtept lat="${coord(p.lat)}" lon="${coord(p.lon)}">\n` +
        `      <name>${escapeXml(p.name)}</name>\n` +
        `      <sym>Flag</sym>\n` +
        `      <type>${label}</type>\n` +
        `      <extensions><trp:${label === 'Passaggio' ? 'ShapingPoint' : 'ViaPoint'}/></extensions>\n` +
        '    </rtept>\n';
    } else {
      x +=
        `    <rtept lat="${coord(p.lat)}" lon="${coord(p.lon)}">\n` +
        `      <name>${escapeXml(p.name)}</name>\n` +
        `      <cmt>${escapeXml(p.cmt)}</cmt>\n` +
        `      <desc>${escapeXml(p.desc)}</desc>\n` +
        '      <sym>Waypoint</sym>\n' +
        '      <type>Punto di passaggio</type>\n' +
        '      <extensions><trp:ShapingPoint/></extensions>\n' +
        '    </rtept>\n';
    }
  }
  x += '  </rte>\n</gpx>\n';
  const stopCount = points.filter((p) => p.kind === 'stop').length;
  return { xml: x, count: points.length, stops: stopCount, shaping: points.length - stopCount };
}

// Codici di svolta OsmAnd (TurnType): C dritto, TL/TR sinistra/destra, TSLL/TSLR leggermente,
// TSHL/TSHR stretta, KL/KR tieni, TU/TRU inversione, RNDB<n> rotonda con uscita n.
const OSMAND_TURN = {
  8: 'C',
  9: 'TSLR',
  10: 'TR',
  11: 'TSHR',
  12: 'TRU',
  13: 'TU',
  14: 'TSHL',
  15: 'TL',
  16: 'TSLL',
  17: 'C',
  18: 'KR',
  19: 'KL',
  20: 'KR',
  21: 'KL',
  22: 'C',
  23: 'KR',
  24: 'KL',
  25: 'C',
  37: 'KR',
  38: 'KL',
};

export function osmandTurn(m) {
  if (m.type === MANEUVER.ROUNDABOUT_ENTER) return `RNDB${m.exitCount || 1}`;
  return OSMAND_TURN[m.type] || '';
}

/**
 * Istruzioni turn by turn: una per manovra, con il tempo fino alla successiva.
 * Si fondono con la precedente: il cambio nome della strada, l'uscita dalla rotonda
 * (già detta all'ingresso) e gli arrivi intermedi (la tratta dopo riparte dallo stesso punto).
 */
export function turnByTurnInstructions(parsed) {
  const out = [];
  const last = parsed.maneuvers.length - 1;
  parsed.maneuvers.forEach((m, i) => {
    const intermediateArrival = m.type >= 4 && m.type <= 6 && i !== last;
    const merge = m.type === MANEUVER.BECOMES || m.type === MANEUVER.ROUNDABOUT_EXIT || intermediateArrival;
    if (merge && out.length) {
      const prev = out[out.length - 1];
      prev.time += m.time || 0;
      prev.length += m.length || 0;
      if (m.type === MANEUVER.ROUNDABOUT_EXIT && !prev.streetNames.length) prev.streetNames = m.streetNames;
      return;
    }
    out.push({ ...m, time: m.time || 0, length: m.length || 0, streetNames: [...m.streetNames] });
  });
  return out;
}

/**
 * GPX "turn by turn" in un solo file, per app come OsmAnd:
 *  - <wpt> per ogni tappa;
 *  - <rte> con un punto per ogni manovra, sull'incrocio: nome breve, istruzione completa
 *    e le estensioni OsmAnd (offset nella traccia, codice di svolta, secondi fino alla prossima);
 *  - <trk> con la geometria strada per strada (semplificata a 4 m, incroci esatti).
 * Le app che non conoscono le estensioni mostrano comunque nomi e descrizioni dei punti.
 */
export function buildTurnByTurnGpx({ name, stops, loop = false, parsed, tolerance = 4, time = new Date() }) {
  const iso = toIsoSeconds(time);
  const simplified = simplifyRDP(parsed.shape, tolerance, keyIndices(parsed));
  const indexOf = new Map(simplified.map((p, i) => [p, i]));
  const desc = tripDescription(parsed, stops);
  const steps = turnByTurnInstructions(parsed);
  let x = gpxHeader(name, iso, desc, false, true);
  stops.forEach((s, i) => {
    x +=
      `  <wpt lat="${coord(s.lat)}" lon="${coord(s.lon)}">\n` +
      `    <name>${escapeXml(`${i + 1}. ${s.name}`)}</name>\n` +
      `    <type>${stopTypeLabel(stops, i, loop)}</type>\n` +
      '  </wpt>\n';
  });
  x += `  <rte>\n    <name>${escapeXml(name)}</name>\n    <desc>${escapeXml(desc)}</desc>\n`;
  // le tratte iniziano e finiscono sulle tappe "sosta" (i passaggi non spezzano il percorso)
  const locNames = routeLocations(stops, loop).map((_, i) => (i < stops.length ? `${i + 1}. ${stops[i].name}` : `1. ${stops[0].name}`));
  const breakNames = routeLocations(stops, loop)
    .map((l, i) => (l.type === 'break' ? locNames[i] : null))
    .filter((n) => n !== null);
  for (const m of steps) {
    const [la, lo] = parsed.shape[m.begin];
    const turn = osmandTurn(m);
    let label = maneuverLabel(m);
    if (m.type >= 1 && m.type <= 3 && m.leg > 0) label = `Riparti da ${shortPlace(breakNames[m.leg] || '')}${label.replace(/^Parti/, '')}`;
    if (m.type >= 4 && m.type <= 6) label = `Arrivo a ${shortPlace(breakNames[m.leg + 1] || breakNames[breakNames.length - 1] || '')}`;
    x +=
      `    <rtept lat="${coord(la)}" lon="${coord(lo)}">\n` +
      `      <name>${escapeXml(`${kmLabel(m.km)} ${label}`.replace(/: $/, ''))}</name>\n` +
      `      <cmt>${escapeXml(m.instruction || '')}</cmt>\n` +
      `      <desc>${escapeXml(maneuverDetail(m))}</desc>\n` +
      '      <extensions>\n' +
      `        <osmand:time>${Math.round(m.time)}</osmand:time>\n` +
      `        <osmand:offset>${indexOf.get(parsed.shape[m.begin])}</osmand:offset>\n` +
      (turn ? `        <osmand:turn>${turn}</osmand:turn>\n` : '') +
      '      </extensions>\n' +
      '    </rtept>\n';
  }
  x += '  </rte>\n';
  x += `  <trk>\n    <name>${escapeXml(name)}</name>\n    <desc>${escapeXml(desc)}</desc>\n    <trkseg>\n`;
  for (const [la, lo] of simplified) x += `      <trkpt lat="${coord(la)}" lon="${coord(lo)}"/>\n`;
  x += '    </trkseg>\n  </trk>\n</gpx>\n';
  return { xml: x, instructions: steps.length, points: simplified.length };
}

// ---------------------------------------------------------------------------
// Roadbook e formattazione
// ---------------------------------------------------------------------------

export function formatKm(km) {
  if (km == null || Number.isNaN(km)) return '–';
  // formattazione manuale: Intl in italiano non separa le migliaia sotto 10.000
  const [int, dec] = (Math.round(km * 10) / 10).toFixed(1).split('.');
  return `${int.replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${dec} km`;
}

export function formatDuration(seconds) {
  if (seconds == null || Number.isNaN(seconds)) return '–';
  if (seconds > 0 && seconds < 30) return 'meno di 1 min';
  const totalMin = Math.round(seconds / 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m} min`;
  return `${h} h ${String(m).padStart(2, '0')} min`;
}

/** Righe del roadbook: [{ km, text, type }]. */
export function roadbookRows(parsed) {
  return parsed.maneuvers.map((m) => ({ km: m.km, text: m.instruction, type: m.type, length: m.length }));
}

/** Testo del roadbook da copiare. */
export function roadbookText(name, parsed, stops = []) {
  const lines = [name, `${formatKm(parsed.summary.length)} · ${formatDuration(parsed.summary.time)}`];
  if (stops.length) lines.push(`Tappe: ${stops.map((s) => s.name).join(' → ')}`);
  lines.push('');
  for (const r of roadbookRows(parsed)) {
    const next = r.length > 0 ? `  (poi ${kmLabel(r.length)})` : '';
    lines.push(`${r.km.toFixed(1).replace('.', ',').padStart(7)} km  ${r.text}${next}`);
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Stato, link condivisibili e nomi file
// ---------------------------------------------------------------------------

function round6(v) {
  return Math.round(v * 1e6) / 1e6;
}

function bytesToBase64Url(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToBytes(s) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Stato del giro → stringa compatta da mettere nell'hash dell'URL. */
export function encodeState(state) {
  const o = { ...DEFAULT_OPTIONS, ...(state.options || {}) };
  const compact = {
    v: 1,
    n: state.name || '',
    l: state.loop ? 1 : 0,
    o: [o.highways, o.avoidTolls ? 1 : 0, o.avoidFerries ? 1 : 0, o.avoidUnpaved ? 1 : 0, o.shortest ? 1 : 0],
    s: (state.stops || []).map((s) => [round5(s.lat), round5(s.lon), s.name || '', s.type === 'through' ? 1 : 0, s.snap ? 1 : 0, encodePass(s.pass)]),
  };
  return bytesToBase64Url(new TextEncoder().encode(JSON.stringify(compact)));
}

const PASS_MODES = ['auto', 'full', 'half'];

// Passo: [modo, versante di salita, di discesa, versanti [lat, lon, paese, direzione]]
function encodePass(p) {
  if (!p) return 0;
  const mode = Math.max(0, PASS_MODES.indexOf(p.mode));
  if (!Array.isArray(p.sides) || !p.sides.length) return [mode];
  return [mode, p.up || 0, p.down || 0, p.sides.map((x) => [round5(x.via[0]), round5(x.via[1]), x.place || '', Math.round(x.bearing || 0)])];
}

function decodePass(c) {
  if (!Array.isArray(c)) return null;
  const pass = { mode: PASS_MODES[c[0]] || 'auto', sides: null, up: 0, down: 0 };
  if (Array.isArray(c[3]) && c[3].length) {
    pass.sides = c[3].map(([lat, lon, place, bearing]) => ({ via: [lat, lon], end: [lat, lon], place: String(place || ''), bearing: Number(bearing) || 0 }));
    pass.up = Math.min(Number(c[1]) || 0, pass.sides.length - 1);
    pass.down = Math.min(Number(c[2]) || 0, pass.sides.length - 1);
  }
  return pass;
}

function round5(v) {
  return Math.round(v * 1e5) / 1e5;
}

/** Stringa dell'hash → stato del giro. Lancia un errore se non è valida. */
export function decodeState(str) {
  const raw = String(str || '').replace(/^#/, '').replace(/^g=/, '');
  const c = JSON.parse(new TextDecoder().decode(base64UrlToBytes(raw)));
  if (!c || c.v !== 1 || !Array.isArray(c.s)) throw new Error('Link non valido');
  const [highways, tolls, ferries, unpaved, shortest] = c.o || [];
  const hw = [0, 0.5, 1].includes(highways) ? highways : DEFAULT_OPTIONS.highways;
  return {
    name: typeof c.n === 'string' ? c.n : '',
    loop: !!c.l,
    options: {
      highways: hw,
      avoidTolls: !!tolls,
      avoidFerries: !!ferries,
      avoidUnpaved: unpaved === undefined ? DEFAULT_OPTIONS.avoidUnpaved : !!unpaved,
      shortest: !!shortest,
    },
    stops: c.s
      .filter((s) => Array.isArray(s) && Number.isFinite(s[0]) && Number.isFinite(s[1]))
      .map((s) => {
        const stop = { lat: s[0], lon: s[1], name: String(s[2] || ''), type: s[3] ? 'through' : 'break', snap: !!s[4] };
        const pass = decodePass(s[5]);
        if (pass) stop.pass = pass;
        return stop;
      }),
  };
}

/** Nome del giro di riserva: "Partenza – Arrivo". */
export function defaultTripName(stops, loop = false) {
  if (!stops.length) return 'Giro';
  const first = shortPlace(stops[0].name);
  if (loop || stops.length === 1) return `Anello da ${first}`;
  return `${first} - ${shortPlace(stops[stops.length - 1].name)}`;
}

function shortPlace(name) {
  return String(name || '').split(',')[0].trim() || 'Punto';
}

/** Nome file: nome del giro + data, senza caratteri problematici. */
export function gpxFileName(name, date = new Date(), suffix = '') {
  const slug =
    String(name || 'giro')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^A-Za-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'giro';
  const d = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  return `${slug}_${d}${suffix ? `_${suffix}` : ''}.gpx`;
}

function toIsoSeconds(date) {
  return new Date(date).toISOString().replace(/\.\d{3}Z$/, 'Z');
}
