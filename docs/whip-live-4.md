# Whip Live 4.0: cosa fa e cosa possiamo fare noi

Ricerca del 14 ottobre 2026. **Limite**: le pagine ufficiali (whip.live, App Store, Google Play, Moto.it) non sono
raggiungibili da qui; le informazioni vengono dai riassunti dei risultati di ricerca delle loro note di versione e di
articoli. Non ho provato l'app. **DA VERIFICARE** = non confermato da una fonte letta per intero.

## Cosa c'è in Whip Live 4.0 (uscita 17 settembre 2026)

| Funzione | Cosa fa |
| --- | --- |
| **CarPlay e Android Auto** | cerca luoghi, avvia la navigazione e registra il giro dallo schermo dell'auto |
| **Ride Mode** | schermo di guida a tutto schermo, pulsanti grandi usabili con i guanti, si attiva da solo con il telefono in carica o collegato |
| **Smart Route** | scegli tipo di veicolo e distanza, genera un giro completo (anello) da solo |
| **Profili e filtri** | nuovi profili Quad e 4x4; distanza personalizzata; «Cosa evitare» (autostrade, sterrato, strade trafficate) |
| **Collezioni** | salva i luoghi preferiti, crea collezioni, fissa le attività sulla mappa |
| **Navigazione** | waypoint imminenti sempre visibili, frecce di svolta sulla mappa, ricalcolo più intelligente, «torna al percorso» |
| **Norma™** (beta, solo Italia) | aiuta a capire se un percorso fuoristrada è legale; 4 livelli di prudenza, il predefinito toglie solo i tratti con divieto certo |

Già presenti prima della 4.0: pianificatore per tipo di veicolo (strada, enduro, maxi enduro, gravel, MTB, trekking…) con
**GDM** (25 profili, oltre 40 filtri: dislivello, pendenza, superficie, POI, segmenti), **importazione GPX**,
navigazione vocale turn by turn, tracking con statistiche, **live tracking** (link con la tua posizione), **segmenti**,
oltre 300.000 percorsi della comunità. **Plus** (59,99 €/anno): mappe offline, pianificatore senza limiti di punti,
waypoint, distanza e POI. Ultimi aggiornamenti Android: GPS predittivo e segnalazioni pubbliche su cancelli e proprietà
private (**DA VERIFICARE**).

Altro segnale di mercato: **Waze** ha introdotto a luglio 2026 una modalità moto e la ricerca con Gemini.

## Cosa possiamo fare noi

Regole: gratis se non costa un server; Plus se serve un server o fa risparmiare molto tempo; niente navigazione in-app
(scelta del progetto) e niente fuoristrada per ora.

| # | Funzione Whip | Per Traccemoto | Come | Fatica | Gratis / Plus |
| --- | --- | --- | --- | --- | --- |
| 1 | **Smart Route** (giro per distanza) | **Sì, la prima** | si sceglie partenza, distanza e stile (curvoso/veloce); l'app genera 4-6 anelli candidati (3-4 punti a raggio ≈ distanza/2π in direzioni diverse), li calcola, scarta quelli lontani dalla distanza (±15%) o che ripassano sulla stessa strada, e propone i 3 migliori per curve/km. Serve il calcolo dei percorsi: sul server gratuito 4-6 richieste per giro | M | Gratis (3 proposte), Plus (più varianti, distanza fino a 600 km) |
| 2 | **Collezioni** | Sì | «Luoghi preferiti» e raccolte (es. «Passi alpini», «Pizzerie») nel dispositivo; un tocco per aggiungere alle tappe; esporta/importa come file | S-M | Gratis sul dispositivo, sincronizzazione in Plus |
| 3 | **Cosa evitare** + profili veicolo | Sì | oggi: autostrade, pedaggi, traghetti, sterrato. Aggiungere: «strade trafficate» (**DA VERIFICARE** quale opzione del motore lo permetta) e un profilo «Strada / Adventure» che consente lo sterrato leggero | S | Gratis |
| 4 | **Filtri GDM** (pendenza, superficie) | In parte | profilo altimetrico già presente: avviso e filtro su pendenze oltre il 10-12% e sulle strade non asfaltate lungo il giro (`trace_attributes` del motore) | M | Gratis |
| 5 | **POI lungo il percorso** | Sì | distributori, passi, belvedere, officine entro N km dal giro (Overpass), con «Aggiungi al giro»; con l'autonomia del serbatoio segnala i tratti senza benzina | M | Gratis (base), Plus (autonomia, più categorie) |
| 6 | **Percorsi della comunità** | Versione curata | pagine «Giri consigliati»: descrizione, profilo, GPX, «Apri nello strumento». Sono anche contenuti per Google e per gli annunci. Contributi degli utenti solo più avanti (serve moderazione e un server) | S per giro | Gratis |
| 7 | **Tracking e statistiche** | Solo analisi | un browser non può registrare in background in modo affidabile. Si può invece **analizzare un GPX registrato**: distanza, dislivello, curve, profilo, tempo in movimento, e creare il roadbook. Pagina tipo «Analizza il tuo giro» (nuova pagina per la ricerca) | S-M | Gratis |
| 8 | **Norma™** (legalità fuoristrada) | No (per ora) | non facciamo fuoristrada e non abbiamo dati legali affidabili. Restiamo con gli avvisi su divieti noti (Tirolo, vignette, passi chiusi in stagione): sempre con «verifica la fonte ufficiale», mai «è legale» | S | Gratis |
| 9 | **Mappe offline** (Plus) | Non con le tile OSM | la policy di OpenStreetMap vieta lo scarico massivo delle tile. Servirebbe una fonte nostra (OpenFreeMap/PMTiles). Per navigare offline si esportano i GPX verso OsmAnd o Whip | L | Plus, più avanti |
| 10 | **CarPlay / Android Auto** | Non nativo | un sito web non può essere un'app CarPlay. Si ottiene lo stesso risultato con i **link per Apple Mappe**: la navigazione avviata su iPhone compare su CarPlay (**DA VERIFICARE** su un'auto) | — | Già fatto |
| 11 | **Ride Mode, navigazione vocale, GPS predittivo** | No | appartengono alla navigazione, tolta per scelta; ci sono Whip, OsmAnd e le app di mappe | — | — |
| 12 | **Live tracking, segmenti, segnalazioni** | No (per ora) | servono un server in tempo reale, account e moderazione; hanno anche rischi di privacy e responsabilità | L | Plus, forse mai |

## Dove siamo già avanti
- Si parte da **un elenco di località** (Whip: si disegna sulla mappa).
- **Nessun limite** di tappe, punti o distanza (in Whip stanno in Plus).
- **Roadbook da rally** e convertitore GPX → roadbook, e **link per Google Maps e Apple Mappe**: Whip non li ha.
- Profilo altimetrico scorrevole, passi di montagna con versante a scelta, **gratis e senza account**.

## Ordine consigliato
1. **Smart Route** (anelli per distanza): è la novità più visibile di Whip 4.0 e la più cercata («giro in moto di 150 km da casa»).
2. **Analizza il tuo giro** (GPX registrato): poco lavoro, riusa codice già fatto, porta traffico da Google.
3. **Collezioni / luoghi preferiti** e **«Cosa evitare» esteso**: piccoli, rendono lo strumento più comodo.
4. **POI e autonomia**, poi **Giri consigliati** (contenuti).
Il resto dopo il lancio di Plus e il server dei percorsi.
