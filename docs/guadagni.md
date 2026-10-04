# Guadagnare con Traccemoto: AdSense e donazioni, passo per passo

Questa guida porta dal sito di oggi (gratuito, senza annunci) a un sito che mostra annunci AdSense nelle guide e
accetta donazioni. Le voci segnate **DA VERIFICARE** non le ho potute controllare sulla documentazione ufficiale
(il sito di aiuto di Google non è raggiungibile da qui): controllale nel tuo account prima di darle per buone.

Regola del progetto: **costo fisso vicino a zero**. Dove un passo costa, lo dico e propongo l'alternativa gratuita.

---

## 0. Prima di tutto: due cose da sistemare (bloccanti)

Questi punti vanno risolti **prima** di attivare gli annunci, perché da quel momento il sito diventa un'attività
che guadagna:

1. **Calcolo dei percorsi.** Oggi l'app usa il server pubblico Valhalla di FOSSGIS. È un servizio di prova
   mantenuto da volontari, non pensato per servizi di terzi in produzione
   (<https://github.com/valhalla/valhalla/discussions/3373>). Prima degli annunci va spostato su un servizio con
   condizioni chiare. È la prossima milestone del documento di passaggio (Cloudflare Worker + openrouteservice,
   poi BRouter). Le condizioni d'uso di openrouteservice per uso commerciale sono **DA VERIFICARE**.
2. **Mappa.** Le tile CARTO sono gratuite per uso non commerciale. Con gli annunci serve un'alternativa:
   il piano è MapLibre + OpenFreeMap (gratuito, condizioni per uso commerciale **DA VERIFICARE** sul loro sito).

Finché questi due punti non sono fatti, tieni `adsenseClient` vuoto in `js/config.js`. Le donazioni invece si
possono attivare subito.

## 1. Il dominio (scelta da fare)

AdSense controlla il sito e cerca il file `ads.txt` nella **radice del dominio**. Oggi il sito è
`https://filthefrog.github.io/Gpx-Track/`: la radice del dominio è `filthefrog.github.io`, non la cartella del
progetto. Due strade:

| | Costo | Come |
| --- | --- | --- |
| **A. Dominio GitHub gratuito** | 0 € | Crei un secondo repository chiamato `filthefrog.github.io` con dentro `ads.txt` (e una pagina iniziale che porta a Traccemoto). Il sito si registra in AdSense come `filthefrog.github.io`. Che AdSense approvi un sito su `github.io` è **DA VERIFICARE**: in rete ci sono esperienze sia positive sia negative. |
| **B. Dominio tuo** (es. `traccemoto.it`) | circa 10-15 € l'anno (**costo ricorrente**) | Lo compri da un registrar, lo colleghi a GitHub Pages (file `CNAME`), `ads.txt` va nella radice del repository. Più credibile per AdSense e per le persone, e il nome resta tuo se un giorno cambi hosting. |

Consiglio: **parti con A** (gratis). Se AdSense rifiuta il sito per il dominio, passa a B. Quando sei deciso,
dimmelo e preparo io i file.

## 2. Completa l'informativa privacy

In `js/config.js` imposta `owner` con il tuo nome (o il nome dell'attività). Comparirà nella pagina
`privacy.html` e in `info.html`. Senza il nome del titolare l'informativa non è completa.

Facoltativo: un contatto diverso dalle segnalazioni su GitHub in `contactUrl` (per esempio un modulo o una
casella email dedicata, **non** il tuo indirizzo personale).

Il testo dell'informativa l'ho scritto io sulla base di come funziona il sito: non è una consulenza legale.
Se il sito cresce, falla rivedere.

## 3. Crea l'account AdSense

1. Vai su <https://adsense.google.com> con il tuo account Google (serve avere almeno 18 anni).
2. Inserisci l'indirizzo del sito (vedi punto 1) e il paese.
3. Nei **Pagamenti** inserisci nome e indirizzo **esattamente come sul conto in banca**: i pagamenti arrivano con
   bonifico. Google spedisce per posta un **PIN di verifica dell'indirizzo** quando i guadagni raggiungono una
   prima soglia (importo **DA VERIFICARE** nell'account).
4. Compila le **informazioni fiscali** che AdSense chiede.

Soglia di pagamento in euro: **70 €**; i pagamenti sono mensili, emessi tra il 21 e il 26 del mese se il saldo
supera la soglia (fonti: <https://support.google.com/adsense/answer/1709871>, verificato tramite ricerca, non
sulla pagina ufficiale).

## 4. Collega il sito

1. In AdSense copia il tuo **ID editore** (`ca-pub-` seguito da 16 cifre).
2. Scrivilo in `js/config.js` → `adsenseClient`.
3. Esegui `npm run versione`: rigenera guide, privacy, `sitemap.xml`, `robots.txt` e crea `ads.txt`.
   Nelle guide compare il codice di AdSense; nello strumento (`index.html`) c'è **solo** il meta di verifica
   `google-adsense-account`, senza script, annunci o cookie.
4. Pubblica (commit e push su `main`), poi copia `ads.txt` nella radice del dominio (punto 1).
5. In AdSense premi **Verifica** e chiedi la revisione del sito. La revisione può richiedere giorni o settimane.

## 5. Consenso cookie (obbligatorio in Europa)

Da gennaio 2024 Google chiede, per gli utenti di UE, Regno Unito (e da luglio 2024 Svizzera), una piattaforma di
consenso **certificata da Google** e integrata con il TCF di IAB
(<https://support.google.com/adsense/answer/13554116>). La strada più semplice e gratuita è il messaggio di
consenso di Google stesso:

1. AdSense → **Privacy e messaggi** → **Normative europee** → crea il messaggio.
2. Scegli il sito, la lingua italiana, inserisci l'indirizzo della pagina privacy
   (`…/privacy.html`) e pubblica.
3. Il messaggio compare da solo nelle pagine con il codice AdSense (le guide). Che sia gratuito e certificato è
   quanto risulta dalle fonti trovate: **DA VERIFICARE** nell'account al momento della creazione.

Non serve un altro banner: lo strumento non usa cookie e non carica il codice di Google.

## 6. Annunci: dove e come (ottimizzazione)

**Dove compaiono.** Le guide hanno quattro posizioni pronte, oltre agli annunci automatici:

| Posizione (`adSlots`) | Dove | Perché |
| --- | --- | --- |
| `top` | subito dopo l'introduzione | è visibile senza scorrere: di solito è la posizione che rende di più |
| `article` | nei punti `<!--annuncio-->` del testo | a metà lettura, quando l'attenzione è alta |
| `bottom` | in fondo alla guida | chi arriva in fondo è interessato |
| `side` | colonna laterale fissa, solo su schermi larghi (≥ 1100 px) | sui computer resta visibile mentre si legge |

Per ognuna crea in AdSense un'unità «display» adattabile e incolla l'ID in `js/config.js`. Le posizioni senza ID
restano vuote (e non occupano spazio). In alternativa, o in aggiunta, attiva gli **annunci automatici** e, tra i
formati, quelli **ancorati** (barra in basso sul telefono) e **vignette** (a pagina intera tra una pagina e l'altra):
sono i formati che sui telefoni rendono di più e non toccano la grafica del sito.

Ottimizzazioni già fatte: spazio riservato per ogni annuncio (la pagina non «salta», e Google premia le pagine
stabili), collegamento anticipato ai server degli annunci (`preconnect`), annunci che spariscono se Google non ha
niente da mostrare, etichetta «Pubblicità» ben visibile (richiesta dalle regole).

**Annunci nello strumento (`toolAds`).** Spento di regola, come chiede il documento di progetto. Si può accendere in
`js/config.js` (serve anche `adSlots.tool`): compare un annuncio sotto la scheda «Percorso», lontano dai pulsanti
e dalla mappa. Prima di accenderlo considera che:

- lo strumento è la pagina più usata: più annunci visti, più guadagno;
- AdSense vieta annunci su schermate senza contenuti dell'editore e vicino ai pulsanti (clic accidentali): la
  posizione scelta è tra i risultati, ma la valutazione finale è di Google (**DA VERIFICARE** con la revisione);
- la protezione **CSP** dello strumento va disattivata (lo fa il generatore): AdSense non funziona con una CSP a
  elenco di domini, e un sito statico non può usare la variante con nonce;
- anche nello strumento comparirà il messaggio di consenso cookie di Google, e l'informativa privacy cambia da sola.

Consiglio: parti con gli annunci **solo nelle guide** e attiva quelli automatici ancorati; valuta `toolAds` dopo
qualche settimana di dati.

**Il guadagno viene dalle visite alle guide.** Ogni guida nuova è una pagina in più con annunci e una porta da
Google. Le prossime da scrivere: «Giri consigliati» (un giro per pagina, con GPX), roadbook e rally, passi alpini
uno per uno. Aggiungi la `sitemap.xml` in Google Search Console.

Cose da non fare mai (fanno chiudere l'account): cliccare sui tuoi annunci, chiedere di cliccarli, mettere
annunci vicino ai pulsanti dello strumento, cambiare il codice degli annunci.

## 7. Donazioni

Opzione consigliata: **Ko-fi** (<https://ko-fi.com>).

1. Crea la pagina Ko-fi e collega PayPal o Stripe per ricevere i soldi.
2. Copia il link (`https://ko-fi.com/tuonome`) in `js/config.js` → `donateUrl`.
3. `npm run versione` e pubblica. Compaiono il riquadro «Offrimi un caffè» nello strumento, il pulsante nelle
   guide e nella pagina `sostieni.html`.

Costi: Ko-fi dichiara 0% di commissione sulle donazioni; restano le commissioni di PayPal o Stripe. Alcune fonti
parlano di una commissione del 5% per i nuovi account finché non la si disattiva: **DA VERIFICARE** nelle
impostazioni di Ko-fi. Alternativa più semplice: un link **PayPal.me** (solo commissioni PayPal).

## 8. Senza partita IVA (fase attuale)

Scelta di oggi: niente vendite, quindi niente partita IVA. Si guadagna con **donazioni** e **annunci**, e si prepara
la versione Plus con una lista d'attesa. Il lancio a pagamento (partita IVA, pagamenti, abbonamenti) solo se i
numeri lo giustificano: vedi `docs/freemium.md`.

Regole per restare coerenti con questa scelta:

- **Le donazioni sono regali, non acquisti.** Nessuna funzione, nessun vantaggio in cambio (niente «dona e sblocchi
  Plus», niente abbonamenti o articoli del negozio su Ko-fi): se in cambio dei soldi dai qualcosa, diventa una
  vendita. Il sito lo dice già chiaramente nella pagina Sostieni e nella pagina Plus.
- **Le entrate vanno comunque dichiarate.** Donazioni e AdSense ricevuti da una persona fisica per un progetto come
  questo possono essere redditi da dichiarare (per esempio come redditi diversi, se l'attività è occasionale); se
  diventano continuativi e organizzati, serve la partita IVA. Come vadano trattati nel tuo caso, con quali importi e in
  quale quadro della dichiarazione, **lo decide il commercialista**: qui non metto soglie, perché sbagliarle costa caro.
- **AdSense da privato**: l'account si può aprire come persona fisica; i dati fiscali richiesti da Google vanno
  compilati con il commercialista.
- Tieni un foglio con tutte le entrate (data, importo, piattaforma): serve comunque.

## Tasse e lancio professionale

Quando arriverà Plus a pagamento: partita IVA (probabilmente regime forfettario: da valutare), condizioni di vendita,
diritto di recesso per i contenuti digitali e un *merchant of record* (Paddle o Lemon Squeezy) che gestisce l'IVA dei
clienti europei. Parlane con il commercialista **prima** di incassare il primo abbonamento.

## 9. Aspettative

Gli annunci rendono in proporzione alle visite delle guide. Per avere visite servono guide utili, aggiornate e
trovabili su Google (la `sitemap.xml` è già pronta: aggiungila in Google Search Console, gratuita). Le donazioni
arrivano soprattutto da chi usa lo strumento spesso: il riquadro nello strumento è discreto apposta.

## Riepilogo dei file

| File | Cosa fa |
| --- | --- |
| `js/config.js` | ID AdSense, unità, link donazioni, titolare, contatto |
| `contenuti/*.html` | testi di guide, privacy, info, sostieni |
| `scripts/pagine.mjs` | genera le pagine, `sitemap.xml`, `robots.txt`, `ads.txt` |
| `npm run versione` | aggiorna le versioni dei file e rigenera tutto |
