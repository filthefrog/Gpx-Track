// Roadbook da rally: dalle manovre del percorso (o da un GPX turn by turn) alle caselle
// in stile FIA/FIM: distanza totale e parziale, tulipano, CAP e note.
// Funzioni pure (nessun DOM, nessuna rete): testate in tests/roadbook.test.mjs.
// Requisiti e fonti: docs/roadbook.md.
import { cumulativeDistances, curvature, escapeXml, simplifyRDP } from './core.js?v=202610041740';

export const RB = Object.freeze({
  HEADING_M: 35, // metri di traccia per misurare la direzione di entrata e di uscita
  CLOSE_KM: 0.3, // parziale sotto i 300 m: casella evidenziata (prassi dei roadbook FIA/FIM)
  GEO_TURN_DEG: 45, // GPX senza indicazioni: cambio di direzione minimo per fare una casella
  GEO_WINDOW_M: 25, // ... misurato su ±25 m
  GEO_MIN_GAP_M: 80, // ... e caselle distanti almeno 80 m
  OPENRALLY_NS: 'http://www.openrally.org/xmlschemas/GpxExtensions/v1.0.3',
});

const toRad = (d) => (d * Math.PI) / 180;

/** Direzione (0-360, 0 = nord) da a verso b. */
export function bearing(a, b) {
  const y = Math.sin(toRad(b[1] - a[1])) * Math.cos(toRad(b[0]));
  const x = Math.cos(toRad(a[0])) * Math.sin(toRad(b[0])) - Math.sin(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.cos(toRad(b[1] - a[1]));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** Angolo di svolta da -180 a 180 (positivo = a destra). */
export function relativeAngle(inHeading, outHeading) {
  return ((((outHeading - inHeading + 540) % 360) + 360) % 360) - 180;
}

function pointAt(shape, cum, d) {
  const total = cum[cum.length - 1];
  if (d <= 0) return shape[0];
  if (d >= total) return shape[shape.length - 1];
  let lo = 0;
  let hi = cum.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= d) lo = mid;
    else hi = mid;
  }
  const len = cum[hi] - cum[lo];
  const t = len ? (d - cum[lo]) / len : 0;
  return [shape[lo][0] + (shape[hi][0] - shape[lo][0]) * t, shape[lo][1] + (shape[hi][1] - shape[lo][1]) * t];
}

/** Direzione con cui si arriva al punto `i` (null all'inizio) e con cui si riparte (null alla fine). */
function headings(shape, cum, i, span = RB.HEADING_M) {
  const here = shape[i];
  const total = cum[cum.length - 1];
  const inH = cum[i] > 1 ? bearing(pointAt(shape, cum, cum[i] - span), here) : null;
  const outH = total - cum[i] > 1 ? bearing(here, pointAt(shape, cum, cum[i] + span)) : null;
  return { inH, outH };
}

// ---------------------------------------------------------------------------
// Caselle
// ---------------------------------------------------------------------------

const KIND_OF = {
  1: 'start', 2: 'start', 3: 'start',
  4: 'end', 5: 'end', 6: 'end',
  8: 'straight', 22: 'straight', 17: 'straight', 25: 'straight',
  9: 'turn', 10: 'turn', 11: 'turn', 12: 'uturn', 13: 'uturn', 14: 'turn', 15: 'turn', 16: 'turn',
  18: 'turn', 19: 'turn', 20: 'turn', 21: 'turn', 23: 'keep', 24: 'keep', 37: 'turn', 38: 'turn',
  26: 'roundabout',
  28: 'ferry', 29: 'ferry',
};

const TITLE_OF = {
  start: 'Partenza', end: 'Arrivo', straight: 'Dritto', uturn: 'Inversione', ferry: 'Traghetto', roundabout: 'Rotonda',
};

function turnTitle(angle) {
  const a = Math.abs(angle);
  const side = angle > 0 ? 'destra' : 'sinistra';
  if (a < 20) return 'Dritto';
  if (a < 60) return `Leggermente a ${side}`;
  if (a < 135) return side === 'destra' ? 'Destra' : 'Sinistra';
  return `Tutto a ${side}`;
}

/**
 * Caselle del roadbook dalle manovre di un percorso (`parsed` come da parseTrip, oppure da
 * turnByTurnFromGpx). `stops` (facoltativo) dà il nome alle tappe intermedie.
 * Restituisce { boxes, totalKm }: ogni casella ha n, total, partial (km), cap (0-359),
 * turn (angolo di svolta), kind, exitCount, title, road, toward, note, hairpins, close, lat, lon.
 */
export function buildRoadbook(parsed, { stops = [] } = {}) {
  const shape = parsed.shape;
  const cum = cumulativeDistances(shape);
  const ms = parsed.maneuvers;
  const boxes = [];
  // nome della tappa: quella più vicina (entro 500 m) al punto della casella
  const stopNear = (i) => {
    let best = null;
    let bestD = 0.0045; // ~500 m in gradi di latitudine
    for (const st of stops) {
      const d = Math.hypot(st.lat - shape[i][0], (st.lon - shape[i][1]) * Math.cos(toRad(st.lat)));
      if (d < bestD) {
        bestD = d;
        best = st;
      }
    }
    return best ? best.name : '';
  };
  for (let k = 0; k < ms.length; k++) {
    const m = ms[k];
    const kind = KIND_OF[m.type];
    if (!kind) continue; // cambio nome della strada (7), uscita dalla rotonda (27: è nella casella della rotonda), trasporti
    const last = k === ms.length - 1;
    if (kind === 'start' && boxes.length) continue; // ripartenza dopo una tappa: la casella c'è già
    let exitIdx = m.begin;
    if (kind === 'roundabout') {
      const exit = ms.slice(k + 1).find((x) => x.type === 27);
      exitIdx = exit ? exit.begin : Math.min(m.end ?? m.begin, shape.length - 1);
    }
    const { inH } = headings(shape, cum, m.begin);
    const { outH } = headings(shape, cum, exitIdx);
    const turn = inH == null || outH == null ? 0 : Number.isFinite(m.turnAngle) ? m.turnAngle : relativeAngle(inH, outH);
    const mid = kind === 'end' && !last; // arrivo a una tappa intermedia
    const box = {
      lat: shape[m.begin][0],
      lon: shape[m.begin][1],
      index: m.begin,
      total: Math.round((m.km ?? cum[m.begin] / 1000) * 100) / 100,
      kind: mid ? 'stop' : kind,
      turn: Math.round(turn),
      cap: outH == null ? null : Math.round(outH) % 360,
      exitCount: m.exitCount || 0,
      road: (m.streetNames && m.streetNames[0]) || '',
      toward: m.toward || '',
      note: '',
    };
    if (box.kind === 'stop' || box.kind === 'start' || box.kind === 'end') box.note = stopNear(m.begin);
    box.title =
      box.kind === 'roundabout'
        ? `Rotonda${box.exitCount ? `, ${box.exitCount}ª uscita` : ''}`
        : box.kind === 'turn' || box.kind === 'keep'
          ? box.kind === 'keep' ? `Tieni la ${box.turn > 0 ? 'destra' : 'sinistra'}` : turnTitle(box.turn)
          : box.kind === 'stop' ? 'Tappa' : TITLE_OF[box.kind] || 'Dritto';
    boxes.push(box);
  }
  finishBoxes(boxes, shape, cum);
  return { boxes, totalKm: Math.round((parsed.summary ? parsed.summary.length : cum[cum.length - 1] / 1000) * 100) / 100 };
}

/** Numeri, parziali, tornanti fino alla casella dopo e caselle ravvicinate. */
function finishBoxes(boxes, shape, cum) {
  boxes.forEach((b, i) => {
    b.n = i + 1;
    b.partial = i === 0 ? 0 : Math.round((b.total - boxes[i - 1].total) * 100) / 100;
    b.close = i > 0 && b.partial < RB.CLOSE_KM;
    const next = boxes[i + 1];
    b.hairpins = next && next.index - b.index > 2 ? curvature(shape.slice(b.index, next.index + 1)).hairpins : 0;
  });
}

// ---------------------------------------------------------------------------
// Da un GPX già fatto (il nostro turn by turn, OsmAnd, oppure una semplice traccia)
// ---------------------------------------------------------------------------

const OSMAND_TYPE = { C: 8, TSLR: 9, TR: 10, TSHR: 11, TRU: 12, TU: 13, TSHL: 14, TL: 15, TSLL: 16, KR: 23, KL: 24 };

function xmlDecode(s) {
  return String(s ?? '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, '&')
    .trim();
}

function tag(body, name) {
  const m = body.match(new RegExp(`<(?:\\w+:)?${name}>([\\s\\S]*?)</(?:\\w+:)?${name}>`));
  return m ? xmlDecode(m[1]) : '';
}

function points(xml, name) {
  const out = [];
  const re = new RegExp(`<(?:\\w+:)?${name}\\b([^>]*?)(?:/>|>([\\s\\S]*?)</(?:\\w+:)?${name}>)`, 'g');
  let m;
  while ((m = re.exec(xml))) {
    const lat = Number((m[1].match(/\blat\s*=\s*["']([^"']+)["']/) || [])[1]);
    const lon = Number((m[1].match(/\blon\s*=\s*["']([^"']+)["']/) || [])[1]);
    if (Number.isFinite(lat) && Number.isFinite(lon)) out.push({ lat, lon, body: m[2] || '' });
  }
  return out;
}

function nearestIndex(shape, p, from = 0) {
  let best = from;
  let bestD = Infinity;
  for (let i = from; i < shape.length; i++) {
    const dLat = shape[i][0] - p[0];
    const dLon = (shape[i][1] - p[1]) * Math.cos(toRad(p[0]));
    const d = dLat * dLat + dLon * dLon;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/**
 * Legge un GPX e ricostruisce percorso e manovre per il roadbook, senza ricalcolare nulla:
 * - con le indicazioni di OsmAnd (rtept con osmand:turn / turn-angle / offset): le usa;
 * - con la sola traccia: ricava le svolte dalla forma della strada (source = 'geometry').
 * Restituisce { name, shape, maneuvers, summary, source, stops } oppure null.
 */
export function turnByTurnFromGpx(xml) {
  const text = String(xml || '');
  if (!/<(?:\w+:)?gpx\b/.test(text)) return null;
  const trk = points(text, 'trkpt').map((p) => [p.lat, p.lon]);
  const rte = points(text, 'rtept');
  const name = tag((text.match(/<(?:\w+:)?metadata>([\s\S]*?)<\/(?:\w+:)?metadata>/) || [])[1] || '', 'name') ||
    tag((text.match(/<(?:\w+:)?(?:rte|trk)>([\s\S]*?)<\/(?:\w+:)?(?:rte|trk)>/) || [])[1] || '', 'name');
  const shape = trk.length >= 2 ? trk : rte.map((p) => [p.lat, p.lon]);
  if (shape.length < 2) return null;
  const cum = cumulativeDistances(shape);
  const km = (i) => cum[i] / 1000;
  const wpts = points(text, 'wpt').map((p) => ({ lat: p.lat, lon: p.lon, name: tag(p.body, 'name').replace(/^\d+\.\s*/, '') }));
  const withTurns = rte.filter((p) => /<(?:\w+:)?turn(?:-angle)?>/.test(p.body));
  let maneuvers;
  let source;
  if (withTurns.length) {
    source = 'turn-by-turn';
    let from = 0;
    maneuvers = rte.map((p, i) => {
      const off = Number(tag(p.body, 'offset'));
      const begin = trk.length >= 2 && Number.isInteger(off) && off >= 0 && off < shape.length ? off : nearestIndex(shape, [p.lat, p.lon], from);
      from = begin;
      const turn = tag(p.body, 'turn');
      const angle = Number(tag(p.body, 'turn-angle'));
      const rnd = turn.match(/^RNDB(\d+)/);
      const label = tag(p.body, 'cmt') || tag(p.body, 'desc') || tag(p.body, 'name');
      const name = tag(p.body, 'name');
      // senza codice di svolta: partenza, arrivo (anche a una tappa intermedia) o ripartenza
      // («Riparti da…» nel nostro GPX sostituisce l'arrivo alla tappa intermedia: è una casella di tappa)
      const plain = /\bArriv|\bRiparti\b/i.test(name) ? 4 : /\bParti\b/i.test(name) ? 1 : 8;
      const type = i === 0 ? 1 : rnd ? 26 : OSMAND_TYPE[turn] || (turn ? 8 : i === rte.length - 1 ? 4 : plain);
      const road = (label.match(/\b(?:su|in|on)\s+((?:S[PSR]|A|E|SS|SP|SR|SC)\s?\d+[a-z]?|Via [^,.;]+|Strada [^,.;]+)/i) || [])[1] || '';
      return {
        type, begin, km: km(begin), exitCount: rnd ? Number(rnd[1]) : 0, streetNames: road ? [road] : [], toward: '',
        // OsmAnd: turn-angle in gradi, negativo a sinistra (come il nostro "turn")
        turnAngle: Number.isFinite(angle) && tag(p.body, 'turn-angle') !== '' ? angle : undefined,
      };
    });
    // le rotonde di OsmAnd non hanno la manovra di uscita: la si cerca dopo l'ingresso
    maneuvers.forEach((m, i) => {
      if (m.type !== 26) return;
      const next = maneuvers[i + 1];
      m.end = next ? Math.max(m.begin, Math.min(next.begin, nearestExit(shape, cum, m.begin))) : m.begin;
    });
    if (maneuvers[maneuvers.length - 1].type !== 4) maneuvers.push({ type: 4, begin: shape.length - 1, km: km(shape.length - 1), streetNames: [] });
  } else {
    source = 'geometry';
    maneuvers = geometryTurns(shape, cum).map((i) => ({ type: 9, begin: i, km: km(i), streetNames: [] }));
    maneuvers.unshift({ type: 1, begin: 0, km: 0, streetNames: [] });
    maneuvers.push({ type: 4, begin: shape.length - 1, km: km(shape.length - 1), streetNames: [] });
  }
  return { name, shape, maneuvers, summary: { length: cum[cum.length - 1] / 1000 }, source, stops: wpts };
}

/** Uscita da una rotonda: primo punto dopo l'ingresso a più di ~40 m in linea d'aria e in allontanamento. */
function nearestExit(shape, cum, i) {
  for (let k = i + 1; k < shape.length; k++) if (cum[k] - cum[i] > 60) return k;
  return shape.length - 1;
}

/**
 * Svolte ricavate dalla sola forma della traccia: punti dove la direzione cambia di almeno
 * GEO_TURN_DEG gradi su ±GEO_WINDOW_M metri, distanti almeno GEO_MIN_GAP_M tra loro.
 * Su una strada di montagna segnala anche i tornanti: per un roadbook va bene, sono note utili.
 */
export function geometryTurns(shape, cum = cumulativeDistances(shape)) {
  const total = cum[cum.length - 1];
  const w = RB.GEO_WINDOW_M;
  const cand = [];
  for (let i = 1; i < shape.length - 1; i++) {
    if (cum[i] < w || total - cum[i] < w) continue;
    const a = bearing(pointAt(shape, cum, cum[i] - w), shape[i]);
    const b = bearing(shape[i], pointAt(shape, cum, cum[i] + w));
    const t = Math.abs(relativeAngle(a, b));
    if (t >= RB.GEO_TURN_DEG) cand.push({ i, t });
  }
  // nei gruppi di punti vicini si tiene quello che gira di più
  const out = [];
  for (const c of cand) {
    const prev = out[out.length - 1];
    if (prev && cum[c.i] - cum[prev.i] < RB.GEO_MIN_GAP_M) {
      if (c.t > prev.t) out[out.length - 1] = c;
    } else out.push(c);
  }
  return out.map((c) => c.i);
}

// ---------------------------------------------------------------------------
// Disegni: tulipano e note (SVG, usati nella stampa e nel GPX OpenRally)
// ---------------------------------------------------------------------------

const C = 50; // centro del disegno 100 × 100
const R = 38; // lunghezza dei rami

function polar(angle, r = R, cx = C, cy = C) {
  // 0 = in alto (direzione di arrivo), positivo a destra
  return [cx + r * Math.sin(toRad(angle)), cy - r * Math.cos(toRad(angle))];
}

function arrowHead([x, y], angle, size = 9) {
  const [ax, ay] = polar(angle + 150, size, x, y);
  const [bx, by] = polar(angle - 150, size, x, y);
  return `<path d="M${x.toFixed(1)},${y.toFixed(1)}L${ax.toFixed(1)},${ay.toFixed(1)}L${bx.toFixed(1)},${by.toFixed(1)}Z" fill="#000"/>`;
}

/**
 * Tulipano della casella: si arriva dal basso (pallino), la freccia indica dove andare.
 * Le rotonde si percorrono in senso antiorario (circolazione a destra), con un trattino per
 * ogni uscita che si lascia prima della propria.
 */
export function tulipSvg(box) {
  const parts = [];
  const line = (pts, w = 5) => `<path d="M${pts.map((p) => p.map((v) => v.toFixed(1)).join(',')).join('L')}" fill="none" stroke="#000" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;
  const entry = [C, C + R + 6];
  if (box.kind === 'start') {
    parts.push(`<circle cx="${C}" cy="${C + 14}" r="6" fill="#000"/>`, line([[C, C + 14], [C, C - R + 6]]), arrowHead([C, C - R], 0));
  } else if (box.kind === 'end' || box.kind === 'stop') {
    parts.push(`<circle cx="${entry[0]}" cy="${entry[1]}" r="5" fill="#000"/>`, line([entry, [C, C]]));
    // bandiera a scacchi stilizzata
    parts.push(`<rect x="${C - 12}" y="${C - 24}" width="24" height="18" fill="#fff" stroke="#000" stroke-width="2.5"/>`);
    for (let r = 0; r < 2; r++) for (let c = 0; c < 4; c++) if ((r + c) % 2 === 0) parts.push(`<rect x="${C - 12 + c * 6}" y="${C - 24 + r * 9}" width="6" height="9" fill="#000"/>`);
  } else if (box.kind === 'roundabout') {
    const rr = 13;
    const exit = box.turn <= -179 ? 180 : box.turn;
    // arco dall'ingresso (in basso, 180°) all'uscita, in senso antiorario visto dall'alto
    const from = 180;
    const to = exit >= 180 ? -180 : exit;
    const sweep = from - to; // gradi percorsi (0-360)
    const steps = Math.max(2, Math.round(sweep / 15));
    const arc = Array.from({ length: steps + 1 }, (_, i) => polar(from - (sweep * i) / steps, rr));
    parts.push(`<circle cx="${C}" cy="${C}" r="${rr}" fill="none" stroke="#000" stroke-width="2.5"/>`);
    // uscite lasciate prima della propria
    const passed = Math.max(0, (box.exitCount || 1) - 1);
    for (let j = 1; j <= passed; j++) {
      const a = from - (sweep * j) / (passed + 1);
      parts.push(line([polar(a, rr), polar(a, rr + 14)], 2.5));
    }
    parts.push(`<circle cx="${entry[0]}" cy="${entry[1]}" r="5" fill="#000"/>`, line([entry, polar(180, rr), ...arc, polar(to, R - 4)]), arrowHead(polar(to, R + 2), to));
  } else {
    const t = box.kind === 'straight' ? 0 : box.turn;
    // ramo del pallino e uscita
    parts.push(`<circle cx="${entry[0]}" cy="${entry[1]}" r="5" fill="#000"/>`, line([entry, [C, C], polar(t, R - 4)]), arrowHead(polar(t, R + 2), t));
    // la strada da cui si arriva continua oltre l'incrocio (sottile), se si svolta
    if (Math.abs(t) >= 20) parts.push(line([[C, C], polar(0, R - 6)], 2));
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100">${parts.join('')}</svg>`;
}

function wrap(text, max) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = '';
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > max && cur) {
      lines.push(cur);
      cur = w;
    } else cur = (cur + ' ' + w).trim();
  }
  if (cur) lines.push(cur);
  return lines;
}

/** Righe di testo delle note: indicazione, strada, direzione, tappa, tornanti. */
export function noteLines(box) {
  const lines = [];
  if (box.road) lines.push(box.road);
  if (box.toward) lines.push(`→ ${box.toward}`);
  if (box.note) lines.push(box.note);
  if (box.hairpins) lines.push(`${box.hairpins} ${box.hairpins === 1 ? 'tornante' : 'tornanti'}`);
  return lines;
}

/** Note come SVG (per OpenRally): CAP in alto, poi le righe. */
export function notesSvg(box) {
  const rows = [];
  let y = 22;
  if (box.cap != null) {
    rows.push(`<text x="96" y="${y}" text-anchor="end" font-family="sans-serif" font-size="18" font-weight="700">${box.cap}°</text>`);
    y += 22;
  }
  for (const l of noteLines(box).flatMap((t) => wrap(t, 14)).slice(0, 4)) {
    rows.push(`<text x="4" y="${y}" font-family="sans-serif" font-size="13">${escapeXml(l)}</text>`);
    y += 17;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100">${rows.join('')}</svg>`;
}

// ---------------------------------------------------------------------------
// GPX OpenRally (roadbook digitale)
// ---------------------------------------------------------------------------

const coord = (v) => (Math.round(v * 1e6) / 1e6).toFixed(6);
const cdata = (s) => `<![CDATA[${String(s).replace(/]]>/g, ']]]]><![CDATA[>')}]]>`;

/**
 * GPX con estensioni OpenRally v1.0.3 (cross-country): un waypoint per casella con distanza
 * totale, CAP, tulipano e note in SVG, più la traccia. Valido per lo schema ufficiale
 * (verificato con xmllint in tests/roadbook.test.mjs).
 */
export function buildOpenRallyGpx({ name, boxes, totalKm, shape, time = new Date() }) {
  const iso = new Date(Math.floor(time.getTime() / 1000) * 1000).toISOString().replace('.000Z', 'Z');
  const ns = RB.OPENRALLY_NS;
  let x =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    `<gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1" creator="Traccemoto"\n` +
    '  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"\n' +
    `  xmlns:openrally="${ns}"\n` +
    `  xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd ${ns} http://www.openrally.org/xmlschemas/GpxExtensions/v1.0.3.xsd">\n` +
    '  <metadata>\n' +
    `    <name>${escapeXml(name)}</name>\n` +
    `    <desc>${escapeXml(`Roadbook: ${boxes.length} caselle, ${totalKm.toFixed(2)} km`)}</desc>\n` +
    `    <time>${iso}</time>\n` +
    '    <extensions>\n' +
    '      <openrally:units>metric</openrally:units>\n' +
    `      <openrally:distance>${totalKm.toFixed(2)}</openrally:distance>\n` +
    '    </extensions>\n' +
    '  </metadata>\n';
  for (const b of boxes) {
    const desc = [b.title, ...noteLines(b)].join(' · ');
    x +=
      `  <wpt lat="${coord(b.lat)}" lon="${coord(b.lon)}">\n` +
      `    <name>${b.n}</name>\n` +
      `    <desc>${escapeXml(desc)}</desc>\n` +
      '    <extensions>\n' +
      `      <openrally:distance>${b.total.toFixed(2)}</openrally:distance>\n` +
      (b.danger ? `      <openrally:danger>${b.danger}</openrally:danger>\n` : '') +
      (b.cap != null ? `      <openrally:cap>${b.cap}</openrally:cap>\n` : '') +
      `      <openrally:tulip>${cdata(tulipSvg(b))}</openrally:tulip>\n` +
      `      <openrally:notes>${cdata(notesSvg(b))}</openrally:notes>\n` +
      '    </extensions>\n' +
      '  </wpt>\n';
  }
  const keep = boxes.map((b) => b.index);
  const line = simplifyRDP(shape, 3, keep);
  x += `  <trk>\n    <name>${escapeXml(name)}</name>\n    <trkseg>\n`;
  for (const [la, lo] of line) x += `      <trkpt lat="${coord(la)}" lon="${coord(lo)}"/>\n`;
  x += '    </trkseg>\n  </trk>\n</gpx>\n';
  return x;
}

/** km con due decimali e virgola ("12,34"), come sui tripmaster. */
export function rbKm(km) {
  return km.toFixed(2).replace('.', ',');
}
