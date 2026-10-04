// Genera le pagine di contenuto del sito (guide, privacy, info, sostieni) da contenuti/*.html,
// più sitemap.xml, robots.txt e, se AdSense è configurato, ads.txt.
//
//   node scripts/pagine.mjs        (oppure: npm run pagine)
//
// Ogni file in contenuti/ comincia con un commento JSON:
//   <!--{"path": "guide/gpx-osmand.html", "title": "…", "description": "…", "ads": true}-->
// Nel testo:
//   <!--annuncio-->            posto per un annuncio (solo nelle pagine con "ads": true)
//   {{owner}} {{contact}}      dati da js/config.js
//   <!--se-donazioni--> … <!--fine-donazioni-->   parte mostrata solo se donateUrl è impostato
//
// Gli annunci compaiono solo qui, mai nello strumento (index.html): lo chiede il progetto e le
// regole di AdSense non ammettono annunci su schermate senza contenuti dell'editore.
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { CONFIG } from '../js/config.js';

const root = new URL('../', import.meta.url);
const read = (f) => readFileSync(new URL(f, root), 'utf8');
const write = (f, text) => {
  const url = new URL(f, root);
  mkdirSync(dirname(url.pathname), { recursive: true });
  writeFileSync(url, text);
};
const VERSION = (read('sw.js').match(/const VERSION = '([\w.-]+)';/) || [])[1] || '1';
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const ads = /^ca-pub-\d{10,}$/.test(CONFIG.adsenseClient) ? CONFIG.adsenseClient : '';
if (CONFIG.adsenseClient && !ads) throw new Error(`adsenseClient non valido: «${CONFIG.adsenseClient}» (formato ca-pub-0000000000000000)`);

const pages = readdirSync(new URL('contenuti/', root))
  .filter((f) => f.endsWith('.html'))
  .map((f) => {
    const src = read(`contenuti/${f}`);
    const m = src.match(/^<!--(\{[\s\S]*?\})-->\s*/);
    if (!m) throw new Error(`contenuti/${f}: manca il commento JSON iniziale`);
    return { ...JSON.parse(m[1]), body: src.slice(m[0].length), source: f };
  })
  .sort((a, b) => (a.order ?? 99) - (b.order ?? 99) || a.path.localeCompare(b.path));

function adUnit(slot) {
  if (!ads) return '';
  // senza ID dell'unità: gli annunci automatici scelgono da soli dove metterli
  if (!slot) return '';
  return `<aside class="ad" aria-label="Pubblicità"><span class="ad-label">Pubblicità</span>
  <ins class="adsbygoogle" style="display:block" data-ad-client="${ads}" data-ad-slot="${esc(slot)}" data-ad-format="auto" data-full-width-responsive="true"></ins>
  <script>(adsbygoogle = window.adsbygoogle || []).push({});</script></aside>`;
}

function render(page) {
  const up = '../'.repeat(page.path.split('/').length - 1);
  const withAds = ads && page.ads;
  let body = page.body
    .replace(/\{\{owner\}\}/g, esc(CONFIG.owner || 'il gestore del sito'))
    .replace(/\{\{contact\}\}/g, esc(CONFIG.contactUrl))
    .replace(/\{\{donate\}\}/g, esc(CONFIG.donateUrl))
    .replace(/\{\{up\}\}/g, up);
  body = CONFIG.donateUrl
    ? body.replace(/<!--se-donazioni-->|<!--fine-donazioni-->/g, '')
    : body.replace(/<!--se-donazioni-->[\s\S]*?<!--fine-donazioni-->/g, '');
  let n = 0;
  body = body.replace(/<!--annuncio-->/g, () => (withAds ? adUnit(n++ === 0 ? CONFIG.adSlots.article : CONFIG.adSlots.bottom) : ''));
  const canonical = `${CONFIG.siteUrl}/${page.path.replace(/index\.html$/, '')}`;
  const donate = CONFIG.donateUrl
    ? `<a class="nav-donate" href="${esc(CONFIG.donateUrl)}" target="_blank" rel="noopener">Offrimi un caffè</a>`
    : '';
  return `<!doctype html>
<html lang="it">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>${esc(page.title)} · Tracce Moto</title>
  <meta name="description" content="${esc(page.description)}">
  <link rel="canonical" href="${esc(canonical)}">
  <meta property="og:type" content="article">
  <meta property="og:title" content="${esc(page.title)}">
  <meta property="og:description" content="${esc(page.description)}">
  <meta property="og:url" content="${esc(canonical)}">
  <meta property="og:image" content="${esc(CONFIG.siteUrl)}/icons/icon-512.png">
  <meta name="theme-color" content="#f3efe6" media="(prefers-color-scheme: light)">
  <meta name="theme-color" content="#121210" media="(prefers-color-scheme: dark)">
  <meta name="color-scheme" content="light dark">
  <meta name="referrer" content="strict-origin-when-cross-origin">
  <link rel="icon" href="${up}icons/icon.svg" type="image/svg+xml">
  <link rel="apple-touch-icon" href="${up}icons/apple-touch-icon.png">
  <link rel="stylesheet" href="${up}css/sito.css?v=${VERSION}">${
    withAds
      ? `
  <meta name="google-adsense-account" content="${ads}">
  <script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ads}" crossorigin="anonymous"></script>`
      : ''
  }
</head>
<body>
  <header class="site-top">
    <a class="site-brand" href="${up}./">
      <img src="${up}icons/icon.svg" alt="" width="34" height="34">
      <span>Tracce Moto</span>
     
    </a>
    <nav class="site-nav" aria-label="Sito">
      <a href="${up}guide/">Guide</a>
      ${donate}
      <a class="nav-cta" href="${up}./">Pianifica</a>
    </nav>
  </header>
  <main class="page${page.wide ? ' wide' : ''}">
${body.trim()}
  </main>
  <footer class="site-foot">
    <nav aria-label="Pagine">
      <a href="${up}./">Pianifica un giro</a>
      <a href="${up}guide/">Guide</a>
      <a href="${up}sostieni.html">Sostieni</a>
      <a href="${up}info.html">Chi siamo e contatti</a>
      <a href="${up}privacy.html">Privacy e cookie</a>
    </nav>
    <p>Tracce Moto è gratuito. Mappe e dati © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> e contributori.
      Controlla sempre percorsi, aperture dei passi e divieti prima di partire.</p>
  </footer>
</body>
</html>
`;
}

for (const page of pages) write(page.path, render(page));

// strumento: solo il meta di verifica del sito per AdSense (nessuno script, nessun annuncio, nessun cookie)
{
  const html = read('index.html').replace(/\n  <meta name="google-adsense-account" content="[^"]*">/, '');
  write(
    'index.html',
    ads ? html.replace(/(\n  <meta name="referrer"[^>]*>)/, `$1\n  <meta name="google-adsense-account" content="${ads}">`) : html,
  );
}

// sitemap e robots
const today = new Date().toISOString().slice(0, 10);
const urls = ['', ...pages.map((p) => p.path.replace(/index\.html$/, ''))];
write(
  'sitemap.xml',
  `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${esc(`${CONFIG.siteUrl}/${u}`)}</loc><lastmod>${today}</lastmod></url>`).join('\n')}
</urlset>
`,
);
write('robots.txt', `User-agent: *\nAllow: /\n\nSitemap: ${CONFIG.siteUrl}/sitemap.xml\n`);
// ads.txt: va nella radice del dominio (vedi docs/guadagni.md); qui è pronto da copiare
if (ads) write('ads.txt', `google.com, ${ads.replace(/^ca-/, '')}, DIRECT, f08c47fec0942fa0\n`);

console.log(`${pages.length} pagine${ads ? ' con annunci' : ' (annunci non configurati)'}${CONFIG.donateUrl ? ', donazioni attive' : ''}.`);
