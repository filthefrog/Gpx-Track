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

const slots = { top: '', article: '', bottom: '', side: '', tool: '', ...(CONFIG.adSlots || {}) };
const toolAds = !!(ads && CONFIG.toolAds);
if (toolAds && !slots.tool) throw new Error('toolAds attivo: serve l\'ID di un\'unità in adSlots.tool');

/** Unità pubblicitaria. Senza ID dell'unità non si scrive nulla: ci pensano gli annunci automatici. */
function adUnit(slot, cls = '') {
  if (!ads || !slot) return '';
  return `<aside class="ad${cls ? ` ${cls}` : ''}" aria-label="Pubblicità"><span class="ad-label">Pubblicità</span>
  <ins class="adsbygoogle" style="display:block" data-ad-client="${ads}" data-ad-slot="${esc(slot)}" data-ad-format="auto" data-full-width-responsive="true"></ins>
  <script>(adsbygoogle = window.adsbygoogle || []).push({});</script></aside>`;
}

// collegamenti anticipati ai server degli annunci: il primo annuncio arriva prima
const AD_HEAD = (client) => `
  <meta name="google-adsense-account" content="${client}">
  <link rel="preconnect" href="https://pagead2.googlesyndication.com" crossorigin>
  <link rel="preconnect" href="https://googleads.g.doubleclick.net" crossorigin>
  <link rel="preconnect" href="https://tpc.googlesyndication.com" crossorigin>
  <script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${client}" crossorigin="anonymous"></script>`;

/** Contatto per privacy e segnalazioni: link email (mailto:) o pagina web; se manca lo si dice. */
function contactLink() {
  const c = String(CONFIG.contactUrl || '').trim();
  if (!c) return '<em>indirizzo in arrivo</em>';
  const label = c.startsWith('mailto:') ? c.slice(7) : c.replace(/^https?:\/\//, '');
  return `<a href="${esc(c)}"${c.startsWith('mailto:') ? '' : ' target="_blank" rel="noopener"'}>${esc(label)}</a>`;
}

function render(page) {
  const up = '../'.repeat(page.path.split('/').length - 1);
  const withAds = ads && page.ads;
  let body = page.body
    .replace(/\{\{owner\}\}/g, esc(CONFIG.owner || 'il gestore del sito'))
    .replace(/\{\{contact\}\}/g, contactLink())
    .replace(/\{\{donate\}\}/g, esc(CONFIG.donateUrl))
    .replace(/\{\{up\}\}/g, up);
  body = CONFIG.donateUrl
    ? body.replace(/<!--se-donazioni-->|<!--fine-donazioni-->/g, '')
    : body.replace(/<!--se-donazioni-->[\s\S]*?<!--fine-donazioni-->/g, '');
  // testi diversi se gli annunci compaiono anche nello strumento (privacy)
  body = toolAds
    ? body.replace(/<!--se-strumento-senza-annunci-->[\s\S]*?<!--fine-strumento-senza-annunci-->/g, '').replace(/<!--(?:se|fine)-strumento-con-annunci-->/g, '')
    : body.replace(/<!--se-strumento-con-annunci-->[\s\S]*?<!--fine-strumento-con-annunci-->/g, '').replace(/<!--(?:se|fine)-strumento-senza-annunci-->/g, '');
  // lista d'attesa di Plus: modulo solo se attiva (serve Cloudflare con il database, vedi docs/pubblicazione.md)
  body = CONFIG.waitlist
    ? body.replace(/<!--se-no-lista-->[\s\S]*?<!--fine-no-lista-->/g, '').replace(/<!--(?:se|fine)-lista-->/g, '')
    : body.replace(/<!--se-lista-->[\s\S]*?<!--fine-lista-->/g, '').replace(/<!--(?:se|fine)-no-lista-->/g, '');
  // posizioni degli annunci: dopo l'introduzione, nei punti <!--annuncio--> del testo, in fondo
  if (withAds) {
    const top = adUnit(slots.top);
    body = /<\/section>/.test(body) ? body.replace(/<\/section>/, `</section>\n${top}`) : body.replace(/(<p class="lead">[\s\S]*?<\/p>)/, `$1\n${top}`);
    body = `${body}\n${adUnit(slots.bottom)}`;
  }
  body = body.replace(/<!--annuncio-->/g, () => (withAds ? adUnit(slots.article) : ''));
  const side = withAds ? adUnit(slots.side, 'ad-side') : '';
  const canonical = `${CONFIG.siteUrl}/${page.path.replace(/index\.html$/, '')}`;
  const ld = {
    '@context': 'https://schema.org',
    '@type': page.path.startsWith('guide/') && !page.path.endsWith('index.html') ? 'Article' : 'WebPage',
    headline: page.title,
    name: page.title,
    description: page.description,
    inLanguage: 'it',
    url: canonical,
    publisher: { '@type': 'Organization', name: 'Traccemoto', url: `${CONFIG.siteUrl}/`, logo: `${CONFIG.siteUrl}/icons/icon-512.png` },
  };
  const donate = CONFIG.donateUrl
    ? `<a class="nav-donate" href="${esc(CONFIG.donateUrl)}" target="_blank" rel="noopener">Offrimi un caffè</a>`
    : '';
  return `<!doctype html>
<html lang="it">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>${esc(page.title)} · Traccemoto</title>
  <meta name="description" content="${esc(page.description)}">
  <link rel="canonical" href="${esc(canonical)}">
  <meta property="og:type" content="article">
  <meta property="og:title" content="${esc(page.title)}">
  <meta property="og:description" content="${esc(page.description)}">
  <meta property="og:url" content="${esc(canonical)}">
  <meta property="og:image" content="${esc(CONFIG.siteUrl)}/icons/icon-512.png">
  <meta property="og:site_name" content="Traccemoto">
  <meta property="og:locale" content="it_IT">
  <meta name="twitter:card" content="summary">
  <script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>
  <meta name="theme-color" content="#ffffff">
  <meta name="color-scheme" content="light">
  <meta name="referrer" content="strict-origin-when-cross-origin">
  <link rel="icon" href="${up}icons/icon.svg" type="image/svg+xml">
  <link rel="apple-touch-icon" href="${up}icons/apple-touch-icon.png">
  <link rel="stylesheet" href="${up}css/sito.css?v=${VERSION}">${(page.css || []).map((c) => `\n  <link rel="stylesheet" href="${up}css/${c}.css?v=${VERSION}">`).join('')}${(page.js || []).map((j) => `\n  <script type="module" src="${up}js/${j}.js?v=${VERSION}"></script>`).join('')}${withAds ? AD_HEAD(ads) : ''}
</head>
<body>
  <header class="site-top">
    <a class="site-brand" href="${up}./">
      <img src="${up}icons/icon.svg" alt="" width="28" height="28">
      <span>Traccemoto</span>
    </a>
    <nav class="site-nav" aria-label="Sito">
      <a href="${up}guide/">Guide</a>
      <a class="nav-plus" href="${up}plus/">Plus</a>
      ${donate}
      <a class="nav-cta" href="${up}./">Pianifica</a>
    </nav>
  </header>
  <div class="layout${side ? ' with-side' : ''}">
  <main class="page${page.wide ? ' wide' : ''}">
${body.trim()}
  </main>${side ? `\n  ${side}` : ''}
  </div>
  <footer class="site-foot">
    <nav aria-label="Pagine">
      <a href="${up}./">Pianifica un giro</a>
      <a href="${up}guide/">Guide</a>
      <a href="${up}plus/">Traccemoto Plus</a>
      <a href="${up}sostieni.html">Sostieni</a>
      <a href="${up}info.html">Chi siamo e contatti</a>
      <a href="${up}privacy.html">Privacy e cookie</a>
    </nav>
    <p>© ${new Date().getFullYear()} Traccemoto. Gratuito per chi lo usa. Mappe e dati © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> e contributori.
      Controlla sempre percorsi, aperture dei passi e divieti prima di partire.</p>
  </footer>
</body>
</html>
`;
}

for (const page of pages) write(page.path, render(page));

// strumento (index.html). Di regola solo il meta di verifica del sito: nessuno script, annuncio o cookie.
// Con toolAds attivo: codice AdSense, un'unità sotto la scheda «Percorso» e la CSP disattivata,
// perché AdSense non funziona con una CSP a elenco di domini (servirebbero nonce, impossibili su un sito statico).
{
  let html = read('index.html')
    .replace(/\n  <meta name="google-adsense-account" content="[^"]*">/, '')
    .replace(/\n  <link rel="preconnect" href="https:\/\/[^"]*(?:googlesyndication|doubleclick)[^"]*" crossorigin>/g, '')
    .replace(/\n  <script async src="https:\/\/pagead2\.googlesyndication\.com[^"]*" crossorigin="anonymous"><\/script>/, '')
    .replace(/<!-- CSP disattivata[^\n]*?(<meta http-equiv="Content-Security-Policy"[^>]*>) -->/, '$1')
    .replace(/(<!--annuncio-strumento-->)[\s\S]*?(<!--\/annuncio-strumento-->)/, '$1$2');
  if (ads && !toolAds) html = html.replace(/(\n  <meta name="referrer"[^>]*>)/, `$1\n  <meta name="google-adsense-account" content="${ads}">`);
  if (toolAds) {
    html = html
      .replace(/(\n  <meta name="referrer"[^>]*>)/, `$1${AD_HEAD(ads)}`)
      .replace(/(<meta http-equiv="Content-Security-Policy"[^>]*>)/, '<!-- CSP disattivata: annunci nello strumento attivi (toolAds in js/config.js) $1 -->')
      .replace(
        /(<!--annuncio-strumento-->)(<!--\/annuncio-strumento-->)/,
        `$1<aside class="card ad tool-ad" aria-label="Pubblicità"><span class="ad-label">Pubblicità</span><ins class="adsbygoogle" style="display:block" data-ad-client="${ads}" data-ad-slot="${esc(slots.tool)}" data-ad-format="auto" data-full-width-responsive="true"></ins></aside>$2`,
      );
  }
  // SEO dello strumento: indirizzo canonico, anteprima per i social, dati strutturati (dipendono da siteUrl)
  const app = {
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    name: 'Traccemoto',
    url: `${CONFIG.siteUrl}/`,
    description: 'Pianificatore gratuito di giri in moto: da un elenco di località a GPX turn by turn, link per Google Maps e Apple Mappe e roadbook da rally.',
    applicationCategory: 'TravelApplication',
    operatingSystem: 'Any',
    inLanguage: 'it',
    isAccessibleForFree: true,
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'EUR' },
  };
  html = html.replace(
    /<!--seo-->[\s\S]*?<!--\/seo-->/,
    `<!--seo-->
  <link rel="canonical" href="${esc(CONFIG.siteUrl)}/">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="Traccemoto">
  <meta property="og:locale" content="it_IT">
  <meta property="og:title" content="Traccemoto: pianificatore di giri in moto gratis">
  <meta property="og:description" content="Dalle località al giro strada per strada: GPX per OsmAnd e Whip Live, link per Google Maps e Apple Mappe, roadbook da rally.">
  <meta property="og:url" content="${esc(CONFIG.siteUrl)}/">
  <meta property="og:image" content="${esc(CONFIG.siteUrl)}/icons/icon-512.png">
  <meta name="twitter:card" content="summary">
  <script type="application/ld+json">${JSON.stringify(app)}</script>
  <!--/seo-->`,
  );
  write('index.html', html);
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

if (!CONFIG.contactUrl) console.warn('Attenzione: manca contactUrl in js/config.js (serve per privacy e contatti).');
console.log(`${pages.length} pagine${ads ? ' con annunci' : ' (annunci non configurati)'}${toolAds ? ', annunci anche nello strumento' : ''}${CONFIG.donateUrl ? ', donazioni attive' : ''}.`);
