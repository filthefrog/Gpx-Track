# Concorrenti: cosa fanno pagare, cosa possiamo dare gratis

Ricerca del 4 ottobre 2026. Completa `docs/proposte.md` (vuoti delle app di navigazione, «controlli prima di
partire»). Qui il punto di vista è diverso: **quali funzioni a pagamento dei concorrenti Traccemoto può offrire
gratis**, restando un pianificatore web senza server propri e senza costi fissi.

## Cosa costa altrove

| App | Gratis | A pagamento |
| --- | --- | --- |
| **Whip Live** | percorsi, tracking, navigazione vocale, live tracking | **Plus**: mappe offline, pianificatore senza limiti di punti, waypoint e distanza, POI «Plus» |
| **OsmAnd** | navigazione offline, 7 mappe, «Pianifica percorso» | **Maps+** (14,99 $/anno): mappe illimitate, rilievo, Android Auto. **Pro** (39,99 $/anno): meteo, **profilo altimetrico online**, cloud, aggiornamenti orari |
| **Kurviger** | pianificazione su web, profili di curvosità | **Tourer** (14,99 €/anno): **anelli fino a 600 km**, **sterrati e chiusure lungo il percorso**, curvosità per tratto, **3 profili a confronto**, export «stabilizzato», niente pubblicità. **Tourer+** (29,99 €/anno): navigazione e mappe offline |
| **Calimoto / REVER** | base | percorsi tortuosi, meteo, live tracking in abbonamento |

Fonti: [Whip Live su App Store](https://apps.apple.com/it/app/whip-live-moto-bici-trekking/id1364504820),
[OsmAnd acquisti](https://osmand.net/docs/user/purchases/android/),
[confronto app offline](https://bikesandbays.com/blog/best-offline-motorcycle-navigation-apps/),
[Kurviger Tourer](https://docs.kurviger.com/web/kurviger_tourer),
[Kurviger funzioni](https://kurviger.com/en/features),
[SlashGear](https://www.slashgear.com/1755865/motorcycle-apps-find-routes-track-rides/).

## Cosa Traccemoto dà già gratis

- Tappe e distanza senza limiti; i giri lunghi si calcolano a pezzi (a pagamento in Whip Plus).
- **Profilo altimetrico** con cursore sulla traccia (a pagamento in OsmAnd Pro).
- Export pensato per i navigatori, con punti dopo ogni svolta (simile all'export «stabilizzato» di Kurviger
  Tourer).
- Partire da un **elenco di località**: nessun concorrente lo fa.
- Link per Google Maps e Apple Mappe con i punti di forzatura.
- Passi di montagna: completo o andata e ritorno, scegliendo il versante.
- Niente account e niente pubblicità nello strumento.

## Le funzioni «top» da fare, gratis e fatte bene

In ordine di valore (per chi usa lo strumento e per il sito) diviso fatica. **S** = una sessione, **M** = qualche
sessione, **L** = una milestone.

| # | Funzione | Altrove | Come, senza costi | Fatica |
| --- | --- | --- | --- | --- |
| 1 | **Giri consigliati**: pagine con itinerari curati (es. «Quattro passi delle Dolomiti»), con descrizione, profilo, GPX e «Apri nello strumento» | Whip: 300.000 percorsi della community (serve un server) | Pagine statiche generate come le guide: sono anche **contenuti per AdSense e per Google**. Si parte con 10 giri scritti bene | S per giro |
| 2 | **Sterrati e strade strette segnati sul percorso**, prima di partire | Kurviger Tourer | Valhalla `trace_attributes` sulla traccia calcolata: superficie e classe di ogni tratto, evidenziati sulla mappa e sul profilo | M |
| 3 | **Tre varianti a confronto** sulla mappa (veloce, equilibrata, tortuosa), con km, tempo e curve, e scelta col dito | Kurviger Tourer | Le alternative le chiediamo già al server per la Panoramica: basta mostrarle tutte | M |
| 4 | **Punti utili lungo il giro**: distributori, passi, belvedere, officine moto, campeggi | Whip Plus (POI Plus) | Overpass (OpenStreetMap), una richiesta per giro, con cache | M |
| 5 | **Autonomia e rifornimenti** (vedi proposte.md, punto 1) | quasi nessuno | Overpass + calcolo locale | M |
| 6 | **Meteo all'ora di passaggio** sui punti più alti | OsmAnd Pro, REVER Pro | MET Norway (gratis anche per uso commerciale, licenza CC) | M |
| 7 | **Roadbook stampabile** per la borsa da serbatoio: svolte, km parziali e progressivi, a caratteri grandi, in PDF | pochi | Pagina di stampa dal roadbook che c'è già | S |
| 8 | **Giro ad anello per distanza** («da qui, 150 km, tortuoso») | Kurviger Tourer | Punti attorno alla partenza + scelta Panoramica; si confrontano 2-3 tentativi | L |
| 9 | **Luce del giorno, vignette, divieti in Tirolo** (proposte.md, 2, 4, 5) | nessuno insieme | Calcolo locale ed elenchi curati | S |
| 10 | **Giro in più giorni** con un GPX per giorno (proposte.md, 3) | pochi | Calcolo locale | M |

Restano fuori, perché richiedono un server nostro o costano: live tracking, community con caricamento dei
giri, mappe offline e navigazione (per quelle si usano OsmAnd, Whip Live, Google e Apple).

## Proposta di ordine

1. **Giri consigliati** (1) e **roadbook stampabile** (7): poca fatica. Il primo porta visite alle pagine con
   gli annunci, il secondo è utile a chi viaggia.
2. **Luce del giorno, vignette, Tirolo** (9): avvisi gratuiti che nessuno dà insieme.
3. Dopo la migrazione del calcolo dei percorsi (prerequisito per gli annunci, vedi `docs/guadagni.md`):
   **sterrati sul percorso** (2), **tre varianti** (3), **punti utili e autonomia** (4, 5), **meteo** (6).
4. **Anello per distanza** (8) e **più giorni** (10) come milestone a parte.
