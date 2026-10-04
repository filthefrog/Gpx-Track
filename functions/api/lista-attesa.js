// Lista d'attesa di Traccemoto Plus: POST /api/lista-attesa { email, consenso: true, fonte }
// Cloudflare Pages Functions con un database D1 collegato come «DB» (vedi docs/pubblicazione.md).
// Salva solo email, data, versione dell'informativa accettata e pagina di provenienza: niente IP, niente nome.

export const INFORMATIVA = '2026-10';
const EMAIL = /^[^\s@<>()[\]\\,;:"]{1,64}@[^\s@<>()[\]\\,;:"]{1,190}\.[a-z]{2,24}$/i;

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

export async function onRequestPost({ request, env }) {
  // solo dalle pagine del sito (niente moduli copiati su altri siti)
  const origin = request.headers.get('origin');
  if (origin && new URL(origin).host !== new URL(request.url).host) return json({ ok: false, errore: 'origine' }, 403);
  if (!env.DB) return json({ ok: false, errore: 'non-configurato' }, 503);
  let data;
  try {
    data = await request.json();
  } catch {
    return json({ ok: false, errore: 'richiesta' }, 400);
  }
  // campo nascosto: lo compilano solo i robot. Si risponde «ok» senza salvare nulla.
  if (data && data.sito) return json({ ok: true });
  const email = String((data && data.email) || '').trim().toLowerCase();
  if (email.length > 254 || !EMAIL.test(email)) return json({ ok: false, errore: 'email' }, 400);
  if (!data || data.consenso !== true) return json({ ok: false, errore: 'consenso' }, 400);
  const fonte = String(data.fonte || '').replace(/[^a-z0-9-]/gi, '').slice(0, 40);
  await env.DB.prepare('INSERT INTO lista_attesa (email, creato, informativa, fonte) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(email) DO NOTHING')
    .bind(email, new Date().toISOString(), INFORMATIVA, fonte)
    .run();
  // stessa risposta anche se l'email c'era già: non si rivela chi è iscritto
  return json({ ok: true });
}
