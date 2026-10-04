// Rete stradale sintetica attorno a un passo, in formato Overpass "out geom".
import { straight } from './fixture.mjs';

export const SUMMIT = [46.5286, 10.4532];

// Rete stradale sintetica in formato Overpass "out geom"
let nextNode = 1;
function way(id, points, tags, nodeIds) {
  const nodes = nodeIds || points.map(() => nextNode++);
  return { type: 'way', id, nodes, geometry: points.map(([lat, lon]) => ({ lat, lon })), tags };
}

export function network({ splitAtSummit = true } = {}) {
  nextNode = 1;
  const south = [SUMMIT, ...straight(SUMMIT, 190, 6000, 100)]; // versante sud (Bormio)
  const northEast = [SUMMIT, ...straight(SUMMIT, 40, 6000, 100)]; // versante nord-est (Trafoi)
  const summitId = nextNode++;
  const southIds = [summitId, ...south.slice(1).map(() => nextNode++)];
  const neIds = [summitId, ...northEast.slice(1).map(() => nextNode++)];
  const ss = { highway: 'secondary', ref: 'SS38', name: 'Strada dello Stelvio' };
  const elements = [];
  if (splitAtSummit) {
    // la strada è divisa in due way alla cima; il versante sud è spezzato anche a 2,5 km
    elements.push(way(1, south.slice(0, 26), ss, southIds.slice(0, 26)));
    elements.push(way(2, south.slice(25), ss, southIds.slice(25)));
    elements.push(way(3, northEast, ss, neIds));
  } else {
    // un'unica way che attraversa la cima
    const all = [...northEast.slice().reverse(), ...south.slice(1)];
    const ids = [...neIds.slice().reverse(), ...southIds.slice(1)];
    elements.push(way(4, all, ss, ids));
  }
  // bivio a 2,5 km sul versante sud: strada che va a ovest (non deve "rubare" il versante)
  const junction = south[25];
  const westIds = [southIds[25], ...straight(junction, 270, 4000, 100).map(() => nextNode++)];
  elements.push(way(5, [junction, ...straight(junction, 270, 4000, 100)], { highway: 'secondary', ref: 'SS301', name: 'Strada del Foscagno' }, westIds));
  // stradina senza uscita di 200 m vicino alla cima (rifugio)
  const hut = [SUMMIT, ...straight(SUMMIT, 100, 200, 50)];
  elements.push(way(6, hut, { highway: 'unclassified', name: 'Via del Rifugio' }, [summitId, ...hut.slice(1).map(() => nextNode++)]));
  // elementi da ignorare
  elements.push({ type: 'node', id: 999, lat: 1, lon: 1 });
  elements.push({ type: 'way', id: 7, nodes: [1], geometry: [{ lat: 1, lon: 1 }], tags: { highway: 'secondary' } });
  return { elements, south, northEast };
}

