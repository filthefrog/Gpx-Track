// Schermo di guida "stile CarPlay": posizione GPS sul percorso, freccia fluida, voce, ricalcolo.
import { parseTrip, stopShapeIndices, formatDuration } from './core.js?v=202610041257';
import { buildRouteIndex, projectOnRoute, pointAtDistance, progress, Tracker, easeAngle, formatDistance, maneuverIcon, spokenAlert, NAV } from './nav.js?v=202610041257';
import { fetchRoute } from './services.js?v=202610041257';

const L = window.L;
const $ = (sel) => document.querySelector(sel);
const STORAGE_VOICE = 'tracceMoto.voce';

// icone delle manovre (viewBox 48×48, solo tratti)
const ICONS = {
  straight: 'M24 42V8M13 19L24 8l11 11',
  right: 'M15 42V26c0-6 4-10 10-10h13M30 8l8 8-8 8',
  left: 'M33 42V26c0-6-4-10-10-10H10M18 8l-8 8 8 8',
  'slight-right': 'M17 42V30L33 12M23 11h11v11',
  'slight-left': 'M31 42V30L15 12M25 11H14v11',
  'sharp-right': 'M16 8v22l17 10M22 41l11-1-1-11',
  'sharp-left': 'M32 8v22L15 40M26 41l-11-1 1-11',
  uturn: 'M31 42V18c0-6-4-10-9-10s-9 4-9 10v12M7 25l6 6 6-6',
  roundabout: 'M24 42V30M24 30a8 8 0 1 1 6-3M30 27l9-9M31 17h8v8',
  merge: 'M14 42V30l10-10V8M34 42V30L24 20M14 18l10-10 10 10',
  ferry: 'M8 30c4 4 8 4 12 0s8-4 12 0 8 4 12 0M12 26l2-10h20l2 10M24 16V8',
  depart: 'M24 42V10M13 21l11-11 11 11M14 42h20',
  arrive: 'M24 44s-12-12-12-22a12 12 0 0 1 24 0c0 10-12 22-12 22zM24 18v.5',
};

function iconSvg(type) {
  return `<svg viewBox="0 0 48 48" aria-hidden="true"><path d="${ICONS[maneuverIcon(type)]}"/></svg>`;
}

/**
 * Avvia la navigazione. `ctx` dà accesso alla mappa e all'app:
 * { map, route, stops, options, simulate, drawShape(shape), onExit() }.
 */
export function startNavigation(ctx) {
  const { map } = ctx;
  let index = buildRouteIndex(ctx.route.parsed);
  let stops = ctx.stops.map((s) => ({ ...s }));
  let stopIdx = stopShapeIndices(index.shape, stops);
  let tracker = new Tracker();
  let following = true;
  let heading = 0;
  let shownHeading = 0;
  let lastFix = null;
  let offCount = 0;
  let rerouting = false;
  let lastReroute = -Infinity; // nessun ricalcolo ancora fatto
  let arrivedSaid = false;
  let frame = 0;
  let watchId = null;
  let simTimer = null;
  let wakeLock = null;
  const spoken = new Set(); // "indice:fase" già annunciati
  let voiceOn = readVoice();
  let zoomLevel = 16;

  // ---------- interfaccia ----------
  const ui = $('#nav');
  document.body.classList.add('navigating');
  ui.hidden = false;
  setTimeout(() => map.invalidateSize({ pan: false }), 50);
  $('#nav-sim').hidden = !ctx.simulate;
  $('#nav-voice').setAttribute('aria-pressed', String(voiceOn));
  setBanner('');

  // freccia della posizione
  const arrow = L.marker(index.shape[0], {
    interactive: false,
    zIndexOffset: 5000,
    icon: L.divIcon({
      className: '',
      html: '<div class="nav-pos"><div class="nav-pos-halo"></div><svg viewBox="0 0 40 40" class="nav-pos-arrow"><path d="M20 4l13 30-13-7-13 7z"/></svg></div>',
      iconSize: [40, 40],
      iconAnchor: [20, 20],
    }),
  }).addTo(map);
  const arrowEl = () => arrow.getElement() && arrow.getElement().querySelector('.nav-pos-arrow');

  const onDrag = () => {
    following = false;
    $('#nav-center').classList.add('attention');
  };
  map.on('dragstart', onDrag);

  const handlers = {
    '#nav-exit': () => stop(),
    '#nav-center': () => {
      following = true;
      $('#nav-center').classList.remove('attention');
      map.setZoom(zoomLevel);
    },
    '#nav-overview': () => {
      following = false;
      $('#nav-center').classList.add('attention');
      map.fitBounds(L.latLngBounds(index.shape), { padding: [120, 40] });
    },
    '#nav-voice': () => {
      voiceOn = !voiceOn;
      writeVoice(voiceOn);
      $('#nav-voice').setAttribute('aria-pressed', String(voiceOn));
      if (!voiceOn && window.speechSynthesis) speechSynthesis.cancel();
      else say('Voce attiva.');
    },
    '#nav-reroute': () => reroute(lastFix),
  };
  const bound = [];
  for (const [sel, fn] of Object.entries(handlers)) {
    const el = $(sel);
    el.addEventListener('click', fn);
    bound.push([el, fn]);
  }

  // ---------- schermo acceso ----------
  async function keepAwake() {
    try {
      if ('wakeLock' in navigator && document.visibilityState === 'visible') wakeLock = await navigator.wakeLock.request('screen');
    } catch {
      wakeLock = null; // non supportato: lo schermo segue le impostazioni del telefono
    }
  }
  const onVisible = () => {
    if (document.visibilityState === 'visible') keepAwake();
  };
  document.addEventListener('visibilitychange', onVisible);
  keepAwake();

  // ---------- voce ----------
  function say(text) {
    if (!voiceOn || !window.speechSynthesis || !text) return;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'it-IT';
    const it = speechSynthesis.getVoices().find((v) => v.lang && v.lang.toLowerCase().startsWith('it'));
    if (it) u.voice = it;
    u.rate = 1.02;
    speechSynthesis.speak(u);
  }

  function announce(p, speed) {
    if (p.arrived) {
      if (!arrivedSaid) {
        arrivedSaid = true;
        say('Sei arrivato a destinazione.');
      }
      return;
    }
    const m = p.next;
    const key = p.nextIndex;
    const far = Math.max(400, speed * 25); // circa 25 secondi prima
    const near = Math.max(60, speed * 6); // circa 6 secondi prima
    if (p.toNext <= near && !spoken.has(`${key}:near`)) {
      spoken.add(`${key}:near`);
      spoken.add(`${key}:far`);
      say(m.verbalPre || m.instruction);
    } else if (p.toNext <= far && p.toNext > near * 2 && !spoken.has(`${key}:far`)) {
      spoken.add(`${key}:far`);
      say(spokenAlert(m, p.toNext));
    }
  }

  // ---------- GPS ----------
  function onPosition(pos) {
    const c = pos.coords;
    const p = [c.latitude, c.longitude];
    lastFix = p;
    const proj = projectOnRoute(index, p, tracker.sFix);
    const accurate = c.accuracy == null || c.accuracy < 60;
    if (proj.offset > NAV.OFF_ROUTE && accurate) offCount++;
    else offCount = 0;
    if (offCount >= NAV.OFF_ROUTE_FIXES) {
      setBanner('Sei fuori percorso.', true);
      // ricalcolo automatico, al massimo ogni 20 secondi
      if (!rerouting && performance.now() - lastReroute > 20000) reroute(p);
      return;
    }
    if (offCount === 0 && !rerouting) setBanner('');
    tracker.fix(proj.s, c.speed != null && c.speed >= 0 ? c.speed : null, performance.now());
    $('#nav-speed').textContent = String(Math.round((c.speed != null && c.speed >= 0 ? c.speed : tracker.v) * 3.6));
  }

  function onGpsError(err) {
    setBanner(err.code === 1 ? 'Posizione non consentita: abilitala in Impostazioni › Privacy › Localizzazione › Safari.' : 'Segnale GPS debole: cerco la posizione…', err.code === 1);
  }

  if (ctx.simulate) startSimulation();
  else if (navigator.geolocation) {
    watchId = navigator.geolocation.watchPosition(onPosition, onGpsError, { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 });
  } else setBanner('Questo browser non fornisce la posizione.', true);

  // simulazione: un finto GPS che percorre la traccia (per provare la guida a casa)
  function startSimulation() {
    let s = 0;
    const tick = () => {
      const p = progress(index, s);
      // rallenta vicino alle manovre, come in moto
      const v = p.toNext < 120 ? 9 : p.toNext < 300 ? 15 : 24;
      s = Math.min(index.total, s + v);
      const { point } = pointAtDistance(index, s);
      const jitter = () => (Math.random() - 0.5) * 0.00008; // ± ~4 m
      onPosition({ coords: { latitude: point[0] + jitter(), longitude: point[1] + jitter(), speed: v, accuracy: 6 } });
    };
    tick();
    simTimer = setInterval(tick, 1000);
  }

  // ---------- ricalcolo ----------
  async function reroute(p) {
    if (!p || rerouting) return;
    rerouting = true;
    lastReroute = performance.now();
    setBanner('Ricalcolo il percorso…');
    say('Ricalcolo del percorso.');
    try {
      const s = tracker.sShown || 0;
      // tappe non ancora raggiunte (la prima è la partenza, già fatta)
      const left = stops.filter((_, i) => i > 0 && index.cum[stopIdx[i]] > s + 30);
      const target = left.length ? left : [stops[stops.length - 1]];
      const next = [{ lat: p[0], lon: p[1], name: 'Posizione attuale', type: 'break', snap: false }, ...target];
      const res = await fetchRoute(next, false, ctx.options);
      const parsed = parseTrip(res.trip);
      index = buildRouteIndex(parsed);
      stops = next;
      stopIdx = stopShapeIndices(index.shape, stops);
      tracker = new Tracker();
      tracker.fix(0, null, performance.now());
      spoken.clear();
      offCount = 0;
      ctx.drawShape(parsed.shape);
      setBanner('Percorso ricalcolato.');
      setTimeout(() => setBanner(''), 2500);
    } catch (err) {
      setBanner('Ricalcolo non riuscito: controlla la connessione. Riprovo tra poco.', true);
    } finally {
      rerouting = false;
    }
  }

  // ---------- ciclo di disegno (60 fps) ----------
  let lastUi = 0;
  function loop(t) {
    frame = requestAnimationFrame(loop);
    const s = tracker.frame(t);
    if (s == null) return;
    const at = pointAtDistance(index, s);
    heading = at.heading;
    shownHeading = easeAngle(shownHeading, heading, 0.12);
    arrow.setLatLng(at.point);
    const el = arrowEl();
    if (el) el.style.transform = `rotate(${shownHeading.toFixed(1)}deg)`;
    if (following) follow(at.point, shownHeading);
    // testi aggiornati 4 volte al secondo
    if (t - lastUi > 250) {
      lastUi = t;
      updatePanel(s);
    }
  }
  frame = requestAnimationFrame(loop);

  function follow(point, deg) {
    const size = map.getSize();
    // la freccia sta un po' indietro rispetto al centro: si vede più strada davanti
    const r = (deg * Math.PI) / 180;
    const ahead = size.y * 0.14;
    // centro della zona libera tra il riquadro della manovra (in alto) e i comandi (in basso)
    const target = L.point(size.x / 2 - Math.sin(r) * ahead, size.y * 0.5 + Math.cos(r) * ahead);
    const now = map.latLngToContainerPoint(point);
    const dx = now.x - target.x;
    const dy = now.y - target.y;
    // avvicinamento morbido: la mappa scorre, non salta
    if (Math.abs(dx) > 0.3 || Math.abs(dy) > 0.3) map.panBy([dx * 0.18, dy * 0.18], { animate: false });
    // zoom secondo la velocità (con isteresi, per non cambiarlo di continuo)
    // fasce separate da "buchi": tra 45 e 60 km/h, per esempio, lo zoom resta com'è
    const kmh = tracker.v * 3.6;
    let want = zoomLevel;
    if (kmh > 100) want = 14;
    else if (kmh > 60 && kmh < 90) want = 15;
    else if (kmh < 45) want = 16;
    if (want !== zoomLevel) {
      zoomLevel = want;
      map.setZoom(zoomLevel);
    }
  }

  function updatePanel(s) {
    const p = progress(index, s);
    const m = p.next;
    $('#nav-icon').innerHTML = iconSvg(p.arrived ? 4 : m.type);
    $('#nav-dist').textContent = p.arrived ? 'Arrivato' : formatDistance(p.toNext);
    $('#nav-instr').textContent = p.arrived ? stops[stops.length - 1].name : m.instruction;
    $('#nav-then').hidden = !p.after || p.arrived;
    if (p.after) $('#nav-then').innerHTML = `<span>Poi</span> ${iconSvg(p.after.type)} <span class="t"></span>`;
    if (p.after) $('#nav-then').querySelector('.t').textContent = p.after.instruction;
    const eta = new Date(Date.now() + p.remainingTime * 1000);
    $('#nav-eta').textContent = eta.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
    $('#nav-left-time').textContent = formatDuration(p.remainingTime).replace(' min', '′');
    $('#nav-left-km').textContent = formatDistance(p.remaining);
    $('#nav').classList.toggle('soon', !p.arrived && p.toNext < 150);
    announce(p, tracker.v);
  }

  function setBanner(text, alarm = false) {
    const b = $('#nav-banner');
    b.hidden = !text;
    b.classList.toggle('alarm', alarm);
    $('#nav-banner-text').textContent = text;
    $('#nav-reroute').hidden = !alarm || !lastFix;
  }

  say(`Navigazione avviata. ${index.maneuvers[0] ? index.maneuvers[0].instruction : ''}`);

  // ---------- uscita ----------
  function stop() {
    cancelAnimationFrame(frame);
    if (watchId != null) navigator.geolocation.clearWatch(watchId);
    clearInterval(simTimer);
    if (wakeLock) wakeLock.release().catch(() => {});
    document.removeEventListener('visibilitychange', onVisible);
    if (window.speechSynthesis) speechSynthesis.cancel();
    map.off('dragstart', onDrag);
    for (const [el, fn] of bound) el.removeEventListener('click', fn);
    arrow.remove();
    ui.hidden = true;
    document.body.classList.remove('navigating');
    $('#nav-center').classList.remove('attention');
    setTimeout(() => map.invalidateSize({ pan: false }), 50);
    ctx.onExit();
  }

  return { stop };
}

function readVoice() {
  try {
    return localStorage.getItem(STORAGE_VOICE) !== '0';
  } catch {
    return true;
  }
}

function writeVoice(on) {
  try {
    localStorage.setItem(STORAGE_VOICE, on ? '1' : '0');
  } catch {
    // non importante
  }
}
