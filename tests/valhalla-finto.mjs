// Finto server Valhalla per i test: applica gli stessi controlli di quello vero (massimo di località e
// distanza totale tra le località) e restituisce un viaggio con la geometria in linea retta.
import { encodePolyline, haversine } from '../js/core.js';

/**
 * Installa un fetch finto per le richieste di percorso.
 * limiti: { maxLocations, distance: { motorcycle, auto }, factor }  (factor: quanto il server "misura" in più)
 * Restituisce { requests, restore }: requests = [{ costing, locations, total }].
 */
export function installValhallaFinto({ maxLocations = 100, distance = { motorcycle: 500000, auto: 5000000 }, factor = 1, failCosting = [] } = {}) {
  const original = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url) => {
    const u = new URL(String(url));
    if (!u.pathname.endsWith('/route')) return new Response(JSON.stringify({}), { status: 404 });
    const req = JSON.parse(u.searchParams.get('json'));
    const locs = req.locations;
    const total = locs.slice(1).reduce((a, l, i) => a + haversine([locs[i].lat, locs[i].lon], [l.lat, l.lon]), 0) * factor;
    requests.push({ costing: req.costing, locations: locs.length, total });
    const err = (code, error) => new Response(JSON.stringify({ error_code: code, error, status_code: 400 }), { status: 400, headers: { 'content-type': 'application/json' } });
    if (failCosting.includes(req.costing)) return err(125, 'No costing method found');
    if (locs.length > maxLocations) return err(150, `Exceeded max locations of ${maxLocations}.`);
    const limit = distance[req.costing] ?? distance.auto;
    if (total > limit) return err(154, `Path distance exceeds the max distance limit: ${limit} meters`);
    // un viaggio: una tratta ogni sosta ("break"), geometria in linea retta tra le località
    const legs = [];
    let cur = [[locs[0].lat, locs[0].lon]];
    locs.slice(1).forEach((l, i) => {
      cur.push([l.lat, l.lon]);
      if (l.type !== 'through' || i === locs.length - 2) {
        const len = cur.slice(1).reduce((a, p, k) => a + haversine(cur[k], p), 0) / 1000;
        legs.push({
          shape: encodePolyline(cur, 6),
          maneuvers: [
            { type: 1, instruction: 'Parti.', length: len, time: len * 60, begin_shape_index: 0, end_shape_index: cur.length - 1 },
            { type: 4, instruction: 'Arrivo.', length: 0, time: 0, begin_shape_index: cur.length - 1, end_shape_index: cur.length - 1 },
          ],
          summary: { length: len, time: len * 60 },
        });
        cur = [[l.lat, l.lon]];
      }
    });
    const length = legs.reduce((a, l) => a + l.summary.length, 0);
    return new Response(JSON.stringify({ trip: { legs, summary: { length, time: length * 60 }, status: 0 } }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  return { requests, restore: () => (globalThis.fetch = original) };
}

/** 31 tappe in Sardegna, in ordine "a zig zag" tra costa e interno (somma in linea d'aria ben oltre i 1500 km). */
export const SARDEGNA = [
  ['Santa Teresa', 41.24, 9.19], ['Villasimius', 39.14, 9.52], ['Alghero', 40.56, 8.32], ['Tortolì', 39.93, 9.66],
  ['Bosa', 40.3, 8.5], ['Orosei', 40.38, 9.7], ['Oristano', 39.9, 8.59], ['Olbia', 40.92, 9.5],
  ['Carbonia', 39.17, 8.52], ['Siniscola', 40.57, 9.69], ['Cagliari', 39.22, 9.12], ['Castelsardo', 40.91, 8.71],
  ['Muravera', 39.42, 9.57], ['Sassari', 40.73, 8.56], ['Lanusei', 39.88, 9.54], ['Ozieri', 40.59, 9.01],
  ['Teulada', 38.97, 8.77], ['Nuoro', 40.32, 9.33], ['Iglesias', 39.31, 8.53], ['Tempio', 40.9, 9.1],
  ['Guspini', 39.54, 8.63], ['Dorgali', 40.29, 9.59], ['Sanluri', 39.56, 8.9], ['Macomer', 40.27, 8.78],
  ['Sorgono', 40.02, 9.09], ['Ghilarza', 40.12, 8.83], ['Arbatax', 39.93, 9.7], ['Porto Torres', 40.84, 8.4],
  ['Pula', 38.97, 9.0], ['Budoni', 40.7, 9.73], ['La Maddalena', 41.21, 9.4],
].map(([name, lat, lon]) => ({ name, lat, lon, type: 'break', snap: false }));
