import { test } from 'node:test';
import assert from 'node:assert/strict';
import { onRequestPost, INFORMATIVA } from '../functions/api/lista-attesa.js';

function fakeDb() {
  const rows = new Map();
  return {
    rows,
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async run() {
              assert.match(sql, /ON CONFLICT\(email\) DO NOTHING/);
              if (!rows.has(args[0])) rows.set(args[0], args);
              return { success: true };
            },
          };
        },
      };
    },
  };
}

const req = (body, origin = 'https://traccemoto.it') =>
  new Request('https://traccemoto.it/api/lista-attesa', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(origin ? { origin } : {}) },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

test('lista d\'attesa: salva email (minuscola), data, informativa e fonte', async () => {
  const DB = fakeDb();
  const res = await onRequestPost({ request: req({ email: ' Mario.Rossi@Example.IT ', consenso: true, fonte: 'plus' }), env: { DB } });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
  const row = DB.rows.get('mario.rossi@example.it');
  assert.ok(row);
  assert.equal(row[2], INFORMATIVA);
  assert.equal(row[3], 'plus');
  assert.ok(!Number.isNaN(Date.parse(row[1])));
});

test('lista d\'attesa: iscrizione ripetuta non cambia nulla e risponde ok', async () => {
  const DB = fakeDb();
  await onRequestPost({ request: req({ email: 'a@b.it', consenso: true }), env: { DB } });
  const res = await onRequestPost({ request: req({ email: 'A@B.IT', consenso: true }), env: { DB } });
  assert.equal(res.status, 200);
  assert.equal(DB.rows.size, 1);
});

test('lista d\'attesa: rifiuta email non valide, consenso mancante e richieste malformate', async () => {
  const DB = fakeDb();
  for (const body of [{ email: 'ciao', consenso: true }, { email: 'a@b', consenso: true }, { email: 'a@b.it' }, { email: 'a@b.it', consenso: 'si' }, 'non json']) {
    const res = await onRequestPost({ request: req(body), env: { DB } });
    assert.equal(res.status, 400, JSON.stringify(body));
  }
  assert.equal(DB.rows.size, 0);
});

test('lista d\'attesa: robot (campo nascosto) e altri siti', async () => {
  const DB = fakeDb();
  const bot = await onRequestPost({ request: req({ email: 'bot@spam.com', consenso: true, sito: 'http://x' }), env: { DB } });
  assert.equal(bot.status, 200);
  assert.equal(DB.rows.size, 0);
  const other = await onRequestPost({ request: req({ email: 'a@b.it', consenso: true }, 'https://altro-sito.com'), env: { DB } });
  assert.equal(other.status, 403);
  const noDb = await onRequestPost({ request: req({ email: 'a@b.it', consenso: true }), env: {} });
  assert.equal(noDb.status, 503);
});
