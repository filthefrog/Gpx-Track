# Tracce Moto

Web app statica per progettare giri in moto ed esportare file GPX da seguire svolta per svolta
con **BMW Motorrad Connected** o con un navigatore montato sulla predisposizione GPS
(BMW Motorrad Navigator, Garmin zūmo e simili). Pensata per iPhone, funziona su qualsiasi browser moderno.

- Solo HTML, CSS e JavaScript (ES modules): nessun build step, nessun backend, nessuna chiave API.
- Mappa [Leaflet](https://leafletjs.com/) con OpenStreetMap e OpenTopoMap.
- Percorsi calcolati da [Valhalla](https://valhalla.github.io/valhalla/) sul server pubblico FOSSGIS, con profilo moto.
- Ricerca luoghi con [Nominatim](https://nominatim.org/).

## In breve

1. Tocca **Elenco** e scrivi (o incolla) tutte le località in ordine, una per riga, poi **Calcola il percorso**.
   In alternativa, nella vista **Tappe** scrivi la partenza e premi **Invio**: si apre subito la riga successiva.
2. Sotto ogni tappa vedi cosa è stato trovato (tipo di luogo, comune, provincia). Se non è quello giusto tocca
   **Non è questo?** e scegli tra gli altri risultati.
3. Il percorso si calcola da solo. In basso trovi km, tempo e **Scarica GPX**; l'icona accanto apre il foglio
   di condivisione di iPhone per mandarlo direttamente all'app che usi (OsmAnd o simili).

Il file `nome-del-giro_AAAA-MM-GG_turn-by-turn.gpx` contiene tutto in un solo GPX 1.1:

- `wpt`: le tappe, numerate;
- `rte`: un punto per ogni manovra, esattamente sull'incrocio, con
  - `name` breve: `12,4 km Destra su SP5`, `31,0 km Rotonda, 2ª uscita su SS38`, `48,2 km Tieni la sinistra verso Bormio`;
  - `cmt`: l'istruzione completa in italiano;
  - `desc`: istruzione, direzione dei cartelli se nota, km dalla partenza, km e tempo fino alla manovra successiva;
  - estensioni OsmAnd: `osmand:offset` (indice del punto nella traccia), `osmand:turn` (TL, TR, KL, RNDB2…),
    `osmand:time` (secondi fino alla manovra successiva). Per questo il file dichiara `creator="OsmAndRouter"`:
    è il segnale con cui OsmAnd riconosce un percorso con indicazioni già calcolate;
- `trk`: il tracciato strada per strada (semplificato entro 4 m, con gli incroci esatti).

Le app che non conoscono le estensioni OsmAnd mostrano comunque la traccia e i nomi delle svolte.
Il cambio nome della strada e l'uscita dalla rotonda (già detta all'ingresso) non generano istruzioni separate.

## Funzioni

- **Elenco intero**: nella vista «Elenco» una casella con tutte le località, una per riga (vanno bene anche
  `A → B → C` ed elenchi numerati). Riaprendola trovi le tappe attuali; quando la modifichi vengono cercate solo
  le località nuove o cambiate, le altre restano come sono (comprese le scelte sui passi). L'app ricorda la vista scelta.
- **Elenco delle tappe**: ogni riga è un campo di ricerca. Si riordina trascinando la maniglia ≡, si elimina con ✕.
  «Aggiungi tappa» aggiunge una riga; «Usa la mia posizione» imposta la partenza dove ti trovi.
- **Ricerca dei luoghi** pensata per i giri in moto:
  - tra i risultati di Nominatim vengono preferiti paesi, città e passi, e gli omonimi vicini alle altre tappe
    («Castel San Pietro» dopo Bologna è quello in Emilia, non quello in Svizzera);
  - «Passo Gavia», «Colle Agnello» e simili vengono cercati anche senza la parola generica, privilegiando i passi;
  - accetta coordinate (`46.5286, 10.4532`, `46,5286 10,4532`, `46°31'43"N 10°27'11"E`) e link di Google Maps,
    Apple Maps e OpenStreetMap;
  - un elenco incollato in una riga diventa più tappe (righe, `;` oppure `A → B → C`).
- **Aggancio alla strada**: paesi e passi trovati con la ricerca vengono collegati a una strada vera
  (Valhalla esclude strade di servizio e sentieri vicino a quel punto). Se lì non c'è nessuna strada adatta,
  il calcolo riprova senza filtro. I punti toccati o trascinati sulla mappa restano esattamente dove sono.
- **Passi di montagna**: sotto ogni passo intermedio c'è l'etichetta ⛰ con tre modi:
  - **Automatico**: il percorso sceglie da che parte salire e scendere in base alle tappe prima e dopo;
  - **Completo**: sali da un versante e scendi dall'altro (scegli tu da dove salire e verso dove scendere);
  - **Andata e ritorno**: sali fino in cima e torni giù dallo stesso versante.

  I versanti si ricavano dalle strade OpenStreetMap attorno alla cima (servizio Overpass, gratuito e senza chiave):
  l'app segue ogni strada che parte dal passo restando sulla stessa strada agli incroci, esclude le stradine senza
  uscita e dà a ogni versante il nome del paese verso cui scende («Bormio (sud)», «Trafoi (nord-est)»).
  Per obbligare il percorso, aggiunge un punto di passaggio sulla strada di ogni versante a circa 1,5 km dalla cima;
  questi punti non compaiono come tappe nel GPX. Di default si sale dal versante rivolto verso la tappa precedente.
  Dopo il calcolo, se in automatico il percorso sale e torna indietro dallo stesso versante, l'app lo segnala
  sotto il passo e propone «Fai il passo completo».
- **Pannello abbassabile**: tocca o trascina in giù la levetta in cima al pannello (oppure il pulsante ↕ sulla
  mappa): la mappa occupa tutto lo schermo e resta solo la barra con km, tempo e «Scarica GPX». Trascinala in su
  o toccala di nuovo per riaprire le opzioni.
- **Verso di marcia**: sul percorso scorrono lentamente delle frecce bianche nella direzione del giro (ferme se
  sull'iPhone è attivo «Riduci movimento»).
- **Mappa**: «Stradale (nitida)» (CARTO Voyager, con tile ad alta risoluzione per gli schermi Retina) è quella
  predefinita; restano OpenStreetMap e OpenTopoMap. L'app ricorda la mappa scelta.
- **Passare da una strada precisa**: tocca la linea del percorso, compare un punto ⊕; trascinalo sulla strada che
  vuoi fare (o tocca «Passa da qui») e il percorso si ricalcola passando da lì. Il punto diventa un «passaggio»
  inserito nel tratto giusto dell'elenco. Anche trascinando un pin esistente il percorso si ricalcola dal nuovo punto,
  esattamente dove lo lasci (senza agganciarlo a un'altra strada).
- **Tocco sulla mappa**: mostra nome e zona del punto con «Usa come tappa…» oppure «Inserisci tra le tappe»
  (nella posizione che allunga meno il giro). I marker numerati si trascinano.
- **Sosta o passaggio** per le tappe intermedie: tocca l'etichetta sotto la tappa. Un passaggio non spezza il
  percorso in tratte e non permette inversioni a U lì.
- **Anello** per tornare alla partenza.
- **Preferenze** (richiudibili, con riepilogo): autostrade Evita / Se servono / Sì (`use_highways` 0 / 0,5 / 1),
  sterrato (`use_trails` 0 per evitarlo), pedaggi, traghetti.
- **Diretta o Panoramica**:
  - **Diretta**: il percorso più veloce per arrivare, con le preferenze scelte.
  - **Panoramica**: autostrade sempre evitate, sterrato secondo la tua scelta. Valhalla non ha un'opzione
    "panoramica", quindi l'app usa un criterio misurabile, le curve (lo stesso principio delle app per motociclisti):
    per ogni tratto tra due tappe chiede fino a 3 percorsi alternativi, ne misura i gradi di curva per km e i
    tornanti (le svolte agli incroci non contano) e tiene il più ricco di curve tra quelli che non costano più
    del 40% di tempo in più del più veloce. La scheda «Percorso» mostra curve per km, tornanti, quante alternative
    sono state confrontate e quanto tempo in più costa. Se il server non propone alternative per un tratto,
    resta il più veloce senza autostrade: aggiungere tappe intermedie dà più scelta.
  - In entrambi i modi la scheda «Percorso» mostra i gradi di curva per km e il numero di tornanti del giro.
- **Percorso**: tratte con km e tempo, totale e indicazioni svolta per svolta con km progressivi (tocca una riga per
  vederla sulla mappa, «Copia le indicazioni» per il testo).
- **Giri salvati** sul dispositivo e **link condivisibile** con lo stato del giro nell'indirizzo.

## Altri formati: Traccia e Rotta (navigatori Garmin e BMW)

Nella sezione «Altri formati» restano i due file pensati per i navigatori dedicati.

| | **Traccia** (`…_traccia.gpx`) | **Rotta** (`…_rotta.gpx`) |
|---|---|---|
| Contenuto | un `wpt` per tappa, un `wpt` per ogni svolta con l'istruzione, un `trk` con tutta la geometria del percorso | un `rte` con le tappe + un punto di passaggio 120-150 m dopo ogni svolta, con l'istruzione |
| Fedeltà | massima: è la linea esatta calcolata qui | alta: il navigatore ricalcola tra un punto e l'altro, ma i punti lo costringono sulle stesse strade |
| Indicazioni vocali | dipende dall'app/navigatore (molti seguono la linea senza indicazioni, altri la convertono in rotta) | sì, svolta per svolta, calcolate dal navigatore |
| Quando usarla | per vedere e seguire esattamente il giro, o se l'import della rotta dà problemi | per la navigazione svolta per svolta |

Dati di ogni svolta, in entrambi i file:

- `name`: km progressivi, direzione e strada, breve e leggibile anche sullo schermo del navigatore
  (`12,4 km Destra su SP5`, `31,0 km Rotonda, 2ª uscita su SS38`, `48,2 km Tieni la sinistra verso Bormio`);
- `cmt`: l'istruzione completa di Valhalla in italiano;
- `desc`: istruzione, direzione dei cartelli (se nota), km dalla partenza, km e tempo fino alla manovra successiva.

Nella Traccia i punti delle svolte stanno sull'incrocio, così le app che mostrano i waypoint li annunciano
in avvicinamento. Nella Rotta stanno 120-150 m dopo, già sulla strada giusta, per guidare il ricalcolo.
Non c'è la quota: il server gratuito la fornisce solo con richieste aggiuntive.

Dettagli tecnici:

- La traccia è semplificata con Ramer-Douglas-Peucker (tolleranza 4 m). I vertici degli incroci e delle tappe restano
  sempre, quindi la linea non taglia le curve e non esce dalla strada di più di 4 m.
- Nella rotta i punti di passaggio sono già sulla nuova strada, lontani dall'incrocio successivo. Non si aggiungono
  punti per «continua», «cambio nome della strada», «mantieni dritto» e per l'ingresso in rotonda (si usa l'uscita).
  Si scartano i punti a meno di 50 m dal precedente; se la nuova strada è più corta di 80 m il punto si salta,
  perché ci pensa quello della svolta successiva. L'app mostra quanti punti contiene la rotta.
- I punti della rotta hanno le estensioni Garmin `trp:ViaPoint` (tappe di sosta, partenza, arrivo) e
  `trp:ShapingPoint` (punti di passaggio): i navigatori Garmin/BMW non annunciano l'«arrivo» a ogni svolta.
  Gli altri programmi le ignorano.
- I file si chiamano `nome-del-giro_AAAA-MM-GG_traccia.gpx` e `…_rotta.gpx`.

## Pubblicare su GitHub Pages

1. Su GitHub apri il repository › **Settings** › **Pages**.
2. In **Build and deployment** scegli **Source: Deploy from a branch**.
3. Scegli il branch (per esempio `main`) e la cartella **/ (root)**, poi **Save**.
4. Dopo un minuto circa l'app è su `https://<utente>.github.io/<repository>/`
   (per questo repository: `https://filthefrog.github.io/Gpx-Track/`).

Il file `.nojekyll` evita che GitHub elabori i file con Jekyll. Non serve altro: non c'è nulla da compilare.

### Aggiornamenti e cache

GitHub Pages lascia che il browser tenga i file in cache per qualche minuto. Per evitare che un iPhone mescoli
file vecchi e nuovi, CSS e moduli JavaScript sono richiamati con un numero di versione (`?v=...`).
Prima di pubblicare una modifica aggiorna il numero con:

```sh
npm run versione
```

Se dopo un aggiornamento l'app sembra quella vecchia, chiudi la scheda di Safari (o l'app dalla schermata Home)
e riaprila.

### App installabile (PWA)

Tracce Moto è una Progressive Web App:

- **Installazione**: su iPhone Safari › Condividi › «Aggiungi alla schermata Home» (l'app lo ricorda con un avviso
  la prima volta); su Android e sui browser desktop compare il pulsante **Installa**.
- **Offline**: un service worker (`sw.js`) conserva l'app e Leaflet, quindi si apre subito anche senza rete,
  e tiene in memoria le porzioni di mappa già viste (fino a 1500 tile). Ricerca, calcolo del percorso e
  versanti dei passi richiedono comunque la rete.
- **Aggiornamenti**: quando pubblichi una nuova versione compare «Nuova versione disponibile · Aggiorna».
  `npm run versione` aggiorna insieme i `?v=` dei file e la cache del service worker.

### Aggiungerla alla schermata Home di iPhone

Apri l'indirizzo in **Safari** › tasto **Condividi** › **Aggiungi alla schermata Home**. L'app si apre a tutto schermo.
I giri salvati restano nel telefono (memoria del browser): se cancelli i dati di Safari li perdi, quindi
per i giri importanti tieni anche il link condiviso.

## Importare i GPX in BMW Motorrad Connected

I menu dell'app cambiano tra le versioni: i passi qui sotto valgono in generale.

1. In Tracce Moto calcola il giro e tocca **Invia a…** sotto «Traccia» o «Rotta».
2. Nel foglio di condivisione scegli **Connected** (se non c'è, scorri fino a «Altro»).
   In alternativa salva il file in **File** e da lì condividilo con Connected, oppure mandalo per e-mail e aprilo con Connected.
3. Il giro compare tra i percorsi salvati dell'app (sezione Percorsi / Le mie rotte). Aprilo, controlla che la linea
   sia quella attesa e avvia la navigazione con la moto collegata al TFT.

Consigli:

- Prova prima la **Rotta**: Connected calcola le indicazioni passando per i punti. Se ti porta su strade diverse o
  scarta dei punti, usa la **Traccia**.
- Se «Invia a…» scarica il file invece di aprire il foglio di condivisione, il browser non supporta la condivisione
  di file: apri l'app in Safari oppure condividi il file scaricato dall'app **File**.

## Importare i GPX su Garmin o BMW Motorrad Navigator

I BMW Motorrad Navigator sono costruiti da Garmin e si comportano come gli zūmo.

**Via cavo (vale per tutti):**

1. Collega il navigatore al computer con il cavo USB.
2. Copia il file `.gpx` nella cartella `GPX` della memoria interna (o della scheda SD).
3. Scollega il navigatore.
   - **Rotta**: apri **Pianificatore viaggi** (Trip Planner) › **Importa** e scegli il giro.
     Se chiede di ricalcolare, ricalcola: i punti di passaggio lo costringono sulle strade giuste.
   - **Traccia**: apri **Tracce** (Track Manager), scegli la traccia, mostrala sulla mappa oppure
     **Converti in viaggio** per avere le indicazioni.

**Senza cavo:** sui modelli recenti puoi usare l'app Garmin per smartphone abbinata al navigatore
(per esempio Garmin Drive o Tread, a seconda del modello) e importare il GPX dal foglio di condivisione di iPhone.
Su PC/Mac funziona anche Garmin BaseCamp.

Consigli:

- Le mappe del navigatore possono essere diverse da OpenStreetMap: nella rotta, ogni punto di passaggio è già sulla
  strada giusta per evitare scorciatoie, ma controlla sempre l'anteprima prima di partire.
- Alcuni modelli limitano il numero di punti di una rotta o la dividono in più parti. Se l'import fallisce
  o la rotta viene tagliata, dividi il giro in due o usa la Traccia.
- Imposta sul navigatore le stesse preferenze (per esempio «evita autostrade»), così il ricalcolo tra i punti
  segue la stessa logica.

## Privacy

- Nessun account, nessun cookie, nessuna statistica o pubblicità: il sito è statico e non ha un server suo.
- Giri salvati, giro in corso e preferenze restano nella memoria del browser del dispositivo (`localStorage`).
  L'indirizzo della pagina non contiene il giro (non finisce nella cronologia o nella sincronizzazione di Safari):
  il link con le tappe si crea solo con «Condividi link», e quando lo apri l'app lo toglie dall'indirizzo dopo averlo letto.
- Per funzionare l'app manda ai servizi pubblici di OpenStreetMap solo ciò che serve: testo cercato e punti toccati
  a Nominatim, coordinate delle tappe a Valhalla (FOSSGIS), posizione dei passi a Overpass, zone di mappa ai server
  delle tile. Questi servizi vedono l'indirizzo IP, come qualsiasi sito.
- La posizione GPS si legge solo quando tocchi «La mia posizione» o «Usa la mia posizione».
- Una Content Security Policy limita la pagina ai soli servizi elencati; ai siti esterni arriva solo il dominio
  (`strict-origin-when-cross-origin`), mai l'indirizzo completo.
- In «Privacy e dati» il pulsante **Cancella tutti i miei dati** elimina giri, preferenze e mappa salvata dal dispositivo.

## Limiti dei servizi gratuiti

- **Valhalla FOSSGIS** (`valhalla1.openstreetmap.de`): server pubblico mantenuto da volontari, senza garanzie di
  disponibilità. Ha limiti di uso (poche richieste al secondo, numero di tappe e lunghezza massima del percorso):
  per giri molto lunghi può rispondere con un errore, in quel caso dividi il giro. Se il profilo `motorcycle`
  non fosse disponibile l'app usa `auto` e lo segnala.
- **Nominatim**: al massimo 1 richiesta al secondo e niente autocompletamento (per questo la ricerca parte solo con invio).
  Un uso intenso può essere bloccato temporaneamente.
- **Giri lunghi**: il profilo moto del server ha un limite di distanza in linea d'aria per richiesta (di solito 500 km).
  Se il giro lo supera, l'app lo calcola automaticamente a pezzi e li unisce; se una singola tratta da sola supera
  il limite, quella volta usa il profilo auto e lo segnala (aggiungi una tappa intermedia per restare sul profilo moto).
- **Errori**: se il percorso non si può calcolare compare un avviso rosso sulla mappa; il dettaglio (con il codice
  dell'errore del server) è nella scheda «Percorso». Senza risposta entro un minuto l'app smette di aspettare.
- **Overpass** (`overpass-api.de`, per i versanti dei passi): server pubblico che a volte è occupato; in quel
  caso l'app lo dice e si può riprovare. Una sola richiesta per passo, solo quando scegli «Completo» o «Andata e ritorno».
- **Tile CARTO, OpenStreetMap e OpenTopoMap**: pensati per un uso leggero (CARTO è gratuito per uso non commerciale). OpenTopoMap arriva al massimo allo zoom 17
  e a volte è lento. Non c'è uso offline: scarica i GPX prima di partire.
- **Dati OpenStreetMap**: possono contenere errori e non conoscono chiusure stagionali o temporanee.
  Stelvio e Gavia, per esempio, sono chiusi d'inverno (indicativamente da fine ottobre/novembre a maggio/giugno):
  verifica sempre aperture, lavori e ordinanze.
- Tempi stimati: il router non conosce traffico, meteo e soste; per i passi alpini considera tempi più lunghi.

## Sviluppo

```
index.html              pagina, meta per iPhone, Leaflet da cdnjs
sw.js                   service worker: app offline e cache della mappa
manifest.webmanifest    manifest della PWA (icone, colori, avvio a tutto schermo)
css/style.css           stile mobile first, tema chiaro e scuro, safe area
js/core.js              funzioni pure: polyline, RDP, inserimento tappe, GPX, roadbook, stato nell'URL
js/places.js            funzioni pure per i luoghi: coordinate, varianti di ricerca, ordine dei risultati
js/passes.js            funzioni pure per i passi: versanti dalle strade OSM, passo completo o andata e ritorno
js/services.js          Valhalla e Nominatim (coda a 1 richiesta al secondo)
js/app.js               interfaccia
tests/core.test.mjs     test delle funzioni pure (Node, senza dipendenze)
tests/places.test.mjs   test della ricerca dei luoghi
tests/passes.test.mjs   test dei versanti dei passi (rete stradale sintetica)
tests/collaudo.mjs      collaudo con i servizi reali
```

Per provarla in locale serve un server statico qualsiasi (i moduli ES non funzionano da `file://`):

```sh
python3 -m http.server 8000      # poi apri http://localhost:8000
```

### Test

```sh
npm test                 # oppure: node --test tests/*.test.mjs
```

Copre la decodifica della polyline con precisione 6, la semplificazione della geometria, la generazione dei GPX
traccia e rotta (XML ben formato, ordine degli elementi GPX 1.1, estensioni) e la posizione migliore di una tappa intermedia.

### Collaudo con i servizi reali

```sh
npm run collaudo         # oppure: node tests/collaudo.mjs
```

Calcola Sirolo → Passo dello Stelvio → Passo del Gavia → Ponte di Legno evitando le autostrade e controlla che:

- i due GPX siano XML valido (con `xmllint` se installato; con `GPX_XSD=/percorso/gpx.xsd` anche lo schema GPX 1.1);
- la traccia segua le strade: scarto massimo di 4 m dalla geometria Valhalla nei due versi, più un controllo
  indipendente di map matching con `/trace_attributes`;
- i punti della rotta non cadano su strade parallele o in mezzo agli incroci: con `/locate` si controlla che entro
  20 m ci sia una sola strada, che sia quella della manovra e che il punto non sia attaccato alla svolta.

I GPX generati finiscono nella cartella `collaudo/` (esclusa da git) per controllarli a mano, per esempio su
[gpx.studio](https://gpx.studio/).
