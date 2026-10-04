// Anteprima, stampa e GPX OpenRally del roadbook: usata dallo strumento (app.js) e dalla pagina del
// convertitore GPX → roadbook (convertitore.js). Crea da sola la sua finestra; stile in css/roadbook.css.
import { escapeXml, gpxFileName } from './core.js?v=202610041804';
import { buildRoadbook, buildOpenRallyGpx, turnByTurnFromGpx, tulipSvg, noteLines, rbKm } from './roadbook.js?v=202610041804';

const FORMATS = {
  // A4 orizzontale con due strisce da 148,5 mm (larghezza A5): si tagliano e si uniscono per il rotolo
  strip: { page: 'A4 landscape', pageW: 297, pageH: 210, stripW: 148.5, perPage: 2, boxH: 38, head: 8 },
  // A4 verticale, una colonna larga: per la borsa da serbatoio o per leggere sul tavolo
  a4: { page: 'A4 portrait', pageW: 210, pageH: 297, stripW: 190, perPage: 1, boxH: 46, head: 10 },
};

const MARKUP = `
  <div class="rb-bar">
    <div class="rb-head"><strong id="rb-title">Roadbook</strong><span id="rb-info"></span></div>
    <div class="rb-controls">
      <div class="rb-seg" role="radiogroup" aria-label="Formato di stampa">
        <label><input type="radio" name="rb-format" value="strip" checked><span>Rotolo 148,5</span></label>
        <label><input type="radio" name="rb-format" value="a4"><span>A4</span></label>
      </div>
      <div class="rb-seg" role="radiogroup" aria-label="Ordine delle caselle">
        <label><input type="radio" name="rb-order" value="down" checked><span>Dall'alto</span></label>
        <label><input type="radio" name="rb-order" value="up"><span>Dal basso</span></label>
      </div>
      <div class="rb-actions">
        <button type="button" class="rb-btn primary" id="rb-print">Stampa o PDF</button>
        <button type="button" class="rb-btn" id="rb-gpx">GPX OpenRally</button>
        <button type="button" class="rb-btn ghost" id="rb-close">Chiudi</button>
      </div>
    </div>
  </div>
  <div class="rb-pages" id="rb-pages"></div>`;

function boxHtml(b) {
  const lines = noteLines(b).map((l) => `<div>${escapeXml(l)}</div>`).join('');
  return `<div class="rb-box${b.close ? ' close' : ''}">
    <div class="rb-dist"><div class="rb-total">${rbKm(b.total)}</div><div class="rb-partial">${b.n > 1 ? rbKm(b.partial) : ''}</div><div class="rb-n">${b.n}</div></div>
    <div class="rb-tulip">${tulipSvg(b)}</div>
    <div class="rb-notes">${b.cap != null ? `<div class="rb-cap">CAP ${String(b.cap).padStart(3, '0')}</div>` : ''}<div class="rb-what">${escapeXml(b.title)}</div>${lines}</div>
  </div>`;
}

function saveFile(text, filename) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/gpx+xml' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

/**
 * Prepara la finestra del roadbook nella pagina. `notify(text, isError)` mostra i messaggi.
 * Restituisce { open(data), openGpxText(text, fileName) }; data = { name, boxes, totalKm, shape, info }.
 */
export function mountRoadbookView({ notify = (t) => alert(t) } = {}) {
  let view = document.getElementById('rb-view');
  if (!view) {
    view = document.createElement('div');
    view.id = 'rb-view';
    view.className = 'rb-view';
    view.hidden = true;
    view.setAttribute('role', 'dialog');
    view.setAttribute('aria-modal', 'true');
    view.setAttribute('aria-labelledby', 'rb-title');
    view.innerHTML = MARKUP;
    document.body.appendChild(view);
  }
  const q = (sel) => view.querySelector(sel);
  let data = null;

  const options = () => {
    const format = q('input[name="rb-format"]:checked').value;
    const order = q('input[name="rb-order"]:checked').value;
    return { f: FORMATS[format] || FORMATS.strip, order };
  };

  /** Sullo schermo le strisce si rimpiccioliscono per stare nella larghezza disponibile. */
  const fit = () => {
    const { f } = options();
    const pages = q('#rb-pages');
    pages.style.setProperty('--fit', String(Math.min(1, (pages.clientWidth - 24) / ((f.stripW + 8) * 3.7795))));
  };

  const render = () => {
    if (!data) return;
    const { f, order } = options();
    const per = Math.max(1, Math.floor((f.pageH - 10 - f.head) / f.boxH));
    const strips = [];
    for (let i = 0; i < data.boxes.length; i += per) strips.push(data.boxes.slice(i, i + per));
    const pages = [];
    for (let i = 0; i < strips.length; i += f.perPage) pages.push(strips.slice(i, i + f.perPage));
    const name = escapeXml(data.name);
    q('#rb-pages').innerHTML = pages
      .map(
        (page, p) => `<section class="rb-page" style="--page-w:${f.pageW}mm;--page-h:${f.pageH}mm">${page
          .map(
            (strip, k) => `<div class="rb-strip ${order === 'up' ? 'up' : ''}" style="--strip-w:${f.stripW}mm;--box-h:${f.boxH}mm;--head-h:${f.head}mm">
            <div class="rb-strip-head"><span>${name}</span><span>caselle ${strip[0].n}-${strip[strip.length - 1].n} · ${rbKm(data.totalKm)} km · foglio ${p + 1}/${pages.length}${f.perPage > 1 ? `, striscia ${k + 1}` : ''}</span></div>
            <div class="rb-boxes">${strip.map(boxHtml).join('')}</div>
          </div>`,
          )
          .join('')}</section>`,
      )
      .join('');
    let style = document.getElementById('rb-page-style');
    if (!style) {
      style = document.createElement('style');
      style.id = 'rb-page-style';
      document.head.appendChild(style);
    }
    style.textContent = `@page { size: ${f.page}; margin: 0; }`;
    fit();
  };

  const close = () => {
    view.hidden = true;
    document.body.classList.remove('rb-open');
  };

  const open = (d) => {
    data = d;
    q('#rb-title').textContent = d.name;
    q('#rb-info').textContent = d.info || '';
    view.hidden = false;
    document.body.classList.add('rb-open');
    render();
    q('#rb-close').focus();
  };

  /** Converte il testo di un GPX e apre il roadbook. Restituisce false se il file non va bene. */
  const openGpxText = (text, fileName = '') => {
    const tbt = turnByTurnFromGpx(text);
    if (!tbt) {
      notify('Il file non sembra un GPX con una traccia o una rotta.', true);
      return false;
    }
    const rb = buildRoadbook(tbt, { stops: tbt.stops });
    const how = tbt.source === 'geometry' ? 'svolte ricavate dalla forma della traccia: ricontrolla le caselle' : 'indicazioni lette dal file';
    open({ name: tbt.name || fileName.replace(/\.gpx$/i, '') || 'Roadbook', ...rb, shape: tbt.shape, info: `${rb.boxes.length} caselle · ${rbKm(rb.totalKm)} km · ${how}` });
    return true;
  };

  if (!view.dataset.bound) {
    view.dataset.bound = '1';
    for (const input of view.querySelectorAll('input[name="rb-format"], input[name="rb-order"]')) input.addEventListener('change', render);
    q('#rb-close').addEventListener('click', close);
    q('#rb-print').addEventListener('click', () => window.print());
    q('#rb-gpx').addEventListener('click', () => {
      if (!data) return;
      const now = new Date();
      const filename = gpxFileName(data.name, now, 'roadbook-openrally');
      saveFile(buildOpenRallyGpx({ name: data.name, boxes: data.boxes, totalKm: data.totalKm, shape: data.shape, time: now }), filename);
      notify(`Scaricato «${filename}».`);
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !view.hidden) close();
    });
    window.addEventListener('resize', () => {
      if (!view.hidden) fit();
    });
  }
  return { open, openGpxText };
}
