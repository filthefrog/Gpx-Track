// Configurazione del sito: annunci e donazioni.
// Dopo ogni modifica: `npm run pagine` (rigenera guide, privacy e ads.txt) e `npm run versione`.
// Finché i campi sono vuoti non compare nessun annuncio e nessun pulsante per le donazioni.
// Guida passo per passo: docs/guadagni.md
export const CONFIG = Object.freeze({
  // Indirizzo pubblico del sito, senza "/" finale (serve per i link canonici e la sitemap)
  siteUrl: 'https://filthefrog.github.io/Gpx-Track',
  // ID editore AdSense, es. 'ca-pub-1234567890123456' (AdSense › Account › Informazioni sull'account)
  adsenseClient: '',
  // ID delle unità pubblicitarie (AdSense › Annunci › Per unità pubblicitaria). Vuoti = solo annunci automatici.
  // top: dopo l'introduzione delle guide · article: nel testo · bottom: in fondo · side: colonna laterale
  // fissa sui computer · tool: nello strumento (solo con toolAds)
  adSlots: { top: '', article: '', bottom: '', side: '', tool: '' },
  // Annunci anche nello strumento, sotto la scheda «Percorso». Spento di regola: lo strumento resta senza
  // cookie e con la protezione CSP. Acceso: più guadagno, ma CSP disattivata e consenso cookie anche lì.
  // Vedi docs/guadagni.md prima di attivarlo.
  toolAds: false,
  // Pagina per le donazioni, es. 'https://ko-fi.com/tuonome' oppure 'https://paypal.me/tuonome'
  donateUrl: '',
  // Chi gestisce il sito, per l'informativa privacy (nome e cognome o ragione sociale)
  owner: '',
  // Contatto per privacy e segnalazioni, es. 'mailto:info@traccemoto.it' (casella del dominio inoltrata alla tua
  // posta con Cloudflare Email Routing, gratis: vedi docs/pubblicazione.md). Mai l'indirizzo personale.
  contactUrl: '',
});
