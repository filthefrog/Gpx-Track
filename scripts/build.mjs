// Prepara la cartella dist/ con i soli file pubblici del sito (per Cloudflare Pages).
// Nel repository restano privati documenti, test, testi sorgente delle pagine e script.
//
//   node scripts/build.mjs        (oppure: npm run build)
//
// Su Cloudflare Pages: comando di build «npm run build», cartella di output «dist».
import { cpSync, rmSync, mkdirSync, existsSync, readdirSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const out = new URL('dist/', root);
// pagine generate da contenuti/ (guide, privacy…) già presenti nel repository: si rigenerano per sicurezza
await import('./pagine.mjs');

const PUBLIC = [
  'index.html', 'sw.js', 'manifest.webmanifest', 'robots.txt', 'sitemap.xml', 'ads.txt', '_headers',
  'privacy.html', 'info.html', 'sostieni.html',
  'css', 'js', 'fonts', 'icons', 'guide', 'convertitore-gpx-roadbook',
];

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
let n = 0;
for (const item of PUBLIC) {
  const src = new URL(item, root);
  if (!existsSync(src)) continue;
  cpSync(src, new URL(item, out), { recursive: true });
  n++;
}
const files = (dir) => readdirSync(dir, { withFileTypes: true }).reduce((a, d) => a + (d.isDirectory() ? files(new URL(`${d.name}/`, dir)) : 1), 0);
console.log(`dist/ pronta: ${n} voci, ${files(out)} file.`);
