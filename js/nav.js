// Navigazione: calcoli puri (nessun DOM, nessun GPS). Testati in tests/nav.test.mjs.
//
// Il percorso è un "binario": ogni posizione GPS si proietta sulla traccia e diventa una
// distanza percorsa s (metri dall'inizio). La freccia mostrata non salta da un dato GPS
// all'altro: avanza lungo il binario alla velocità stimata e si riallinea dolcemente
// quando arriva il dato nuovo (dead reckoning vincolato alla traccia).

import { haversine, cumulativeDistances } from './core.js?v=202610041257';

const RAD = Math.PI / 180;

export const NAV = Object.freeze({
  OFF_ROUTE: 50, // metri dalla traccia oltre i quali si è fuori percorso
  OFF_ROUTE_FIXES: 3, // dati GPS consecutivi fuori traccia prima di dirlo
  SEARCH_BACK: 300, // finestra di ricerca attorno all'ultima posizione nota (metri)
  SEARCH_AHEAD: 1500,
  MAX_EXTRAPOLATION: 4, // secondi: senza GPS la freccia non va avanti all'infinito
  CATCH_UP: 1.8, // quanto in fretta la freccia recupera lo scarto (1/s)
  JUMP: 40, // indietro di più di così: si salta, non si "rincula" piano
  ARRIVED: 30, // metri dalla fine: arrivato
});

/** Indice del percorso: distanze cumulative e posizione lungo la traccia di ogni manovra. */
export function buildRouteIndex(parsed) {
  const shape = parsed.shape;
  const cum = cumulativeDistances(shape);
  const maneuvers = parsed.maneuvers.map((m) => ({ ...m, at: cum[Math.min(m.begin, cum.length - 1)] }));
  return { shape, cum, total: cum[cum.length - 1], maneuvers };
}

/** Proiezione di p sul segmento a-b in un piano locale: { t (0..1), dist (m) }. */
function projectSegment(p, a, b) {
  const k = Math.cos(((a[0] + b[0]) / 2) * RAD);
  const ax = a[1] * k;
  const ay = a[0];
  const dx = b[1] * k - ax;
  const dy = b[0] - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((p[1] * k - ax) * dx + (p[0] - ay) * dy) / len2)) : 0;
  const q = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  return { t, dist: haversine(p, q) };
}

function segmentAt(cum, s) {
  // primo indice i con cum[i] >= s (ricerca binaria)
  let lo = 1;
  let hi = cum.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] < s) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Proietta la posizione GPS sulla traccia. Con `hint` (ultima s nota) cerca solo in una
 * finestra attorno, così su un percorso che ripassa vicino a se stesso non salta avanti.
 * Restituisce { s, offset } (offset = distanza in metri dalla traccia).
 */
export function projectOnRoute(index, p, hint = null) {
  const { shape, cum } = index;
  let i0 = 1;
  let i1 = shape.length - 1;
  if (hint != null) {
    i0 = Math.max(1, segmentAt(cum, hint - NAV.SEARCH_BACK));
    i1 = Math.min(shape.length - 1, segmentAt(cum, hint + NAV.SEARCH_AHEAD));
  }
  let best = { s: 0, offset: Infinity };
  for (let i = i0; i <= i1; i++) {
    const { t, dist } = projectSegment(p, shape[i - 1], shape[i]);
    if (dist < best.offset) best = { s: cum[i - 1] + (cum[i] - cum[i - 1]) * t, offset: dist };
  }
  // se nella finestra è lontano, si riprova su tutta la traccia (per esempio dopo un tunnel)
  if (hint != null && best.offset > NAV.OFF_ROUTE * 2) {
    const all = projectOnRoute(index, p, null);
    if (all.offset < best.offset) return all;
  }
  return best;
}

function bearingDeg(a, b) {
  const y = Math.sin((b[1] - a[1]) * RAD) * Math.cos(b[0] * RAD);
  const x = Math.cos(a[0] * RAD) * Math.sin(b[0] * RAD) - Math.sin(a[0] * RAD) * Math.cos(b[0] * RAD) * Math.cos((b[1] - a[1]) * RAD);
  return ((Math.atan2(y, x) / RAD) + 360) % 360;
}

/** Punto e direzione (gradi da nord) alla distanza s lungo la traccia. */
export function pointAtDistance(index, s) {
  const { shape, cum, total } = index;
  const d = Math.max(0, Math.min(total, s));
  const i = segmentAt(cum, d);
  const a = shape[i - 1];
  const b = shape[i];
  const len = cum[i] - cum[i - 1];
  const t = len ? (d - cum[i - 1]) / len : 0;
  const point = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  // direzione guardando un po' avanti: la freccia non "trema" sui vertici ravvicinati
  const ahead = Math.min(total, d + 20);
  const j = segmentAt(cum, ahead);
  const c = shape[j - 1];
  const e = shape[j];
  const tl = cum[j] - cum[j - 1] ? (ahead - cum[j - 1]) / (cum[j] - cum[j - 1]) : 0;
  const target = [c[0] + (e[0] - c[0]) * tl, c[1] + (e[1] - c[1]) * tl];
  const heading = haversine(point, target) > 0.5 ? bearingDeg(point, target) : bearingDeg(a, b);
  return { point, heading };
}

/** Avanzamento: prossima manovra, distanza fino a lì, metri e secondi che mancano. */
export function progress(index, s) {
  const { maneuvers, total } = index;
  let k = maneuvers.findIndex((m) => m.at > s + 3);
  if (k < 0) k = maneuvers.length - 1;
  const next = maneuvers[k];
  const after = maneuvers[k + 1] || null;
  // tempo rimanente: la parte che resta della manovra in corso più quelle successive
  let remainingTime = 0;
  maneuvers.forEach((m, i) => {
    const end = i + 1 < maneuvers.length ? maneuvers[i + 1].at : total;
    if (end <= s) return;
    const len = Math.max(1, end - m.at);
    const left = Math.min(1, (end - Math.max(s, m.at)) / len);
    remainingTime += (m.time || 0) * left;
  });
  return {
    next,
    nextIndex: k,
    after,
    toNext: Math.max(0, next.at - s),
    remaining: Math.max(0, total - s),
    remainingTime,
    arrived: total - s <= NAV.ARRIVED,
  };
}

/**
 * Inseguitore della posizione mostrata. `fix(s, speed, t)` riceve ogni dato GPS già
 * proiettato (speed in m/s, può mancare); `frame(t)` restituisce la s da disegnare.
 * Tra un dato e l'altro la freccia avanza alla velocità stimata; lo scarto con il dato
 * nuovo si recupera in modo continuo; non torna indietro per piccoli errori del GPS.
 */
export class Tracker {
  constructor() {
    this.sFix = null;
    this.tFix = 0;
    this.v = 0;
    this.sShown = null;
    this.tShown = 0;
  }

  fix(s, speed, t) {
    if (this.sFix == null) {
      this.sFix = s;
      this.tFix = t;
      this.sShown = s;
      this.tShown = t;
      this.v = speed > 0 ? speed : 0;
      return;
    }
    const dt = (t - this.tFix) / 1000;
    const measured = speed != null && speed >= 0 ? speed : dt > 0 ? Math.max(0, (s - this.sFix) / dt) : this.v;
    this.v = Math.min(70, 0.55 * this.v + 0.45 * measured);
    this.sFix = s;
    this.tFix = t;
  }

  frame(t) {
    if (this.sFix == null) return null;
    const dt = Math.max(0, Math.min(0.25, (t - this.tShown) / 1000));
    this.tShown = t;
    const elapsed = (t - this.tFix) / 1000;
    const since = Math.min(NAV.MAX_EXTRAPOLATION, elapsed);
    const predicted = this.sFix + this.v * since;
    // finita l'estrapolazione (GPS assente) la freccia non avanza più da sola
    const v = elapsed >= NAV.MAX_EXTRAPOLATION ? 0 : this.v;
    if (predicted < this.sShown - NAV.JUMP) {
      // il GPS dice che siamo molto più indietro: si salta (per esempio dopo un ricalcolo)
      this.sShown = predicted;
      return this.sShown;
    }
    // avanza alla velocità stimata e recupera lo scarto senza mai tornare indietro
    const step = v * dt + (predicted - (this.sShown + v * dt)) * Math.min(1, NAV.CATCH_UP * dt);
    this.sShown += Math.max(0, step);
    return this.sShown;
  }
}

/** Ruota dolcemente un angolo verso un altro (gradi), prendendo la via più corta. */
export function easeAngle(from, to, k) {
  let d = (((to - from) % 360) + 540) % 360 - 180;
  return (from + d * k + 360) % 360;
}

/** Distanza leggibile per lo schermo di guida: "350 m", "1,2 km". */
export function formatDistance(m) {
  if (m < 1000) return `${Math.max(0, Math.round(m / 10) * 10)} m`;
  return `${(m / 1000).toFixed(m < 10000 ? 1 : 0).replace('.', ',')} km`;
}

/**
 * Categoria dell'icona per la manovra (per disegnare la freccia grande):
 * straight, slight-right, right, sharp-right, uturn, slight-left, left, sharp-left,
 * roundabout, merge, ferry, depart, arrive.
 */
export function maneuverIcon(type) {
  const map = {
    1: 'depart', 2: 'depart', 3: 'depart', 4: 'arrive', 5: 'arrive', 6: 'arrive',
    7: 'straight', 8: 'straight', 9: 'slight-right', 10: 'right', 11: 'sharp-right',
    12: 'uturn', 13: 'uturn', 14: 'sharp-left', 15: 'left', 16: 'slight-left',
    17: 'straight', 18: 'slight-right', 19: 'slight-left', 20: 'slight-right', 21: 'slight-left',
    22: 'straight', 23: 'slight-right', 24: 'slight-left', 25: 'merge', 26: 'roundabout',
    27: 'roundabout', 28: 'ferry', 29: 'ferry', 37: 'slight-right', 38: 'slight-left',
  };
  return map[type] || 'straight';
}

/**
 * Frase da dire quando ci si avvicina a una manovra, con la distanza arrotondata:
 * "Tra 300 metri, svolta a destra su SP1."
 */
export function spokenAlert(m, meters) {
  const base = (m.verbalAlert || m.verbalPre || m.instruction || '').replace(/\.$/, '');
  const d = meters >= 1000 ? `${(Math.round(meters / 100) / 10).toString().replace('.', ',')} chilometri` : `${Math.round(meters / 50) * 50} metri`;
  return `Tra ${d}, ${base.charAt(0).toLowerCase()}${base.slice(1)}.`;
}
