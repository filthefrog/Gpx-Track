// Risposta Valhalla sintetica, costruita con geometria nota, per i test offline.
import { encodePolyline } from '../js/core.js';

const M_PER_DEG = 111320;

/** Segmento rettilineo da `from` verso `bearing` (gradi) lungo `length` m, un punto ogni `step` m. */
export function straight(from, bearing, length, step = 20) {
  const pts = [];
  const n = Math.max(1, Math.round(length / step));
  const b = (bearing * Math.PI) / 180;
  for (let i = 1; i <= n; i++) {
    const d = (length * i) / n;
    pts.push([
      from[0] + (d * Math.cos(b)) / M_PER_DEG,
      from[1] + (d * Math.sin(b)) / (M_PER_DEG * Math.cos((from[0] * Math.PI) / 180)),
    ]);
  }
  return pts;
}

/**
 * Costruisce una tratta da una lista di passi { type, instruction, street, bearing, length }.
 * Ogni passo è una manovra; la sua geometria va da begin a end.
 */
function buildLeg(start, steps) {
  const shape = [start];
  const maneuvers = [];
  for (const s of steps) {
    const begin = shape.length - 1;
    if (s.length > 0) shape.push(...straight(shape[shape.length - 1], s.bearing, s.length, s.step || 20));
    maneuvers.push({
      type: s.type,
      instruction: s.instruction,
      street_names: s.street ? [s.street] : undefined,
      length: s.length / 1000,
      time: s.length / 15,
      begin_shape_index: begin,
      end_shape_index: shape.length - 1,
    });
  }
  const length = steps.reduce((a, s) => a + s.length, 0) / 1000;
  return {
    shape,
    leg: {
      shape: encodePolyline(shape, 6),
      maneuvers,
      summary: { length, time: (length * 1000) / 15 },
    },
  };
}

export const START = [43.5, 13.6];

export const LEG1_STEPS = [
  { type: 1, instruction: 'Guida verso nord su Via Uno.', street: 'Via Uno', bearing: 0, length: 1000 },
  { type: 7, instruction: 'Via Uno diventa Via Due.', street: 'Via Due', bearing: 0, length: 300 },
  { type: 10, instruction: 'Svolta a destra su SP1.', street: 'SP1', bearing: 90, length: 800 },
  { type: 26, instruction: 'Entra nella rotonda.', bearing: 120, length: 40, step: 10 },
  { type: 27, instruction: 'Prendi la 2ª uscita su SP2.', street: 'SP2', bearing: 90, length: 600 },
  { type: 15, instruction: 'Svolta a sinistra su Vicolo Corto.', street: 'Vicolo Corto', bearing: 0, length: 60 },
  { type: 10, instruction: 'Svolta a destra su Via Breve.', street: 'Via Breve', bearing: 90, length: 100 },
  { type: 8, instruction: 'Continua su Via Breve.', street: 'Via Breve', bearing: 90, length: 200 },
  { type: 15, instruction: 'Svolta a sinistra su SS3.', street: 'SS3', bearing: 0, length: 500 },
  { type: 4, instruction: 'Sei arrivato a destinazione.', bearing: 0, length: 0 },
];

export const LEG2_STEPS = [
  { type: 1, instruction: 'Guida verso nord su SS3.', street: 'SS3', bearing: 0, length: 400 },
  { type: 14, instruction: 'Svolta tutto a sinistra su Strada del Passo.', street: 'Strada del Passo', bearing: 270, length: 900 },
  { type: 22, instruction: 'Mantieni dritto su Strada del Passo.', street: 'Strada del Passo', bearing: 270, length: 300 },
  { type: 4, instruction: 'Sei arrivato a destinazione.', bearing: 0, length: 0 },
];

export function makeTrip() {
  const l1 = buildLeg(START, LEG1_STEPS);
  const mid = l1.shape[l1.shape.length - 1];
  const l2 = buildLeg(mid, LEG2_STEPS);
  const end = l2.shape[l2.shape.length - 1];
  const length = l1.leg.summary.length + l2.leg.summary.length;
  return {
    trip: {
      legs: [l1.leg, l2.leg],
      summary: { length, time: (length * 1000) / 15 },
      status: 0,
    },
    stops: [
      { lat: START[0], lon: START[1], name: 'Partenza & co <test>', type: 'break' },
      { lat: mid[0], lon: mid[1], name: 'Tappa intermedia', type: 'break' },
      { lat: end[0], lon: end[1], name: 'Arrivo', type: 'break' },
    ],
    shapes: [l1.shape, l2.shape],
  };
}
