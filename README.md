# Tracce Moto

Web app statica per progettare giri in moto ed esportare file GPX da seguire svolta per svolta
con **BMW Motorrad Connected** o con un navigatore montato sulla predisposizione GPS
(BMW Motorrad Navigator, Garmin zūmo e simili). Pensata per iPhone, funziona su qualsiasi browser moderno.

- Solo HTML, CSS e JavaScript (ES modules): nessun build step, nessun backend, nessuna chiave API.
- Mappa [Leaflet](https://leafletjs.com/) con OpenStreetMap e OpenTopoMap.
- Percorsi calcolati da [Valhalla](https://valhalla.github.io/valhalla/) sul server pubblico FOSSGIS, con profilo moto.
- Ricerca luoghi con [Nominatim](https://nominatim.org/).

## Funzioni

- **Giro dalle località**: scrivi le località una per riga (es. Sirolo, Passo dello Stelvio, Passo di Gavia,
  Ponte di Legno) e tocca «Crea giro»: le tappe vengono cercate in ordine e il percorso si calcola da solo.
- **Tappe**: partenza, intermedie e arrivo, dalla ricerca (premi invio) o toccando la mappa.
  Ogni nuovo punto va «in fondo» oppure «come intermedia»: in questo caso viene inserito dove allunga meno il giro.
  I marker sono numerati e trascinabili; le tappe si riordinano con le frecce, si rinominano e si eliminano.
- **Sosta o passaggio** per ogni tappa intermedia (in Valhalla: `break` o `through`). Un passaggio non spezza il percorso
  in tratte e non permette inversioni a U lì.
- **Torna alla partenza** per costruire anelli.
- **Preferenze**: autostrade Evita / Se serve / Normale (`use_highways` 0 / 0,5 / 1), pedaggi, traghetti,
  sterrato (`use_trails` 0 per evitarlo), percorso più veloce o più corto.
- **Risultato**: linea sulla mappa, km e tempo totali e per tratta, roadbook con km progressivi in italiano e «Copia roadbook».
  Tocca una riga del roadbook per vedere il punto sulla mappa.
- **Export GPX 1.1** (vedi sotto) con «Scarica» e «Invia a…» (foglio di condivisione di iPhone).
- **Salvataggio** dei giri sul dispositivo e **link condivisibile**: lo stato del giro è nell'indirizzo, quindi un link
  aperto sul telefono mostra lo stesso giro preparato sul PC.

## Traccia o Rotta?

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

## Limiti dei servizi gratuiti

- **Valhalla FOSSGIS** (`valhalla1.openstreetmap.de`): server pubblico mantenuto da volontari, senza garanzie di
  disponibilità. Ha limiti di uso (poche richieste al secondo, numero di tappe e lunghezza massima del percorso):
  per giri molto lunghi può rispondere con un errore, in quel caso dividi il giro. Se il profilo `motorcycle`
  non fosse disponibile l'app usa `auto` e lo segnala.
- **Nominatim**: al massimo 1 richiesta al secondo e niente autocompletamento (per questo la ricerca parte solo con invio).
  Un uso intenso può essere bloccato temporaneamente.
- **Tile OpenStreetMap e OpenTopoMap**: pensati per un uso leggero. OpenTopoMap arriva al massimo allo zoom 17
  e a volte è lento. Non c'è uso offline: scarica i GPX prima di partire.
- **Dati OpenStreetMap**: possono contenere errori e non conoscono chiusure stagionali o temporanee.
  Stelvio e Gavia, per esempio, sono chiusi d'inverno (indicativamente da fine ottobre/novembre a maggio/giugno):
  verifica sempre aperture, lavori e ordinanze.
- Tempi stimati: il router non conosce traffico, meteo e soste; per i passi alpini considera tempi più lunghi.

## Sviluppo

```
index.html              pagina, meta per iPhone, Leaflet da cdnjs
css/style.css           stile mobile first, tema chiaro e scuro, safe area
js/core.js              funzioni pure: polyline, RDP, inserimento tappe, GPX, roadbook, stato nell'URL
js/services.js          Valhalla e Nominatim (coda a 1 richiesta al secondo)
js/app.js               interfaccia
tests/core.test.mjs     test delle funzioni pure (Node, senza dipendenze)
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
