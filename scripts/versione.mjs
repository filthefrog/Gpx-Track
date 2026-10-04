// Aggiorna il numero di versione nei riferimenti a CSS e moduli JavaScript (?v=...).
// Serve a forzare i browser (Safari su iPhone in particolare) a scaricare insieme
// tutti i file nuovi dopo una pubblicazione, invece di mescolarli con quelli in cache.
//
//   node scripts/versione.mjs          (versione = data e ora attuali)
//   node scripts/versione.mjs 42       (versione scelta)
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const now = new Date();
const pad = (n) => String(n).padStart(2, '0');
const version =
  process.argv[2] || `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}`;

const files = ['index.html', ...readdirSync(new URL('js/', root)).filter((f) => f.endsWith('.js')).map((f) => `js/${f}`)];
for (const f of files) {
  const url = new URL(f, root);
  const before = readFileSync(url, 'utf8');
  const after = before
    // import ... from './modulo.js' oppure './modulo.js?v=...'
    .replace(/(from\s+'\.\/[\w-]+\.js)(\?v=[\w.-]+)?'/g, `$1?v=${version}'`)
    // <link href="css/style.css"> e <script src="js/app.js">
    .replace(/((?:href|src)="(?:css|js)\/[\w-]+\.(?:css|js))(\?v=[\w.-]+)?"/g, `$1?v=${version}"`);
  if (after !== before) writeFileSync(url, after);
}
console.log(`Versione ${version}`);
