# Cosa manca alle app di navigazione, e cosa possiamo fare gratis

Ricerca del 4 ottobre 2026. Obiettivo: trovare i vuoti delle app più usate (Google Maps, Apple Mappe, Waze per
tutti; Calimoto, Kurviger, REVER, Scenic, Whip Live, OsmAnd per le moto) che Traccemoto può riempire **in fase di
pianificazione**, gratis, senza server nostri e senza chiavi a pagamento.

## Cosa manca oggi

**App generaliste (Google Maps, Apple Mappe, Waze)**
- Non importano GPX e accettano pochi punti intermedi: un giro preciso non ci entra (risolto in parte con i link a
  tratte).
- Non sanno cosa sia un «bel giro»: cercano la strada più veloce. In più non c'è l'opzione «solo asfalto».
- Non pianificano più giorni, soste, rifornimenti.
- Non sanno di passi chiusi per la stagione, divieti per le moto rumorose o vignette autostradali.

**App per moto**
- Calimoto: utenti scontenti di crash, chiusure stradali non aggiornate, costo dell'abbonamento, niente modalità
  notte, poche informazioni sulla mappa (distributori) durante la guida.
- REVER: quasi tutto (meteo, percorsi più tortuosi) è nella versione a pagamento.
- Scenic: solo iPhone. Kurviger: niente funzioni social; ricerca indirizzi debole fuori Europa.
- Fonti: [SlashGear](https://www.slashgear.com/1755865/motorcycle-apps-find-routes-track-rides/),
  [motobit](https://www.getmotobit.com/the-5-best-motorcycle-apps/),
  [Kurvo](https://kurvo.app/blog/best-motorcycle-navigation-app-2026).

Il vuoto più chiaro: **nessuno parte da un elenco di località** e quasi nessuno fa i controlli «prima di partire»
(carburante, passi, divieti, luce, meteo in quota) in modo gratuito.

## Proposte, in ordine di valore per fatica

| # | Funzione | Problema che risolve | Come, gratis | Fatica | Note e rischi |
| --- | --- | --- | --- | --- | --- |
| 1 | **Autonomia e distributori** | Restare a secco in valle | Inserisci l'autonomia (es. 250 km). Overpass cerca i distributori (`amenity=fuel`) vicino al percorso; l'app segnala i tratti più lunghi dell'autonomia senza distributori e propone dove fare il pieno, con i punti nel GPX | M | Overpass pubblico ha limiti d'uso: una richiesta per giro, con cache. Orari e self-service in OSM sono incompleti |
| 2 | **Luce del giorno** | Arrivare al passo col buio | Calcolo locale di alba e tramonto (formula astronomica, nessun servizio). Data e ora di partenza: «arrivi alle 19:40, tramonto alle 19:12» | S | Nessuno: solo calcolo |
| 3 | **Giro in più giorni** | Pianificare un viaggio | Ore di guida al giorno (es. 6 h): l'app propone le tappe per la notte, mostra il riepilogo per giorno e scarica un GPX per giorno | M | I tempi del router sono ottimisti: aggiungere soste (es. 15 min ogni 1,5 h) |
| 4 | **Vignette e confini** | Multa in autostrada in Svizzera, Austria, Slovenia… | Valhalla può dire in quali paesi passa il percorso (`admin_crossings`, [doc](https://valhalla.github.io/valhalla/api/route/api-reference/)). Se il giro usa autostrade in un paese con vignetta: avviso e invito a «Evita autostrade» | S | Elenco dei paesi con vignetta da tenere aggiornato a mano; niente prezzi |
| 5 | **Divieti per moto rumorose in Tirolo** | 220 € di multa | Elenco curato delle strade (es. L198 Lechtal, L246/L72 Hahntennjoch, L21 Berwang-Namlos, L199 Tannheimer, L266 Bschlaber, dal 15 aprile al 31 ottobre, oltre 95 dB da fermo) e avviso se il percorso le usa | S | Regole che cambiano: fonte ufficiale da ricontrollare ogni anno ([motorcycles.news](https://www.motorcycles.news/en/tyrol-banning-of-motorcycles-over-95-db-remains-in-place/)) |
| 6 | **Passi stagionali** | Trovare la sbarra chiusa | Elenco curato dei principali passi alpini con periodo di chiusura tipico e link alla fonte ufficiale; avviso se il giro ne attraversa uno fuori stagione. In aggiunta i tag OSM `seasonal` / `motor_vehicle:conditional` | M | Le date reali cambiano ogni anno: mostrare solo «di solito chiuso da… a…» più il link ufficiale |
| 7 | **Passi e panorami vicino al giro** | «Cosa mi perdo a 10 km?» | Overpass: passi (`mountain_pass=yes`) e belvedere (`tourism=viewpoint`) entro N km dal percorso, con «Aggiungi al giro» | M | Stessi limiti di Overpass del punto 1 |
| 8 | **Pendenze e tornanti** | Pendenze forti, moto carica, passeggero | Dal profilo altimetrico già calcolato: tratti oltre il 10-12% e tornanti segnati sulla mappa | S | La quota del servizio è approssimata: avvisi solo per tratti lunghi |
| 9 | **Meteo in quota all'ora di passaggio** | Freddo e temporali sui passi | MET Norway Locationforecast: gratis anche per uso commerciale, licenza CC, dal browser con l'intestazione Origin ([api.met.no](https://api.met.no/), [HowTo](https://api.met.no/doc/locationforecast/HowTO)). Previsione nei punti più alti all'ora stimata di arrivo | M | Open-Meteo **no**: il piano gratuito è solo non commerciale ([prezzi](https://open-meteo.com/en/pricing)) |
| 10 | **Il giro esatto su Google** | Vedere il tracciato vero su Google | Esportazione KML e guida per Google My Maps | S | Solo visualizzazione, non navigazione |
| 11 | **Condividi con il gruppo** | Mandare il giro a chi viene con te | QR code del link e del GPX, generato nel browser | S | Libreria QR da cdnjs |
| 12 | **Sterrati «noti»** | Strade bianche sì, mulattiere no | Profilo BRouter personalizzato: solo `tracktype=grade1/grade2`, senza `smoothness` cattiva | L | Serve BRouter (fase 2 del documento di passaggio). Oggi Valhalla non distingue così bene |
| 13 | **Giro ad anello da qui** | «Ho 3 ore, fammi fare un bel giro» | Punti casuali attorno alla partenza + la scelta panoramica già presente | L | Risultati variabili: da provare molto |

Fatica: **S** = una sessione di lavoro, **M** = qualche sessione, **L** = una milestone.

## Cosa consiglio di fare per primo

1. **Luce del giorno** e **vignette/Tirolo** (2, 4, 5): poco lavoro, nessun servizio nuovo, utili subito, e nessuna
   app gratuita le fa insieme.
2. **Autonomia e distributori** (1): è la funzione più richiesta da chi viaggia in moto e l'app generalista non la fa.
3. **Giro in più giorni** (3): trasforma lo strumento da «giro della domenica» a «viaggio», e porta visite alle guide.

Le altre dopo la migrazione del calcolo dei percorsi (Cloudflare Worker + openrouteservice/BRouter), che resta
il prerequisito per gli annunci (vedi `docs/guadagni.md`).

## Da non fare

- **Avvisi autovelox**: in alcuni paesi (Francia, Svizzera) segnalare la posizione dei controlli è vietato.
- **Prezzi dei carburanti**: le fonti gratuite affidabili sono nazionali e con condizioni d'uso diverse; da
  valutare solo per l'Italia, con una verifica legale delle condizioni.
- **Navigazione in-app**: tolta per scelta. Lo strumento pianifica; per guidare si usano OsmAnd, Whip Live, Google
  o Apple.
