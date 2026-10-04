// Tracce Moto — interfaccia: elenco di tappe, mappa, calcolo ed export.
import {
  DEFAULT_OPTIONS,
  bestInsertionIndex,
  routeLocations,
  parseTrip,
  buildTrackGpx,
  buildRouteGpx,
  buildTurnByTurnGpx,
  turnByTurnInstructions,
  buildRoutePoints,
  roadbookText,
  formatKm,
  formatDuration,
  encodeState,
  decodeState,
  gpxFileName,
  defaultTripName,
  explainValhallaError,
  cumulativeDistances,
} from './core.js?v=202610040850';
import { snapsToRoad, splitPlaces } from './places.js?v=202610040850';
import { expandStops, nearestSide, oppositeSide, passCrossing, compassLabel } from './passes.js?v=202610040850';
import { fetchRoute, searchPlaces, reverseGeocode, fetchPassSides } from './services.js?v=202610040850';

const L = window.L;
const $ = (sel) => document.querySelector(sel);
const STORAGE_TRIPS = 'tracceMoto.giri';
const STORAGE_CURRENT = 'tracceMoto.corrente';
const RECALC_DELAY = 600;

const ICON = {
  handle: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 9h14M5 15h14"/></svg>',
  close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
};

// ---------------------------------------------------------------------------
// Stato
// ---------------------------------------------------------------------------

let nextId = 1;
const state = {
  name: '',
  // { id, query, name, context, kind, lat, lon, type, snap, status, message, candidates, showAlts }
  // status: empty | searching | ok | notfound
  stops: [],
  loop: false,
  options: { ...DEFAULT_OPTIONS },
};

let route = null; // { parsed, costing, warning, stops, loop }
let routeKey = '';
let recalcTimer = null;
let recalcAbort = null;
let recalcSeq = 0;

function emptyStop() {
  return { id: nextId++, query: '', name: '', context: '', kind: '', lat: null, lon: null, type: 'break', snap: false, status: 'empty', message: '', candidates: [], showAlts: false, draft: null };
}

function placedStop(lat, lon, name, extra = {}) {
  return { ...emptyStop(), lat, lon, name: name || coordLabel(lat, lon), query: name || '', status: 'ok', ...extra };
}

function coordLabel(lat, lon) {
  return `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
}

const isPlaced = (s) => s.status === 'ok' && s.lat != null;
const placed = () => state.stops.filter(isPlaced);

function tripName() {
  return state.name.trim() || defaultTripName(placed(), state.loop);
}

/** Tiene almeno due righe (partenza e arrivo). */
function ensureRows() {
  while (state.stops.length < 2) state.stops.push(emptyStop());
}

// ---------------------------------------------------------------------------
// Mappa
// ---------------------------------------------------------------------------

// Stradale CARTO Voyager: ha le tile @2x, quindi è nitido sugli schermi Retina di iPhone
const voyager = L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
  maxZoom: 20,
  subdomains: 'abcd',
  attribution:
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
});
const osm = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
});
const topo = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
  maxZoom: 17,
  subdomains: 'abc',
  attribution:
    'Dati: &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>, ' +
    '<a href="http://viewfinderpanoramas.org">SRTM</a> | Stile: &copy; <a href="https://opentopomap.org">OpenTopoMap</a> ' +
    '(<a href="https://creativecommons.org/licenses/by-sa/3.0/">CC-BY-SA</a>)',
});

const LAYERS = { 'Stradale (nitida)': voyager, OpenStreetMap: osm, 'Topografica (OpenTopoMap)': topo };
const STORAGE_LAYER = 'tracceMoto.mappa';
let startLayer = voyager;
try {
  startLayer = LAYERS[localStorage.getItem(STORAGE_LAYER)] || voyager;
} catch {
  // memoria del browser non disponibile: si usa lo stradale
}
const map = L.map('map', { zoomControl: true, layers: [startLayer] }).setView([45.2, 11.5], 6);
L.control.layers(LAYERS, null, { position: 'topright' }).addTo(map);
map.on('baselayerchange', (e) => {
  try {
    localStorage.setItem(STORAGE_LAYER, e.name);
  } catch {
    // non importante
  }
});
L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(map);

const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#0a6ccf';
const routeCasing = L.polyline([], { color: cssVar('--route-casing'), weight: 9, opacity: 0.9, interactive: false }).addTo(map);
const routeLine = L.polyline([], { color: cssVar('--route'), weight: 5, opacity: 0.95, interactive: false }).addTo(map);
const markersLayer = L.layerGroup().addTo(map);
let maneuverMarker = null;
let locateMarker = null;

/** Ruolo della tappa: partenza, arrivo, sosta o passaggio (conta solo le tappe trovate). */
function roleOf(stop) {
  const list = placed();
  const i = list.indexOf(stop);
  if (i === 0) return 'start';
  if (i === list.length - 1 && i > 0 && !state.loop) return 'end';
  if (i < 0) return 'empty';
  return stop.type === 'through' ? 'through' : 'break';
}

function renderMarkers() {
  markersLayer.clearLayers();
  state.stops.forEach((s, i) => {
    if (!isPlaced(s)) return;
    const role = roleOf(s);
    const size = role === 'through' ? 24 : 30;
    const m = L.marker([s.lat, s.lon], {
      icon: L.divIcon({ className: '', html: `<div class="pin ${role}"><span>${i + 1}</span></div>`, iconSize: [size, size], iconAnchor: [size / 2, size + 2] }),
      draggable: true,
      autoPan: true,
      title: `${i + 1}. ${s.name}`,
      zIndexOffset: 1000 - i,
    });
    m.on('dragend', async () => {
      const { lat, lng } = m.getLatLng();
      Object.assign(s, { lat, lon: lng, snap: false, name: coordLabel(lat, lng), query: coordLabel(lat, lng), context: 'Punto spostato a mano', kind: '', candidates: [], crossing: null });
      if (s.pass) s.pass = { mode: 'auto', sides: null, up: 0, down: 0 };
      changed();
      const place = await reverseGeocode(lat, lng).catch(() => null);
      if (place && state.stops.includes(s) && s.lat === lat) {
        Object.assign(s, { name: place.name, query: place.name, context: place.context });
        changed({ recalc: false });
      }
    });
    m.on('click', () => focusRow(s));
    markersLayer.addLayer(m);
  });
}

function focusRow(stop) {
  const row = document.querySelector(`[data-id="${stop.id}"]`);
  if (row) row.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// Tocco sulla mappa: popup con il nome del punto e i pulsanti per aggiungerlo
map.on('click', (e) => {
  const { lat, lng } = e.latlng;
  const box = document.createElement('div');
  box.className = 'pop';
  box.innerHTML = '<div class="pop-name">Cerco il nome…</div><div class="pop-ctx"></div><div class="pop-actions"></div>';
  box.querySelector('.pop-ctx').textContent = coordLabel(lat, lng);
  let place = null;
  const popup = L.popup({ maxWidth: 270, minWidth: 230 }).setLatLng(e.latlng).setContent(box).openOn(map);

  const add = (where) => {
    const stop = placedStop(lat, lng, place ? place.name : null, { context: place ? place.context : '' });
    insertStop(stop, where);
    map.closePopup(popup);
    if (!place) {
      reverseGeocode(lat, lng)
        .then((p) => {
          if (p && state.stops.includes(stop)) {
            Object.assign(stop, { name: p.name, query: p.name, context: p.context });
            changed({ recalc: false });
          }
        })
        .catch(() => {});
    }
  };
  const actions = box.querySelector('.pop-actions');
  const button = (label, where, secondary) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `btn${secondary ? ' secondary' : ''}`;
    b.textContent = label;
    b.addEventListener('click', () => add(where));
    actions.appendChild(b);
  };
  const firstEmpty = state.stops.findIndex((s) => s.status === 'empty');
  const n = placed().length;
  if (firstEmpty >= 0) button(n === 0 ? 'Usa come partenza' : `Usa come tappa ${firstEmpty + 1}`, 'empty');
  else button(state.loop ? 'Aggiungi in fondo' : 'Aggiungi come arrivo', 'end');
  if (n >= 2) button('Inserisci tra le tappe', 'middle', true);

  reverseGeocode(lat, lng)
    .then((p) => {
      place = p;
      box.querySelector('.pop-name').textContent = p ? p.name : 'Punto sulla mappa';
      if (p && p.context) box.querySelector('.pop-ctx').textContent = p.context;
    })
    .catch(() => {
      box.querySelector('.pop-name').textContent = 'Punto sulla mappa';
    });
});

function insertStop(stop, where) {
  if (where === 'empty') {
    const i = state.stops.findIndex((s) => s.status === 'empty');
    if (i >= 0) {
      state.stops[i] = { ...stop, id: state.stops[i].id };
      changed();
      return;
    }
  }
  if (where === 'middle') {
    // posizione che allunga meno il giro, calcolata sulle tappe trovate
    const list = placed();
    const k = bestInsertionIndex(list.map((s) => [s.lat, s.lon]), [stop.lat, stop.lon], state.loop);
    const anchor = list[k];
    const idx = anchor ? state.stops.indexOf(anchor) : state.stops.length;
    state.stops.splice(idx, 0, stop);
    toast(`Inserita come tappa ${idx + 1}.`);
  } else {
    // in fondo, prima delle righe vuote finali
    let idx = state.stops.length;
    while (idx > 0 && state.stops[idx - 1].status === 'empty') idx--;
    state.stops.splice(idx, 0, stop);
  }
  changed();
}

function fitAll() {
  const pts = route ? route.parsed.shape : placed().map((s) => [s.lat, s.lon]);
  if (pts.length === 1) map.setView(pts[0], 11);
  else if (pts.length > 1) map.fitBounds(L.latLngBounds(pts), { padding: [30, 30] });
}

$('#btn-fit').addEventListener('click', fitAll);

$('#btn-expand').addEventListener('click', (e) => {
  const on = document.querySelector('.app').classList.toggle('map-expanded');
  e.currentTarget.setAttribute('aria-pressed', String(on));
  setTimeout(() => map.invalidateSize(), 250);
});

function locate() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('Questo browser non fornisce la posizione.'));
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve([pos.coords.latitude, pos.coords.longitude]),
      () => reject(new Error('Posizione non disponibile. Su iPhone consentila in Impostazioni › Privacy › Localizzazione › Safari.')),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  });
}

$('#btn-locate').addEventListener('click', async () => {
  try {
    const ll = await locate();
    if (locateMarker) locateMarker.remove();
    locateMarker = L.circleMarker(ll, { radius: 8, color: '#fff', weight: 3, fillColor: '#0a84ff', fillOpacity: 1 }).addTo(map);
    map.setView(ll, 13);
  } catch (err) {
    toast(err.message, true);
  }
});

// ---------------------------------------------------------------------------
// Elenco delle tappe
// ---------------------------------------------------------------------------

function placeholderFor(i) {
  if (i === 0) return 'Partenza';
  // una riga vuota dopo partenza e arrivo già scelti serve solo ad allungare il giro
  const placedBefore = state.stops.slice(0, i).filter(isPlaced).length;
  if (placedBefore >= 2) return 'Altra tappa (facoltativa)';
  if (i === state.stops.length - 1 && !state.loop) return 'Arrivo';
  return `Tappa ${i + 1}`;
}

function renderStops() {
  ensureRows();
  const list = $('#stops');
  const focused = document.activeElement && document.activeElement.closest('.stop');
  const focusId = focused ? Number(focused.dataset.id) : null;
  const caret = focused ? document.activeElement.selectionStart : null;
  list.textContent = '';
  state.stops.forEach((s, i) => list.appendChild(stopRow(s, i)));
  if (focusId) {
    const input = list.querySelector(`[data-id="${focusId}"] .stop-input`);
    if (input) {
      input.focus({ preventScroll: true });
      if (caret != null) input.setSelectionRange(caret, caret);
    }
  }
}

function stopRow(s, i) {
  const li = document.createElement('li');
  li.className = `stop ${s.status}`;
  li.dataset.id = s.id;
  const role = roleOf(s);
  li.innerHTML = `
    <span class="badge ${role}" aria-hidden="true">${i + 1}</span>
    <div class="stop-body">
      <input class="stop-input" type="text" enterkeyhint="${i === state.stops.length - 1 ? 'next' : 'search'}"
             autocomplete="off" autocorrect="off" spellcheck="false">
      <div class="stop-meta"></div>
    </div>
    <div class="stop-tools">
      <button type="button" class="icon-btn handle" aria-label="Trascina per spostare la tappa">${ICON.handle}</button>
      <button type="button" class="icon-btn del" aria-label="Elimina la tappa">${ICON.close}</button>
    </div>`;
  const input = li.querySelector('.stop-input');
  // la bozza (testo scritto ma non ancora confermato) sopravvive ai ridisegni
  input.value = s.draft ?? (s.status === 'ok' ? s.name : s.query);
  input.placeholder = placeholderFor(i);
  input.setAttribute('aria-label', `Tappa ${i + 1}: ${placeholderFor(i)}`);

  input.addEventListener('input', () => {
    s.draft = input.value;
  });
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    // Invio passa alla riga dopo; in fondo all'elenco ne apre una nuova.
    // Il fuoco si sposta subito, dentro il gesto, così la tastiera di iPhone resta aperta.
    const value = input.value;
    const idx = state.stops.indexOf(s);
    let target = state.stops[idx + 1];
    if (!target && value.trim()) {
      target = emptyStop();
      state.stops.push(target);
    }
    commit(s, value);
    if (target) {
      renderStops();
      focusInput(target);
    } else {
      input.blur();
    }
  });
  input.addEventListener('change', () => commit(s, input.value));
  input.addEventListener('blur', () => {
    setTimeout(() => {
      const active = document.activeElement && document.activeElement.closest('.stop');
      if (s.status === 'empty' && !s.draft && state.stops.length > 2 && state.stops.includes(s) && (!active || Number(active.dataset.id) !== s.id)) {
        state.stops.splice(state.stops.indexOf(s), 1);
        changed({ recalc: false });
      }
    }, 200);
  });
  input.addEventListener('paste', (e) => {
    const text = (e.clipboardData || window.clipboardData).getData('text');
    const parts = splitPlaces(text);
    if (parts.length < 2) return;
    e.preventDefault();
    pasteList(s, parts);
  });

  li.querySelector('.del').addEventListener('click', () => removeStop(s));
  enableDrag(li.querySelector('.handle'), li);
  renderMeta(li.querySelector('.stop-meta'), s, i, role);
  return li;
}

function focusInput(stop) {
  const input = document.querySelector(`[data-id="${stop.id}"] .stop-input`);
  if (input) input.focus();
}

function renderMeta(meta, s, i, role) {
  meta.textContent = '';
  const span = (cls, text) => {
    const el = document.createElement('span');
    if (cls) el.className = cls;
    el.textContent = text;
    meta.appendChild(el);
    return el;
  };
  if (s.status === 'searching') {
    span('spinner', '');
    span('', 'Cerco…');
    return;
  }
  if (s.status === 'notfound') {
    span('err', s.message);
    return;
  }
  if (s.status === 'empty') {
    if (i === 0 && !placed().length) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'link-btn';
      b.textContent = 'Usa la mia posizione';
      b.addEventListener('click', () => useMyPosition(s));
      meta.appendChild(b);
    }
    return;
  }
  if (s.kind) span('kind', s.kind);
  if (s.context) span('ctx', s.context);
  if (role === 'break' || role === 'through') {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = `chip ${role}`;
    chip.textContent = role === 'through' ? 'Passaggio' : 'Sosta';
    chip.title =
      role === 'through'
        ? 'Il percorso ci passa senza fermarsi né fare inversioni. Tocca per renderla una sosta.'
        : 'Il percorso si ferma qui e ne riparte. Tocca per renderla un semplice passaggio.';
    chip.addEventListener('click', () => {
      s.type = s.type === 'through' ? 'break' : 'through';
      changed();
    });
    meta.appendChild(chip);
  }
  if (s.pass && (role === 'break' || role === 'through')) renderPassMeta(meta, s);
  if (s.candidates.length > 1) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'link-btn';
    b.textContent = s.showAlts ? 'Chiudi' : `Non è questo? (${s.candidates.length - 1})`;
    b.addEventListener('click', () => {
      s.showAlts = !s.showAlts;
      renderStops();
    });
    meta.appendChild(b);
    if (s.showAlts) meta.after(altList(s));
  }
}

// ---------------------------------------------------------------------------
// Passi di montagna
// ---------------------------------------------------------------------------

const PASS_MODE_LABEL = { auto: 'Passo: automatico', full: 'Passo completo', half: 'Passo: andata e ritorno' };

function sideLabel(side) {
  const dir = compassLabel(side.bearing || 0);
  return side.place ? `${side.place} (${dir})` : `Versante ${dir}`;
}

function renderPassMeta(meta, s) {
  const p = s.pass;
  const chip = document.createElement('button');
  chip.type = 'button';
  chip.className = `chip pass${p.mode !== 'auto' ? ' on' : ''}`;
  chip.setAttribute('aria-expanded', String(!!s.passOpen));
  let text = PASS_MODE_LABEL[p.mode];
  if (p.mode !== 'auto' && p.sides && p.sides[p.up]) text += ` · da ${p.sides[p.up].place || compassLabel(p.sides[p.up].bearing)}`;
  chip.textContent = `⛰ ${text}`;
  chip.addEventListener('click', () => {
    s.passOpen = !s.passOpen;
    renderStops();
  });
  meta.appendChild(chip);
  // il percorso automatico sale e torna giù dallo stesso versante: lo si dice e si propone il passo completo
  if (p.mode === 'auto' && s.crossing === 'outandback') {
    const warn = document.createElement('span');
    warn.className = 'warn-text';
    warn.textContent = 'Il percorso sale e torna indietro dallo stesso versante.';
    meta.appendChild(warn);
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'link-btn';
    b.textContent = 'Fai il passo completo';
    b.addEventListener('click', () => {
      s.passOpen = true;
      setPassMode(s, 'full');
    });
    meta.appendChild(b);
  }
  // il pannello occupa tutta la larghezza della riga
  if (s.passOpen) meta.closest('.stop').appendChild(passPanel(s));
}

function segmented(name, items, current, onPick, wrap = true) {
  const box = document.createElement('div');
  box.className = `segmented${wrap ? ' wrap' : ' tight'}`;
  box.setAttribute('role', 'radiogroup');
  for (const [value, label] of items) {
    const l = document.createElement('label');
    l.innerHTML = `<input type="radio" name="${name}"><span></span>`;
    const input = l.querySelector('input');
    input.checked = value === current;
    l.querySelector('span').textContent = label;
    input.addEventListener('change', () => onPick(value));
    box.appendChild(l);
  }
  return box;
}

function passPanel(s) {
  const p = s.pass;
  const box = document.createElement('div');
  box.className = 'pass-panel';
  box.appendChild(
    segmented(`pass-mode-${s.id}`, [['auto', 'Automatico'], ['full', 'Completo'], ['half', 'Andata e ritorno']], p.mode, (m) => setPassMode(s, m), false),
  );
  const hint = document.createElement('p');
  hint.className = 'hint';
  hint.textContent = {
    auto: 'Il percorso sceglie da che parte salire e scendere in base alle tappe prima e dopo.',
    full: 'Sali da un versante e scendi dall\'altro: il giro attraversa davvero il passo.',
    half: 'Sali fino in cima e torni giù dallo stesso versante.',
  }[p.mode];
  box.appendChild(hint);
  if (p.mode === 'auto') return box;

  if (s.passStatus === 'loading') {
    const l = document.createElement('p');
    l.className = 'hint';
    l.innerHTML = '<span class="spinner"></span> Leggo le strade attorno al passo…';
    box.appendChild(l);
    return box;
  }
  if (s.passStatus === 'error' || !p.sides) {
    const e = document.createElement('p');
    e.className = 'hint err';
    e.textContent = s.passMessage || 'Versanti non ancora letti.';
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'link-btn';
    retry.textContent = 'Riprova';
    retry.addEventListener('click', () => loadPassSides(s));
    e.append(' ', retry);
    box.appendChild(e);
    return box;
  }
  const label = (t) => {
    const d = document.createElement('div');
    d.className = 'row-label';
    d.textContent = t;
    return d;
  };
  box.appendChild(label('Sali da'));
  box.appendChild(
    segmented(`pass-up-${s.id}`, p.sides.map((x, i) => [i, sideLabel(x)]), p.up, (i) => {
      p.up = i;
      if (p.down === i) p.down = oppositeSide(p.sides, i);
      changed();
    }),
  );
  if (p.mode === 'full') {
    box.appendChild(label('Scendi verso'));
    box.appendChild(
      segmented(`pass-down-${s.id}`, p.sides.map((x, i) => [i, sideLabel(x)]).filter(([i]) => i !== p.up), p.down, (i) => {
        p.down = i;
        changed();
      }),
    );
  }
  if (s.passMessage) {
    const m = document.createElement('p');
    m.className = 'hint';
    m.textContent = s.passMessage;
    box.appendChild(m);
  }
  return box;
}

function setPassMode(s, mode) {
  s.pass.mode = mode;
  s.passMessage = '';
  if (mode !== 'auto' && !s.pass.sides) {
    loadPassSides(s);
    return;
  }
  checkSides(s);
  changed();
}

/** Con un solo versante non si può attraversare: si passa ad andata e ritorno. */
function checkSides(s) {
  const p = s.pass;
  if (p.mode === 'full' && p.sides && p.sides.length < 2) {
    p.mode = 'half';
    s.passMessage = 'Dall\'altra parte non scende nessuna strada percorribile: impostato andata e ritorno.';
  }
}

async function loadPassSides(s) {
  s.passStatus = 'loading';
  changed({ recalc: false });
  try {
    const sides = await fetchPassSides(s.lat, s.lon);
    if (!state.stops.includes(s)) return;
    if (!sides.length) {
      s.passStatus = 'error';
      s.passMessage = 'Non trovo strade vicino alla cima: trascina il punto sulla strada del passo e riprova.';
    } else {
      const p = s.pass;
      p.sides = sides;
      // si sale dal versante rivolto verso la tappa precedente
      p.up = nearestSide(sides, nearPoint(s));
      p.down = sides.length > 1 ? oppositeSide(sides, p.up) : p.up;
      s.passStatus = 'ok';
      checkSides(s);
    }
  } catch (err) {
    s.passStatus = 'error';
    s.passMessage = err.message;
  }
  changed();
}

function altList(s) {
  const ul = document.createElement('ul');
  ul.className = 'alts';
  for (const c of s.candidates) {
    const li = document.createElement('li');
    if (c.lat === s.lat && c.lon === s.lon) li.className = 'current';
    li.innerHTML = '<div class="a-name"></div><div class="a-ctx"></div>';
    li.querySelector('.a-name').textContent = c.name;
    li.querySelector('.a-ctx').textContent = [c.kind, c.context].filter(Boolean).join(' · ');
    li.addEventListener('click', () => {
      applyCandidate(s, c);
      s.showAlts = false;
      changed();
      map.setView([c.lat, c.lon], Math.max(map.getZoom(), 10));
    });
    ul.appendChild(li);
  }
  return ul;
}

function applyCandidate(s, c) {
  Object.assign(s, {
    lat: c.lat,
    lon: c.lon,
    name: c.name,
    query: c.name,
    context: c.context,
    kind: c.kind,
    snap: snapsToRoad(c.category),
    status: 'ok',
    message: '',
    passOpen: false,
    crossing: null,
  });
  // per i passi si può scegliere come farli (completo, andata e ritorno)
  if (c.category === 'pass') s.pass = { mode: 'auto', sides: null, up: 0, down: 0 };
  else delete s.pass;
}

/** Coordinate della tappa trovata più vicina prima (o dopo) di questa: aiuta a scegliere tra omonimi. */
function nearPoint(stop) {
  const i = state.stops.indexOf(stop);
  for (let k = i - 1; k >= 0; k--) if (isPlaced(state.stops[k])) return [state.stops[k].lat, state.stops[k].lon];
  for (let k = i + 1; k < state.stops.length; k++) if (isPlaced(state.stops[k])) return [state.stops[k].lat, state.stops[k].lon];
  return null;
}

async function commit(stop, text) {
  stop.draft = null;
  const q = String(text || '').trim();
  if (stop.status === 'ok' && q === stop.name) return; // niente di cambiato
  if (stop.status === 'searching' && q === stop.query) return;
  if (!q) {
    Object.assign(stop, emptyStop(), { id: stop.id, type: stop.type });
    changed();
    return;
  }
  const parts = splitPlaces(q);
  if (parts.length > 1) return pasteList(stop, parts);
  await resolveStop(stop, q);
}

async function resolveStop(stop, q) {
  Object.assign(stop, { query: q, status: 'searching', message: '', candidates: [], showAlts: false, lat: null, lon: null });
  changed();
  try {
    const found = await searchPlaces(q, { near: nearPoint(stop) });
    if (!state.stops.includes(stop) || stop.query !== q) return; // la riga è cambiata nel frattempo
    if (!found.length) {
      Object.assign(stop, { status: 'notfound', message: `«${q}» non trovato. Controlla il nome o aggiungi comune o provincia (es. «Gavia, Sondrio»).` });
    } else {
      applyCandidate(stop, found[0]);
      stop.candidates = found;
    }
  } catch (err) {
    if (!state.stops.includes(stop)) return;
    Object.assign(stop, { status: 'notfound', message: err.message });
  }
  changed();
  if (isPlaced(stop) && placed().length === 1) map.setView([stop.lat, stop.lon], 10);
}

/** Un elenco incollato in una riga diventa più righe, cercate in ordine. */
async function pasteList(stop, parts) {
  const i = state.stops.indexOf(stop);
  const rows = parts.map((p) => ({ ...emptyStop(), query: p }));
  // la riga di partenza e le righe vuote subito dopo vengono sostituite
  let end = i + 1;
  while (end < state.stops.length && state.stops[end].status === 'empty') end++;
  state.stops.splice(i, end - i, ...rows);
  changed();
  for (const r of rows) {
    if (!state.stops.includes(r)) continue;
    await resolveStop(r, r.query);
  }
  fitAll();
}

async function useMyPosition(stop) {
  try {
    Object.assign(stop, { status: 'searching', query: 'La mia posizione' });
    changed({ recalc: false });
    const [lat, lon] = await locate();
    const place = await reverseGeocode(lat, lon).catch(() => null);
    Object.assign(stop, placedStop(lat, lon, place ? place.name : 'La mia posizione', { context: place ? place.context : '', kind: 'Posizione attuale' }), { id: stop.id });
    changed();
    map.setView([lat, lon], 11);
  } catch (err) {
    Object.assign(stop, { ...emptyStop(), id: stop.id });
    changed({ recalc: false });
    toast(err.message, true);
  }
}

function removeStop(stop) {
  const i = state.stops.indexOf(stop);
  if (i < 0) return;
  if (state.stops.length <= 2) state.stops[i] = emptyStop();
  else state.stops.splice(i, 1);
  changed();
}

/** Riordino trascinando la maniglia (mouse e dita). */
function enableDrag(handle, li) {
  handle.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const list = li.parentNode;
    li.classList.add('dragging');
    const grab = e.clientY - li.getBoundingClientRect().top;
    // si spostano le righe vicine, mai quella trascinata: se esce dal DOM il browser perde il dito
    const move = (ev) => {
      const y = ev.clientY;
      const prev = li.previousElementSibling;
      const next = li.nextElementSibling;
      if (prev && y < prev.getBoundingClientRect().top + prev.offsetHeight / 2) list.insertBefore(prev, li.nextSibling);
      else if (next && y > next.getBoundingClientRect().top + next.offsetHeight / 2) list.insertBefore(next, li);
      li.style.transform = 'none';
      const natural = li.getBoundingClientRect().top;
      li.style.transform = `translateY(${y - grab - natural}px)`;
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      li.classList.remove('dragging');
      li.style.transform = '';
      const order = [...list.children].map((c) => Number(c.dataset.id));
      const before = state.stops.map((s) => s.id).join();
      state.stops.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
      if (state.stops.map((s) => s.id).join() !== before) changed();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  });
}

// ---------------------------------------------------------------------------
// Elenco intero: tutte le località in una casella, una per riga
// ---------------------------------------------------------------------------

const STORAGE_VIEW = 'tracceMoto.vista';

function showView(view) {
  const list = view === 'list';
  $('#list-editor').hidden = !list;
  $('#rows-view').hidden = list;
  for (const t of document.querySelectorAll('.tab')) t.setAttribute('aria-selected', String(t.dataset.view === view));
  try {
    localStorage.setItem(STORAGE_VIEW, view);
  } catch {
    // non importante
  }
  if (list) {
    // l'elenco parte dalle tappe attuali
    const names = state.stops.filter((x) => x.status !== 'empty').map((x) => (x.status === 'ok' ? x.name : x.query));
    $('#list-input').value = names.join('\n');
  }
}

document.querySelectorAll('.tab').forEach((t) =>
  t.addEventListener('click', () => {
    showView(t.dataset.view);
    if (t.dataset.view === 'list') $('#list-input').focus();
  }),
);

$('#btn-list-apply').addEventListener('click', async () => {
  const parts = splitPlaces($('#list-input').value);
  if (!parts.length) return toast('Scrivi almeno una località, una per riga.', true);
  // le tappe già trovate con lo stesso nome si riusano (niente nuova ricerca, scelte sui passi comprese)
  const pool = state.stops.filter(isPlaced);
  const same = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase();
  const rows = parts.map((p) => {
    const k = pool.findIndex((x) => same(x.name, p) || same(x.query, p));
    return k >= 0 ? pool.splice(k, 1)[0] : { ...emptyStop(), query: p };
  });
  state.stops = rows;
  showView('rows');
  changed();
  for (const r of rows) {
    if (r.status === 'ok' || !state.stops.includes(r)) continue;
    await resolveStop(r, r.query);
  }
  fitAll();
  const missing = state.stops.filter((x) => x.status === 'notfound').length;
  if (missing) toast(`${missing === 1 ? 'Una località non è stata trovata' : `${missing} località non sono state trovate`}: correggile nell'elenco delle tappe.`, true);
});

$('#btn-add').addEventListener('click', () => {
  const row = emptyStop();
  state.stops.push(row);
  renderStops();
  focusInput(row);
});

$('#btn-new').addEventListener('click', () => {
  if (placed().length && !confirm('Iniziare un nuovo giro? Le tappe attuali verranno cancellate (salva prima il giro se ti serve).')) return;
  state.stops = [];
  state.name = '';
  $('#trip-name').value = '';
  changed();
  focusInput(state.stops[0]);
});

// ---------------------------------------------------------------------------
// Preferenze
// ---------------------------------------------------------------------------

function prefsSummary() {
  const o = state.options;
  const hw = o.highways === 0 ? 'Senza autostrade' : o.highways === 0.5 ? 'Autostrade se servono' : 'Autostrade sì';
  const parts = [hw, o.shortest ? 'più corto' : 'più veloce'];
  if (o.avoidUnpaved) parts.push('niente sterrato');
  if (o.avoidTolls) parts.push('niente pedaggi');
  if (o.avoidFerries) parts.push('niente traghetti');
  return parts.join(' · ');
}

function bindOptions() {
  document.querySelectorAll('input[name="highways"]').forEach((r) =>
    r.addEventListener('change', () => {
      state.options.highways = Number(r.value);
      changed();
    }),
  );
  document.querySelectorAll('input[name="shortest"]').forEach((r) =>
    r.addEventListener('change', () => {
      state.options.shortest = r.value === '1';
      changed();
    }),
  );
  const toggles = { '#opt-tolls': 'avoidTolls', '#opt-ferries': 'avoidFerries', '#opt-unpaved': 'avoidUnpaved' };
  for (const [sel, key] of Object.entries(toggles)) {
    $(sel).addEventListener('change', (e) => {
      state.options[key] = e.target.checked;
      changed();
    });
  }
  $('#opt-loop').addEventListener('change', (e) => {
    state.loop = e.target.checked;
    changed();
  });
  $('#trip-name').addEventListener('input', (e) => {
    state.name = e.target.value;
    changed({ recalc: false });
  });
  $('#trip-name').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') e.target.blur();
  });
}

function syncControls() {
  $('#trip-name').value = state.name;
  $('#opt-loop').checked = state.loop;
  $('#opt-tolls').checked = state.options.avoidTolls;
  $('#opt-ferries').checked = state.options.avoidFerries;
  $('#opt-unpaved').checked = state.options.avoidUnpaved;
  for (const r of document.querySelectorAll('input[name="highways"]')) r.checked = Number(r.value) === state.options.highways;
  for (const r of document.querySelectorAll('input[name="shortest"]')) r.checked = (r.value === '1') === state.options.shortest;
}

// ---------------------------------------------------------------------------
// Calcolo del percorso
// ---------------------------------------------------------------------------

function currentKey() {
  const pass = (s) => (s.pass && s.pass.sides ? [s.pass.mode, s.pass.up, s.pass.down] : 0);
  return JSON.stringify([placed().map((s) => [s.lat, s.lon, s.type, s.snap, pass(s)]), state.loop, state.options]);
}

/** Tappe da mandare al calcolo: i passi completi o in andata e ritorno aggiungono i punti dei versanti. */
function routeStops() {
  return expandStops(placed(), state.loop);
}

/** Tappe da esportare: come quelle calcolate, senza i punti ausiliari dei versanti. */
function exportStops() {
  return routeStops().filter((s) => !s.aux);
}

/** Da chiamare a ogni modifica. */
function changed({ recalc = true } = {}) {
  renderStops();
  renderMarkers();
  $('#prefs-summary').textContent = prefsSummary();
  persist();
  renderResult();
  if (recalc) scheduleRecalc();
}

function scheduleRecalc() {
  clearTimeout(recalcTimer);
  const key = currentKey();
  if (key === routeKey && route) return;
  if (placed().length < 2) {
    if (recalcAbort) recalcAbort.abort();
    recalcSeq++;
    clearRoute();
    setStatus('');
    return;
  }
  setStatus('Calcolo del percorso…', 'busy');
  recalcTimer = setTimeout(recalc, RECALC_DELAY);
}

async function recalc() {
  if (recalcAbort) recalcAbort.abort();
  const ctrl = new AbortController();
  recalcAbort = ctrl;
  const seq = ++recalcSeq;
  const key = currentKey();
  const stops = routeStops().map((s) => ({ ...s }));
  const loop = state.loop;
  showMapStatus('Calcolo…');
  try {
    const res = await fetchRoute(stops, loop, state.options, ctrl.signal);
    if (seq !== recalcSeq) return;
    route = { parsed: parseTrip(res.trip), costing: res.costing, warning: res.warning, stops, loop };
    routeKey = key;
    setStatus(res.warning || '', res.warning ? 'warn' : '');
    checkCrossings();
    renderResult();
    drawRoute();
  } catch (err) {
    if (err.name === 'AbortError' || seq !== recalcSeq) return;
    clearRoute();
    setStatus(explainValhallaError(err, stops), 'error');
  } finally {
    if (seq === recalcSeq) showMapStatus('');
  }
}

/** Per ogni passo: il percorso lo attraversa o torna indietro dallo stesso versante? */
function checkCrossings() {
  const shape = route.parsed.shape;
  const cum = cumulativeDistances(shape);
  for (const s of placed()) if (s.pass) s.crossing = passCrossing(shape, [s.lat, s.lon], cum);
  renderStops();
}

function clearRoute() {
  for (const s of state.stops) s.crossing = null;
  route = null;
  routeKey = '';
  routeLine.setLatLngs([]);
  routeCasing.setLatLngs([]);
  if (maneuverMarker) maneuverMarker.remove();
  renderResult();
}

function drawRoute() {
  routeLine.setLatLngs(route.parsed.shape);
  routeCasing.setLatLngs(route.parsed.shape);
  const b = routeLine.getBounds();
  if (b.isValid() && !map.getBounds().contains(b)) map.fitBounds(b, { padding: [30, 30] });
}

function setStatus(text, kind = '') {
  const el = $('#route-status');
  el.textContent = text;
  el.className = `status ${kind}`;
  $('#result-empty').hidden = !!route || !!text;
  updateDock();
}

function updateDock() {
  if (route && routeKey === currentKey()) setDock('ready');
  else if (placed().length < 2) setDock('idle');
  else if ($('#route-status').classList.contains('error')) setDock('error');
  else setDock('busy');
}

function showMapStatus(text) {
  const el = $('#map-status');
  el.textContent = text;
  el.hidden = !text;
}

function setDock(mode) {
  const ready = mode === 'ready';
  $('#btn-tbt-dl').disabled = !ready;
  $('#btn-tbt-share').disabled = !ready;
  if (ready) {
    $('#dock-km').textContent = formatKm(route.parsed.summary.length);
    $('#dock-time').textContent = `${formatDuration(route.parsed.summary.time)} · ${turnByTurnInstructions(route.parsed).length} indicazioni`;
  } else if (mode === 'busy') {
    $('#dock-km').textContent = '…';
    $('#dock-time').textContent = 'Calcolo del percorso';
  } else if (mode === 'error') {
    $('#dock-km').textContent = '–';
    $('#dock-time').textContent = 'Percorso non calcolato';
  } else {
    const missing = 2 - placed().length;
    $('#dock-km').textContent = '–';
    $('#dock-time').textContent = missing > 0 ? (missing === 2 ? 'Scrivi partenza e arrivo' : 'Manca ancora una tappa') : '';
  }
}

/** Nomi delle tratte: una tratta va da una tappa "sosta" alla successiva. */
function legNames(r) {
  const locs = routeLocations(r.stops, r.loop);
  const names = locs.map((_, i) => (i < r.stops.length ? r.stops[i].name : r.stops[0].name));
  const breaks = locs.map((l, i) => (l.type === 'break' ? i : -1)).filter((i) => i >= 0);
  const out = [];
  for (let k = 1; k < breaks.length; k++) {
    out.push({ from: short(names[breaks[k - 1]]), to: short(names[breaks[k]]), via: breaks[k] - breaks[k - 1] - 1 });
  }
  return out;
}

function short(name) {
  return String(name).split(',')[0];
}

function renderResult() {
  const has = !!route;
  $('#route-summary').hidden = !has;
  $('#result-empty').hidden = has || !!$('#route-status').textContent;
  for (const id of ['#btn-track-dl', '#btn-track-share', '#btn-route-dl', '#btn-route-share']) $(id).disabled = !has;
  $('#route-count').textContent = '';
  updateDock();
  if (!has) return;
  const p = route.parsed;

  // dopo una rinomina il percorso non cambia, ma i nomi sì
  const names = legNames(routeKey === currentKey() ? { ...route, stops: routeStops() } : route);
  const legs = $('#legs');
  legs.textContent = '';
  p.legs.forEach((leg, i) => {
    const li = document.createElement('li');
    const n = names[i];
    li.innerHTML = '<span class="leg-name"></span><span class="leg-num"></span>';
    li.querySelector('.leg-name').textContent = n ? `${n.from} → ${n.to}${n.via ? ` (via ${n.via} passaggi${n.via === 1 ? 'o' : ''})` : ''}` : `Tratta ${i + 1}`;
    li.querySelector('.leg-num').textContent = `${formatKm(leg.length)} · ${formatDuration(leg.time)}`;
    legs.appendChild(li);
  });
  if (p.legs.length > 1) {
    const li = document.createElement('li');
    li.innerHTML = '<span class="leg-name"><b>Totale</b></span><span class="leg-num"></span>';
    li.querySelector('.leg-num').textContent = `${formatKm(p.summary.length)} · ${formatDuration(p.summary.time)}`;
    legs.appendChild(li);
  }

  const pts = buildRoutePoints(p, route.stops.filter((x) => !x.aux), route.loop);
  const shaping = pts.filter((x) => x.kind === 'shaping').length;
  $('#route-count').textContent = `${pts.length} punti (${pts.length - shaping} tappe e ${shaping} di passaggio).`;

  $('#roadbook-title').textContent = `Indicazioni svolta per svolta (${p.maneuvers.length})`;
  const rb = $('#roadbook');
  rb.textContent = '';
  const frag = document.createDocumentFragment();
  for (const m of p.maneuvers) {
    const li = document.createElement('li');
    li.innerHTML = '<span class="km"></span><span class="txt"></span>';
    li.querySelector('.km').textContent = `${m.km.toFixed(1).replace('.', ',')} km`;
    li.querySelector('.txt').textContent = m.instruction;
    li.addEventListener('click', () => showManeuver(m));
    frag.appendChild(li);
  }
  rb.appendChild(frag);
}

function showManeuver(m) {
  const ll = route.parsed.shape[m.begin];
  if (maneuverMarker) maneuverMarker.remove();
  maneuverMarker = L.marker(ll, {
    icon: L.divIcon({ className: '', html: '<div class="maneuver-dot"></div>', iconSize: [16, 16], iconAnchor: [8, 8] }),
    interactive: false,
  }).addTo(map);
  map.setView(ll, Math.max(map.getZoom(), 15));
  document.querySelector('.map-wrap').scrollIntoView({ behavior: 'smooth' });
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

/** Il GPX deve corrispondere alle tappe con cui è stato calcolato il percorso. */
function exportReady() {
  if (!route) return false;
  if (routeKey !== currentKey()) {
    toast('Il percorso si sta aggiornando: aspetta la fine del calcolo e riprova.', true);
    return false;
  }
  return true;
}

function gpxFile(kind) {
  const name = tripName();
  const now = new Date();
  // nomi aggiornati delle tappe (possono essere cambiati dopo il calcolo)
  const stops = exportStops().map((s) => ({ ...s }));
  const opts = { name, stops, loop: route.loop, parsed: route.parsed, time: now };
  if (kind === 'turn-by-turn') return { xml: buildTurnByTurnGpx(opts).xml, filename: gpxFileName(name, now, 'turn-by-turn') };
  if (kind === 'traccia') return { xml: buildTrackGpx(opts), filename: gpxFileName(name, now, 'traccia') };
  return { xml: buildRouteGpx({ ...opts, name: `${name} (rotta)` }).xml, filename: gpxFileName(name, now, 'rotta') };
}

function download({ xml, filename }) {
  const blob = new Blob([xml], { type: 'application/gpx+xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  toast(`Scaricato «${filename}».`);
}

async function share(f) {
  const file = new File([f.xml], f.filename, { type: 'application/gpx+xml' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: f.filename });
    } catch (err) {
      if (err.name !== 'AbortError') {
        toast('Invio non riuscito: scarico il file.', true);
        download(f);
      }
    }
    return;
  }
  download(f); // il browser non può condividere file
}

const exportButtons = {
  '#btn-tbt-dl': ['turn-by-turn', download],
  '#btn-tbt-share': ['turn-by-turn', share],
  '#btn-track-dl': ['traccia', download],
  '#btn-track-share': ['traccia', share],
  '#btn-route-dl': ['rotta', download],
  '#btn-route-share': ['rotta', share],
};
for (const [sel, [kind, action]] of Object.entries(exportButtons)) {
  $(sel).addEventListener('click', () => exportReady() && action(gpxFile(kind)));
}

$('#btn-copy-roadbook').addEventListener('click', async () => {
  if (!route) return;
  const text = roadbookText(tripName(), route.parsed, placed());
  if (await copyText(text)) toast('Indicazioni copiate.');
  else toast('Copia non riuscita: tieni premuto sul testo per copiarlo a mano.', true);
});

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    ta.remove();
    return ok;
  }
}

// ---------------------------------------------------------------------------
// Salvataggio: localStorage e link
// ---------------------------------------------------------------------------

function snapshot() {
  return {
    name: state.name,
    loop: state.loop,
    options: { ...state.options },
    stops: placed().map(({ lat, lon, name, type, snap, context, kind, pass }) => ({ lat, lon, name, type, snap, context, kind, ...(pass ? { pass } : {}) })),
  };
}

function applySnapshot(s) {
  state.name = s.name || '';
  state.loop = !!s.loop;
  state.options = { ...DEFAULT_OPTIONS, ...(s.options || {}) };
  state.stops = (s.stops || []).map((x) =>
    placedStop(x.lat, x.lon, x.name, {
      type: x.type === 'through' ? 'through' : 'break',
      snap: !!x.snap,
      context: x.context || '',
      kind: x.kind || (x.pass ? 'Passo' : ''),
      ...(x.pass ? { pass: { mode: x.pass.mode || 'auto', sides: x.pass.sides || null, up: x.pass.up || 0, down: x.pass.down || 0 } } : {}),
    }),
  );
  syncControls();
  clearRoute();
  changed();
  fitAll();
}

function readJson(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function shareHash() {
  return `#g=${encodeState(snapshot())}`;
}

function persist() {
  writeJson(STORAGE_CURRENT, snapshot());
  const hash = placed().length ? shareHash() : '';
  if (location.hash !== hash) history.replaceState(null, '', hash || location.pathname + location.search);
}

function savedTrips() {
  const list = readJson(STORAGE_TRIPS, []);
  return Array.isArray(list) ? list : [];
}

function renderSaved() {
  const list = savedTrips().sort((a, b) => b.savedAt - a.savedAt);
  const ul = $('#saved');
  ul.textContent = '';
  $('#saved-summary').textContent = list.length
    ? `${list.length} ${list.length === 1 ? 'giro salvato' : 'giri salvati'} su questo dispositivo`
    : 'Salva o apri il giro su un altro dispositivo';
  for (const t of list) {
    const li = document.createElement('li');
    li.innerHTML = `
      <div class="s-text"><div class="s-name"></div><div class="s-meta"></div></div>
      <button type="button" class="btn small secondary" data-act="load">Apri</button>
      <button type="button" class="icon-btn del" data-act="del" aria-label="Elimina giro salvato">${ICON.close}</button>`;
    li.querySelector('.s-name').textContent = t.name;
    const d = new Date(t.savedAt);
    li.querySelector('.s-meta').textContent = `${t.state.stops.length} tappe · ${d.toLocaleDateString('it-IT')}`;
    const open = () => {
      if (placed().length && !confirm(`Aprire «${t.name}»? Il giro attuale verrà sostituito.`)) return;
      applySnapshot(t.state);
      toast(`Giro «${t.name}» aperto.`);
    };
    li.querySelector('.s-text').addEventListener('click', open);
    li.querySelector('[data-act="load"]').addEventListener('click', open);
    li.querySelector('[data-act="del"]').addEventListener('click', () => {
      if (!confirm(`Eliminare il giro salvato «${t.name}»?`)) return;
      writeJson(STORAGE_TRIPS, savedTrips().filter((x) => x.id !== t.id));
      renderSaved();
    });
    ul.appendChild(li);
  }
}

$('#btn-save').addEventListener('click', () => {
  if (!placed().length) return toast('Aggiungi almeno una tappa prima di salvare.', true);
  const name = tripName();
  const list = savedTrips();
  const existing = list.find((t) => t.name === name);
  if (existing && !confirm(`Esiste già un giro chiamato «${name}». Sovrascriverlo?`)) return;
  const entry = { id: existing ? existing.id : `${Date.now()}`, name, savedAt: Date.now(), state: snapshot() };
  const next = existing ? list.map((t) => (t.id === existing.id ? entry : t)) : [...list, entry];
  if (!writeJson(STORAGE_TRIPS, next)) return toast('Salvataggio non riuscito: la memoria del browser è piena o disattivata (navigazione privata?).', true);
  renderSaved();
  toast(`Giro «${name}» salvato.`);
});

$('#btn-share-link').addEventListener('click', async () => {
  if (!placed().length) return toast('Aggiungi almeno una tappa per creare il link.', true);
  const url = `${location.origin}${location.pathname}${shareHash()}`;
  if (navigator.share) {
    try {
      await navigator.share({ title: tripName(), url });
      return;
    } catch (err) {
      if (err.name === 'AbortError') return;
    }
  }
  if (await copyText(url)) toast('Link copiato: aprilo sull\'altro dispositivo.');
  else prompt('Copia questo link:', url);
});

function loadFromHash() {
  if (!location.hash.startsWith('#g=')) return false;
  try {
    applySnapshot(decodeState(location.hash));
    return true;
  } catch {
    toast('Il link del giro non è valido o è incompleto. Fatti rimandare il link completo.', true);
    return false;
  }
}

window.addEventListener('hashchange', () => {
  // incollare un nuovo link nella stessa scheda
  if (location.hash.startsWith('#g=') && location.hash !== shareHash()) loadFromHash();
});

// ---------------------------------------------------------------------------
// Messaggi
// ---------------------------------------------------------------------------

let toastTimer = null;
function toast(text, isError = false) {
  const el = $('#toast');
  el.textContent = text;
  el.className = `toast${isError ? ' error' : ''}`;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), isError ? 6000 : 3000);
}
$('#toast').addEventListener('click', () => ($('#toast').hidden = true));

// ---------------------------------------------------------------------------
// Avvio
// ---------------------------------------------------------------------------

bindOptions();
renderSaved();
if (!loadFromHash()) {
  const saved = readJson(STORAGE_CURRENT, null);
  if (saved && Array.isArray(saved.stops) && saved.stops.length) applySnapshot(saved);
  else {
    syncControls();
    changed({ recalc: false });
  }
}
// vista ricordata (dopo aver caricato il giro, così l'elenco parte dalle tappe)
try {
  if (localStorage.getItem(STORAGE_VIEW) === 'list') showView('list');
} catch {
  // vista predefinita: tappe
}
