// Worker di Traccemoto su Cloudflare: serve il sito (cartella dist/) e risponde a /api/lista-attesa.
// Tutto il resto lo gestiscono i file statici (vedi wrangler.jsonc: «assets»).
import { onRequestPost } from '../functions/api/lista-attesa.js';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/lista-attesa') {
      if (request.method !== 'POST') return new Response('Metodo non consentito', { status: 405, headers: { allow: 'POST' } });
      return onRequestPost({ request, env });
    }
    return env.ASSETS.fetch(request);
  },
};
