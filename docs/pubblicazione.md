# Andare online con Traccemoto (dominio, Cloudflare, repository privato)

Obiettivo: sito su **traccemoto.it** (o il dominio che scegli), codice **privato**, costo fisso solo il dominio.

Perché Cloudflare Pages e non GitHub Pages: con l'account GitHub gratuito, GitHub Pages pubblica solo da
repository **pubblici**; per un repository privato servirebbe GitHub Pro, a pagamento. Cloudflare Pages invece è
gratis anche con repository privati: banda illimitata per i file statici, 500 pubblicazioni al mese, domini
personalizzati e HTTPS automatico.

Segui l'ordine: così il sito non va mai offline.

## 1. Il dominio

1. Compra il dominio (circa 10-15 € l'anno; è l'unico costo fisso). Puoi comprarlo direttamente su Cloudflare
   (Domain Registration, a prezzo di costo) oppure da un registrar italiano e poi spostare i DNS su Cloudflare.
   **Nota**: la registrazione dei domini `.it` su Cloudflare è **DA VERIFICARE**; per i `.com` è disponibile.
2. Se il dominio è presso un altro registrar: in Cloudflare «Add a site», piano **Free**, e cambia i nameserver dal
   pannello del registrar con i due indicati da Cloudflare.

## 2. Il sito su Cloudflare Pages

1. Cloudflare › **Workers & Pages** › **Create** › **Pages** › **Connect to Git**.
2. Autorizza l'app Cloudflare su GitHub, **solo** per il repository del sito.
3. Impostazioni di build:
   - Production branch: `main`
   - Framework preset: **None**
   - Build command: `npm run build`
   - Build output directory: `dist`
4. **Save and Deploy**. Dopo un minuto il sito è su `https://<nome-progetto>.pages.dev`: aprilo e prova.
5. **Custom domains** › aggiungi `traccemoto.it` e `www.traccemoto.it` (Cloudflare crea da solo i record DNS e il
   certificato HTTPS).

Da qui in poi ogni push su `main` ripubblica il sito da solo.

## 3. Email del dominio (gratis)

Per i contatti del sito non usare la tua email personale:

1. Cloudflare › il dominio › **Email** › **Email Routing** › abilita.
2. Crea `info@traccemoto.it` → inoltro alla tua casella personale (conferma con il link che ricevi).
3. In `js/config.js` imposta `contactUrl: 'mailto:info@traccemoto.it'`.

Per rispondere *da* `info@`: in Gmail «Invia messaggio come», con una password per le app.

## 4. Aggiorna la configurazione

In `js/config.js`:

```js
siteUrl: 'https://traccemoto.it',
contactUrl: 'mailto:info@traccemoto.it',
owner: 'Nome e cognome (o ragione sociale)',
```

Poi `npm run versione` e push. Link canonici, sitemap, dati strutturati e informativa si aggiornano da soli.
Aggiungi il sito in **Google Search Console** (proprietà di dominio) e invia `https://traccemoto.it/sitemap.xml`.

## 4b. Lista d'attesa di Traccemoto Plus (facoltativo, gratis)

La pagina `/plus/` raccoglie le email di chi vuole essere avvisato. Il modulo salva i dati con una **Pages
Function** (`functions/api/lista-attesa.js`, pubblicata da sola insieme al sito) in un database **D1** di Cloudflare
(piano gratuito).

1. Cloudflare › **Storage & Databases** › **D1** › **Create database**, nome `traccemoto`.
2. Nella console del database incolla ed esegui il contenuto di `migrations/0001_lista_attesa.sql`.
3. Workers & Pages › il progetto › **Settings** › **Bindings** › **Add** › **D1 database**: nome variabile `DB`,
   database `traccemoto` (sia per Production sia per Preview).
4. In `js/config.js` imposta `waitlist: true`, poi `npm run versione` e push.
5. Prova: iscriviti dalla pagina `/plus/` e controlla in D1 › Console: `SELECT * FROM lista_attesa;`

Per scrivere agli iscritti, esporta le email dalla console (o con `wrangler d1 export`). Rispetta l'informativa: solo
messaggi sull'apertura di Plus, e cancella le email dopo il lancio o comunque entro 24 mesi.

## 5. Repository privato

Solo **dopo** aver visto il sito funzionare sul dominio:

1. GitHub › repository › **Settings** › **General** › in fondo **Danger Zone** › **Change repository visibility**
   › **Make private**.
2. Cloudflare continua a pubblicare (l'app autorizzata vede i repository privati).
3. GitHub Pages si spegne da solo con il repository privato sul piano gratuito: il vecchio indirizzo
   `filthefrog.github.io/Gpx-Track` smette di funzionare. Se qualcuno lo ha salvato, puoi creare un repository
   pubblico `filthefrog.github.io` con una sola pagina che rimanda a `traccemoto.it` (facoltativo).

## Cosa resta visibile (da sapere)

- **Il codice che gira nel browser** (HTML, CSS, JavaScript del sito) lo può sempre vedere chiunque visiti il sito:
  vale per ogni sito web. Il repository privato nasconde il resto: storia delle modifiche, documenti (piano di
  guadagno, verifiche, proposte), test, testi sorgente e script. La protezione legale viene dalla `LICENSE`
  («tutti i diritti riservati») e dal copyright nel piè di pagina.
- Il repository è stato **pubblico** fino a oggi: eventuali copie già fatte non si possono ritirare.
- Componenti di terzi: Leaflet (BSD), carattere Saira Condensed (OFL, licenza inclusa in `fonts/`), schemi OpenRally
  (CC BY 4.0, solo nei test). Le loro licenze restano valide e sono rispettate.
