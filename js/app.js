// Tracce Moto — interfaccia: mappa, tappe, calcolo, export e salvataggi.
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
} from './core.js';
import { fetchRoute, searchPlaces, reverseGeocode } from './services.js';

const L = window.L;
const $ = (sel) => document.querySelector(sel);
const STORAGE_TRIPS = 'tracceMoto.giri';
const STORAGE_CURRENT = 'tracceMoto.corrente';
const RECALC_DELAY = 600;

// ---------------------------------------------------------------------------
// Stato
// ---------------------------------------------------------------------------

let nextId = 1;
const state = {
  name: '',
  stops: [], // { id, lat, lon, name, type: 'break'|'through', custom }
  loop: false,
  options: { ...DEFAULT_OPTIONS },
  insertMode: 'end',
};

let route = null; // { parsed, costing, warning, key }
let routeKey = '';
let recalcTimer = null;
let recalcAbort = null;
let recalcSeq = 0;

function makeStop(lat, lon, name, extra = {}) {
  return { id: nextId++, lat, lon, name: name || coordLabel(lat, lon), type: 'break', custom: false, ...extra };
}

function coordLabel(lat, lon) {
  return `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
}

function tripName() {
  return state.name.trim() || defaultTripName(state.stops, state.loop);
}

// ---------------------------------------------------------------------------
// Mappa
// ---------------------------------------------------------------------------

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

const map = L.map('map', { zoomControl: true, layers: [osm] }).setView([45.2, 11.5], 6);
L.control.layers({ OpenStreetMap: osm, OpenTopoMap: topo }, null, { position: 'topright' }).addTo(map);
L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(map);

const routeCasing = L.polyline([], { color: getCss('--route-casing'), weight: 9, opacity: 0.9, interactive: false }).addTo(map);
const routeLine = L.polyline([], { color: getCss('--route'), weight: 5, opacity: 0.95, interactive: false }).addTo(map);
const markersLayer = L.layerGroup().addTo(map);
let maneuverMarker = null;
let locateMarker = null;

function getCss(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#0a6ccf';
}

function stopRole(i) {
  if (i === 0) return 'start';
  if (i === state.stops.length - 1 && !state.loop && state.stops.length > 1) return 'end';
  return state.stops[i].type === 'through' ? 'through' : 'break';
}

function stopIcon(i) {
  const role = stopRole(i);
  const size = role === 'through' ? 26 : 32;
  return L.divIcon({
    className: '',
    html: `<div class="pin ${role}"><span>${i + 1}</span></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size + 2],
    popupAnchor: [0, -size],
  });
}

function renderMarkers() {
  markersLayer.clearLayers();
  state.stops.forEach((s, i) => {
    const m = L.marker([s.lat, s.lon], {
      icon: stopIcon(i),
      draggable: true,
      autoPan: true,
      title: `${i + 1}. ${s.name}`,
      zIndexOffset: 1000 - i,
    });
    m.on('dragend', () => {
      const { lat, lng } = m.getLatLng();
      s.lat = lat;
      s.lon = lng;
      if (!s.custom) {
        s.name = coordLabel(lat, lng);
        nameFromMap(s);
      }
      changed();
    });
    m.on('click', () => {
      const row = document.querySelector(`[data-stop-id="${s.id}"]`);
      if (row) row.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    markersLayer.addLayer(m);
  });
}

async function nameFromMap(stop) {
  try {
    const name = await reverseGeocode(stop.lat, stop.lon);
    // il punto potrebbe essere stato rinominato o eliminato nel frattempo
    if (name && !stop.custom && state.stops.includes(stop)) {
      stop.name = name;
      renderStops();
      renderMarkers();
      persist();
    }
  } catch {
    // il nome resta quello con le coordinate: non è un errore bloccante
  }
}

// Tocco sulla mappa: popup con nome e pulsante "Aggiungi"
map.on('click', (e) => {
  const { lat, lng } = e.latlng;
  const box = document.createElement('div');
  box.className = 'pop';
  box.innerHTML = `
    <div class="pop-name">Cerco il nome…</div>
    <div class="pop-coords">${coordLabel(lat, lng)}</div>
    <button type="button" class="btn"></button>`;
  const btn = box.querySelector('button');
  btn.textContent = addButtonLabel();
  let name = null;
  const popup = L.popup({ maxWidth: 260, minWidth: 220 }).setLatLng(e.latlng).setContent(box).openOn(map);
  btn.addEventListener('click', () => {
    const stop = makeStop(lat, lng, name);
    addStop(stop);
    map.closePopup(popup);
    if (!name) nameFromMap(stop); // il nome non era ancora arrivato
  });
  reverseGeocode(lat, lng)
    .then((n) => {
      name = n;
      box.querySelector('.pop-name').textContent = n || 'Punto sulla mappa';
    })
    .catch(() => {
      box.querySelector('.pop-name').textContent = 'Punto sulla mappa';
    });
});

function addButtonLabel() {
  if (state.stops.length === 0) return 'Aggiungi come partenza';
  if (state.insertMode === 'middle' && state.stops.length >= 2) return 'Aggiungi come intermedia';
  return state.stops.length === 1 && !state.loop ? 'Aggiungi come arrivo' : 'Aggiungi in fondo';
}

function fitAll() {
  const pts = route ? route.parsed.shape : state.stops.map((s) => [s.lat, s.lon]);
  if (pts.length === 1) map.setView(pts[0], 12);
  else if (pts.length > 1) map.fitBounds(L.latLngBounds(pts), { padding: [30, 30] });
}

$('#btn-fit').addEventListener('click', fitAll);

$('#btn-expand').addEventListener('click', (e) => {
  const on = document.querySelector('.app').classList.toggle('map-expanded');
  e.currentTarget.setAttribute('aria-pressed', String(on));
  setTimeout(() => map.invalidateSize(), 250);
});

$('#btn-locate').addEventListener('click', () => {
  if (!navigator.geolocation) return toast('Questo browser non fornisce la posizione.', true);
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const ll = [pos.coords.latitude, pos.coords.longitude];
      if (locateMarker) locateMarker.remove();
      locateMarker = L.circleMarker(ll, { radius: 8, color: '#fff', weight: 3, fillColor: '#0a84ff', fillOpacity: 1 }).addTo(map);
      map.setView(ll, 13);
    },
    () => toast('Posizione non disponibile. Su iPhone consentila in Impostazioni › Privacy › Localizzazione › Safari.', true),
    { enableHighAccuracy: true, timeout: 10000 },
  );
});

// ---------------------------------------------------------------------------
// Tappe
// ---------------------------------------------------------------------------

function addStop(stop) {
  const n = state.stops.length;
  if (state.insertMode === 'middle' && n >= 2) {
    const idx = bestInsertionIndex(
      state.stops.map((s) => [s.lat, s.lon]),
      [stop.lat, stop.lon],
      state.loop,
    );
    state.stops.splice(idx, 0, stop);
    toast(`Aggiunta come tappa ${idx + 1}.`);
  } else {
    state.stops.push(stop);
  }
  changed();
  if (state.stops.length <= 2) fitAll();
}

function moveStop(i, delta) {
  const j = i + delta;
  if (j < 0 || j >= state.stops.length) return;
  [state.stops[i], state.stops[j]] = [state.stops[j], state.stops[i]];
  changed();
}

function removeStop(i) {
  state.stops.splice(i, 1);
  changed();
}

function renderStops() {
  const list = $('#stops');
  list.textContent = '';
  $('#stops-empty').hidden = state.stops.length > 0;
  state.stops.forEach((s, i) => {
    const role = stopRole(i);
    const li = document.createElement('li');
    li.className = 'stop';
    li.dataset.stopId = s.id;
    const roleText =
      role === 'start' ? 'Partenza' : role === 'end' ? 'Arrivo' : state.loop && i === state.stops.length - 1 && i > 0 ? 'Ultima tappa prima del ritorno' : 'Tappa intermedia';
    const canType = role === 'break' || role === 'through';
    li.innerHTML = `
      <div class="stop-main">
        <span class="badge ${role}" aria-hidden="true">${i + 1}</span>
        <input type="text" aria-label="Nome della tappa ${i + 1}" maxlength="80">
        <button type="button" class="icon-btn" data-act="up" aria-label="Sposta su" ${i === 0 ? 'disabled' : ''}>↑</button>
        <button type="button" class="icon-btn" data-act="down" aria-label="Sposta giù" ${i === state.stops.length - 1 ? 'disabled' : ''}>↓</button>
        <button type="button" class="icon-btn del" data-act="del" aria-label="Elimina tappa">✕</button>
      </div>
      <div class="stop-tools">
        ${
          canType
            ? `<div class="segmented" role="radiogroup" aria-label="Tipo della tappa ${i + 1}">
                <label><input type="radio" name="type-${s.id}" value="break" ${s.type !== 'through' ? 'checked' : ''}><span>Sosta</span></label>
                <label><input type="radio" name="type-${s.id}" value="through" ${s.type === 'through' ? 'checked' : ''}><span>Passaggio</span></label>
              </div>`
            : `<span class="stop-role">${roleText}</span>`
        }
      </div>`;
    const input = li.querySelector('input[type="text"]');
    input.value = s.name;
    input.addEventListener('change', () => {
      const v = input.value.trim();
      if (!v) {
        input.value = s.name;
        return;
      }
      s.name = v;
      s.custom = true;
      changed({ recalc: false });
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') input.blur();
    });
    li.querySelector('[data-act="up"]').addEventListener('click', () => moveStop(i, -1));
    li.querySelector('[data-act="down"]').addEventListener('click', () => moveStop(i, 1));
    li.querySelector('[data-act="del"]').addEventListener('click', () => removeStop(i));
    li.querySelectorAll(`input[name="type-${s.id}"]`).forEach((r) =>
      r.addEventListener('change', () => {
        s.type = r.value;
        changed();
      }),
    );
    list.appendChild(li);
  });
}

$('#btn-clear').addEventListener('click', () => {
  if (!state.stops.length) return;
  if (!confirm('Eliminare tutte le tappe?')) return;
  state.stops = [];
  state.name = '';
  $('#trip-name').value = '';
  changed();
});

// ---------------------------------------------------------------------------
// Ricerca
// ---------------------------------------------------------------------------

$('#search-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = $('#search-input');
  const q = input.value.trim();
  const box = $('#search-results');
  if (q.length < 2) return;
  input.blur(); // chiude la tastiera di iPhone
  box.hidden = false;
  box.innerHTML = '<li class="empty">Cerco…</li>';
  try {
    const b = map.getBounds();
    const results = await searchPlaces(q, [b.getWest(), b.getNorth(), b.getEast(), b.getSouth()].map((v) => v.toFixed(4)));
    box.textContent = '';
    if (!results.length) {
      box.innerHTML = '<li class="empty">Nessun risultato. Prova ad aggiungere la provincia o il comune (es. «Passo Gavia, Valfurva»).</li>';
      return;
    }
    for (const r of results) {
      const li = document.createElement('li');
      li.innerHTML = '<div class="r-text"><div class="r-name"></div><div class="r-detail"></div></div><button type="button" class="btn small">Aggiungi</button>';
      li.querySelector('.r-name').textContent = r.name;
      li.querySelector('.r-detail').textContent = r.detail;
      li.querySelector('button').addEventListener('click', () => {
        addStop(makeStop(r.lat, r.lon, r.name));
        box.hidden = true;
        input.value = '';
        map.setView([r.lat, r.lon], Math.max(map.getZoom(), 9));
      });
      li.querySelector('.r-text').addEventListener('click', () => map.setView([r.lat, r.lon], 13));
      box.appendChild(li);
    }
  } catch (err) {
    box.innerHTML = '';
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = err.message;
    box.appendChild(li);
  }
});

// Giro dalle località: una per riga, cercate in ordine (la coda rispetta 1 richiesta al secondo)
$('#quick-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const names = $('#quick-input')
    .value.split(/\n|;/)
    .map((x) => x.trim())
    .filter(Boolean);
  if (names.length < 2) return toast('Scrivi almeno due località, una per riga (partenza e arrivo).', true);
  const btn = $('#quick-btn');
  btn.disabled = true;
  const found = [];
  const missing = [];
  try {
    for (let i = 0; i < names.length; i++) {
      btn.textContent = `Cerco ${i + 1} di ${names.length}…`;
      const res = await searchPlaces(names[i]);
      if (res[0]) found.push(makeStop(res[0].lat, res[0].lon, res[0].name));
      else missing.push(names[i]);
    }
  } catch (err) {
    toast(err.message, true);
    return;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Calcola il percorso';
  }
  if (missing.length) {
    toast(`Non trovate: ${missing.join(', ')}. Aggiungi la provincia (es. «Gavia, Sondrio») e riprova.`, true);
    return;
  }
  state.stops = found;
  changed();
  fitAll();
  $('#result-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
});

document.querySelectorAll('input[name="insert-mode"]').forEach((r) =>
  r.addEventListener('change', () => {
    state.insertMode = r.value;
    persist();
  }),
);

// ---------------------------------------------------------------------------
// Preferenze
// ---------------------------------------------------------------------------

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
}

function syncControls() {
  $('#trip-name').value = state.name;
  $('#opt-loop').checked = state.loop;
  $('#opt-tolls').checked = state.options.avoidTolls;
  $('#opt-ferries').checked = state.options.avoidFerries;
  $('#opt-unpaved').checked = state.options.avoidUnpaved;
  for (const r of document.querySelectorAll('input[name="highways"]')) r.checked = Number(r.value) === state.options.highways;
  for (const r of document.querySelectorAll('input[name="shortest"]')) r.checked = (r.value === '1') === state.options.shortest;
  for (const r of document.querySelectorAll('input[name="insert-mode"]')) r.checked = r.value === state.insertMode;
}

// ---------------------------------------------------------------------------
// Calcolo del percorso
// ---------------------------------------------------------------------------

function currentKey() {
  return JSON.stringify([state.stops.map((s) => [s.lat, s.lon, s.type]), state.loop, state.options]);
}

/** Da chiamare a ogni modifica. */
function changed({ recalc = true } = {}) {
  renderStops();
  renderMarkers();
  persist();
  if (route) renderResult(); // aggiorna i nomi nelle tratte e nel roadbook
  if (recalc) scheduleRecalc();
}

function scheduleRecalc() {
  clearTimeout(recalcTimer);
  const key = currentKey();
  if (key === routeKey && route) return;
  if (state.stops.length < 2) {
    if (recalcAbort) recalcAbort.abort();
    clearRoute();
    setStatus(state.stops.length === 1 ? 'Aggiungi almeno un\'altra tappa per calcolare il percorso.' : '');
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
  const stops = state.stops.map((s) => ({ ...s }));
  const loop = state.loop;
  showMapStatus('Calcolo…');
  try {
    const res = await fetchRoute(stops, loop, state.options, ctrl.signal);
    if (seq !== recalcSeq) return;
    route = { parsed: parseTrip(res.trip), costing: res.costing, warning: res.warning, stops, loop };
    routeKey = key;
    setStatus(res.warning || '', res.warning ? 'warn' : '');
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

function clearRoute() {
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
}

function showMapStatus(text) {
  const el = $('#map-status');
  el.textContent = text;
  el.hidden = !text;
}

/** Nomi delle tratte: una tratta va da una tappa "sosta" alla successiva. */
function legNames(r) {
  const locs = routeLocations(r.stops, r.loop);
  const names = locs.map((_, i) => (i < r.stops.length ? r.stops[i].name : `${r.stops[0].name} (ritorno)`));
  const nums = locs.map((_, i) => (i < r.stops.length ? i + 1 : 1));
  const breaks = locs.map((l, i) => (l.type === 'break' ? i : -1)).filter((i) => i >= 0);
  const out = [];
  for (let k = 1; k < breaks.length; k++) {
    const via = locs.slice(breaks[k - 1] + 1, breaks[k]).length;
    out.push({
      from: `${nums[breaks[k - 1]]}. ${short(names[breaks[k - 1]])}`,
      to: `${nums[breaks[k]]}. ${short(names[breaks[k]])}`,
      via,
    });
  }
  return out;
}

function short(name) {
  return String(name).split(',')[0];
}

function renderResult() {
  const has = !!route;
  $('#route-summary').hidden = !has;
  for (const id of ['#btn-tbt-dl', '#btn-tbt-share', '#btn-track-dl', '#btn-track-share', '#btn-route-dl', '#btn-route-share', '#btn-copy-roadbook'])
    $(id).disabled = !has;
  $('#tbt-count').textContent = '';
  const rb = $('#roadbook');
  rb.textContent = '';
  $('#roadbook-empty').hidden = has;
  $('#route-count').textContent = '';
  $('#legs').textContent = '';
  if (!has) return;

  const p = route.parsed;
  $('#tot-km').textContent = formatKm(p.summary.length);
  $('#tot-time').textContent = formatDuration(p.summary.time);

  // dopo una rinomina il percorso non cambia, ma i nomi sì
  const names = legNames(routeKey === currentKey() ? { ...route, stops: state.stops } : route);
  p.legs.forEach((leg, i) => {
    const li = document.createElement('li');
    const n = names[i] || { from: `Tratta ${i + 1}`, to: '', via: 0 };
    li.innerHTML = '<span class="leg-name"></span><span class="leg-num"></span>';
    li.querySelector('.leg-name').textContent = `${n.from}${n.to ? ` → ${n.to}` : ''}${n.via ? ` (via ${n.via} passaggi${n.via === 1 ? 'o' : ''})` : ''}`;
    li.querySelector('.leg-num').textContent = `${formatKm(leg.length)} · ${formatDuration(leg.time)}`;
    $('#legs').appendChild(li);
  });

  $('#tbt-count').textContent = `Contiene ${turnByTurnInstructions(p).length} istruzioni.`;

  const pts = buildRoutePoints(p, route.stops, route.loop);
  const shaping = pts.filter((x) => x.kind === 'shaping').length;
  $('#route-count').textContent = `La rotta contiene ${pts.length} punti (${pts.length - shaping} tappe e ${shaping} di passaggio).`;

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
  // nomi aggiornati delle tappe (possono essere stati rinominati dopo il calcolo)
  const stops = state.stops.map((s) => ({ ...s }));
  if (kind === 'turn-by-turn') {
    const res = buildTurnByTurnGpx({ name, stops, loop: route.loop, parsed: route.parsed, time: now });
    return { xml: res.xml, filename: gpxFileName(name, now, 'turn-by-turn') };
  }
  if (kind === 'traccia') {
    const xml = buildTrackGpx({ name, stops, loop: route.loop, parsed: route.parsed, time: now });
    return { xml, filename: gpxFileName(name, now, 'traccia') };
  }
  const res = buildRouteGpx({ name: `${name} (rotta)`, stops, loop: route.loop, parsed: route.parsed, time: now });
  return { xml: res.xml, filename: gpxFileName(name, now, 'rotta') };
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
  toast(`File «${filename}» scaricato.`);
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
  // il browser non può condividere file: scarico
  download(f);
}

$('#btn-tbt-dl').addEventListener('click', () => exportReady() && download(gpxFile('turn-by-turn')));
$('#btn-tbt-share').addEventListener('click', () => exportReady() && share(gpxFile('turn-by-turn')));
$('#btn-track-dl').addEventListener('click', () => exportReady() && download(gpxFile('traccia')));
$('#btn-route-dl').addEventListener('click', () => exportReady() && download(gpxFile('rotta')));
$('#btn-track-share').addEventListener('click', () => exportReady() && share(gpxFile('traccia')));
$('#btn-route-share').addEventListener('click', () => exportReady() && share(gpxFile('rotta')));

$('#btn-copy-roadbook').addEventListener('click', async () => {
  if (!route) return;
  const text = roadbookText(tripName(), route.parsed, state.stops);
  if (await copyText(text)) toast('Roadbook copiato.');
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
    stops: state.stops.map(({ lat, lon, name, type, custom }) => ({ lat, lon, name, type, custom })),
  };
}

function applySnapshot(s) {
  state.name = s.name || '';
  state.loop = !!s.loop;
  state.options = { ...DEFAULT_OPTIONS, ...(s.options || {}) };
  state.stops = (s.stops || []).map((x) => makeStop(x.lat, x.lon, x.name, { type: x.type === 'through' ? 'through' : 'break', custom: x.custom ?? true }));
  syncControls();
  $('#quick-input').value = state.stops.map((x) => x.name).join('\n');
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
  writeJson(STORAGE_CURRENT, { ...snapshot(), insertMode: state.insertMode });
  const hash = state.stops.length ? shareHash() : '';
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
  $('#saved-empty').hidden = list.length > 0;
  for (const t of list) {
    const li = document.createElement('li');
    li.innerHTML = `
      <div class="s-text"><div class="s-name"></div><div class="s-meta"></div></div>
      <button type="button" class="btn small secondary" data-act="load">Carica</button>
      <button type="button" class="icon-btn del" data-act="del" aria-label="Elimina giro salvato">✕</button>`;
    li.querySelector('.s-name').textContent = t.name;
    const d = new Date(t.savedAt);
    li.querySelector('.s-meta').textContent = `${t.state.stops.length} tappe · ${d.toLocaleDateString('it-IT')} ${d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}`;
    li.querySelector('[data-act="load"]').addEventListener('click', () => {
      if (state.stops.length && !confirm(`Caricare «${t.name}»? Il giro attuale verrà sostituito (salvalo prima se ti serve).`)) return;
      applySnapshot(t.state);
      toast(`Giro «${t.name}» caricato.`);
    });
    li.querySelector('[data-act="del"]').addEventListener('click', () => {
      if (!confirm(`Eliminare il giro salvato «${t.name}»?`)) return;
      writeJson(STORAGE_TRIPS, savedTrips().filter((x) => x.id !== t.id));
      renderSaved();
    });
    ul.appendChild(li);
  }
}

$('#btn-save').addEventListener('click', () => {
  if (!state.stops.length) return toast('Aggiungi almeno una tappa prima di salvare.', true);
  const name = tripName();
  const list = savedTrips();
  const existing = list.find((t) => t.name === name);
  if (existing && !confirm(`Esiste già un giro chiamato «${name}». Sovrascriverlo?`)) return;
  const entry = { id: existing ? existing.id : `${Date.now()}`, name, savedAt: Date.now(), state: snapshot() };
  const next = existing ? list.map((t) => (t.id === existing.id ? entry : t)) : [...list, entry];
  if (!writeJson(STORAGE_TRIPS, next))
    return toast('Salvataggio non riuscito: la memoria del browser è piena o disattivata (navigazione privata?).', true);
  renderSaved();
  toast(`Giro «${name}» salvato su questo dispositivo.`);
});

$('#btn-share-link').addEventListener('click', async () => {
  if (!state.stops.length) return toast('Aggiungi almeno una tappa per creare il link.', true);
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
  if (saved && Array.isArray(saved.stops) && saved.stops.length) {
    state.insertMode = saved.insertMode === 'middle' ? 'middle' : 'end';
    applySnapshot(saved);
  } else {
    syncControls();
    renderStops();
  }
}
