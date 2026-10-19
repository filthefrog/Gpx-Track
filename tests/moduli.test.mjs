// Controlla che ogni nome importato dai moduli dell'app esista davvero nel modulo da cui viene importato.
// L'interfaccia (app.js) non si può caricare in Node, ma un'importazione mancante la fa partire a vuoto:
// questo test la intercetta senza browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const dir = new URL('../js/', import.meta.url);
const files = readdirSync(dir).filter((f) => f.endsWith('.js'));

for (const f of files) {
  test(`js/${f}: tutte le importazioni esistono`, async () => {
    const src = readFileSync(new URL(f, dir), 'utf8');
    const imports = [...src.matchAll(/import\s*\{([^}]*)\}\s*from\s*'(\.\/[\w-]+\.js)(?:\?v=[\w.-]+)?'/g)];
    for (const [, names, target] of imports) {
      const mod = await import(new URL(target, dir).href);
      for (const raw of names.split(',')) {
        const name = raw.trim().split(/\s+as\s+/)[0];
        if (!name) continue;
        assert.ok(name in mod, `${f} importa «${name}» da ${target}, ma non esiste`);
      }
    }
  });
}
