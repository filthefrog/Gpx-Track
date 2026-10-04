# Roadbook da rally: requisiti e scelte

Analisi del 4 ottobre 2026 per la funzione «Roadbook da rally» (`js/roadbook.js`, scheda nello strumento).
**DA VERIFICARE** = non confermato da un documento ufficiale letto per intero o da una prova sul campo.

## Fonti

- FIM, regolamenti Rally-Raid (W2RC 2025) e appendici Cross-Country Rallies: definizioni di WPM, WPE, WPS,
  DSS/ASS, DZ/FZ e livelli di pericolo (riassunti da fonti secondarie: il sito FIM non è raggiungibile da qui).
- FMI, *Regolamento Motorally 2025* (federmoto.it): il Road-Book contiene tutte le indicazioni del percorso;
  **dimensioni, formato e simbologia sono forniti dal Comitato Motorally con apposito software**; il RB, verificato
  e approvato alla vigilia della gara, è incontestabile. Prime due colonne: distanze progressive e parziali.
  (Letto tramite estratti di ricerca: il PDF non è raggiungibile da qui. **DA VERIFICARE** il testo integrale.)
- Impaginazione FIA/FIM della colonna delle distanze (totale grande in alto, parziale in un riquadro in basso a
  sinistra, numero della casella piccolo in basso a destra; parziale evidenziato sotto i 300 m):
  [alvarofranz/roadbook #1008](https://github.com/alvarofranz/roadbook/issues/1008).
- Rotoli per porta-roadbook: **148,5 mm** (larghezza A5) per i rotoli «FIA/FIM specification»; i porta-roadbook
  accettano rotoli fino a 150 mm ([ADVrider](https://www.advrider.com/f/threads/genuine-fia-fim-specification-roadbook-rally-raid-paper-rolls-90-gsm-148-5mm-a5-width-45m-length.1637945/)).
- **OpenRally** v1.0.3 cross-country: schema XSD ed esempio ufficiali da
  [github.com/openrally/openrally](https://github.com/openrally/openrally) (CC BY 4.0). Supportato da Rally
  Navigator, RiverNotes, TowerOne, Rally Comp, RallyBlitz, F2R γ1000. Copia degli schemi in `tests/openrally/`.

## Requisiti e come sono soddisfatti

| Requisito | Fonte | Traccemoto |
| --- | --- | --- |
| Una casella per ogni punto di decisione, numerata | FIA/FIM, FMI | Una casella per manovra (svolte, rotonde, «dritto» agli incroci, tappe); i cambi di nome della strada non fanno casella |
| Distanza totale e parziale, al centesimo di km | FIA/FIM, FMI | Totale dalla partenza e parziale dalla casella prima, due decimali |
| Parziale evidenziato sotto i 300 m | FIA (impaginazione) | Riquadro grigio e bordo spesso (stampa anche in bianco e nero). Il colore ufficiale (verde?) è **DA VERIFICARE** |
| Tulipano: arrivo dal pallino, uscita con la freccia | FIA/FIM | SVG generato: incrocio con ramo di arrivo e uscita; rotonde in senso antiorario con le uscite lasciate |
| CAP (bussola, 0-359) | FIA/FIM | Direzione misurata sui 35 m dopo la manovra |
| Note, pericoli `!` `!!` `!!!` | FIM | Note automatiche: strada, «verso…», tappa, tornanti nel tratto. **I pericoli non sono automatici**: vanno aggiunti da chi fa il sopralluogo |
| Waypoint WPM/WPE/WPS/WPV, DSS/ASS, DZ/FZ | FIM | Non generati: li decide l'organizzatore. Il formato OpenRally li supporta, si potranno aggiungere con un editor |
| Rotolo 148,5 mm | rotoli FIA/FIM | Stampa «Rotolo 148,5»: A4 orizzontale con due strisce da 148,5 mm da tagliare e unire |
| Ordine di lettura | porta-roadbook | Scelta «Dall'alto» / «Dal basso» (dipende da come scorre il rotolo nel proprio porta-roadbook: **DA VERIFICARE** sul campo) |
| Roadbook digitale | OpenRally | GPX OpenRally v1.0.3: per ogni casella `distance`, `cap`, `tulip` e `notes` in SVG, più la traccia. **Validato con lo schema ufficiale** (test automatico con xmllint) |
| Formato ufficiale FMI | FMI | Non replicabile: il Comitato usa un suo software. Il nostro roadbook è per allenamento, turismo, raduni e rally amatoriali |

## Limiti noti

- **Strade laterali nei tulipani**: il percorso calcolato conosce solo la strada di arrivo e quella di uscita.
  Per disegnare tutte le strade dell'incrocio servirebbe una richiesta in più (Valhalla `trace_attributes` con gli
  `intersecting_edges`, oppure Overpass): previsto, da fare dopo la migrazione del calcolo dei percorsi.
- **Traffico a sinistra** (Regno Unito, Irlanda…): le rotonde sono disegnate per la circolazione a destra.
- **GPX con sola traccia**: le svolte si ricavano dalla forma (cambi di direzione ≥ 45° su ±25 m, caselle distanti
  almeno 80 m). Sui passi segnala anche i tornanti: per un roadbook va bene, ma va ricontrollato.
- **Precisione delle distanze**: quelle del calcolo dei percorsi (OpenStreetMap). Il tripmaster va tarato e
  riallineato a ogni casella, come sempre.

## Prossimi passi possibili

1. Editor delle caselle: note libere, pericoli `!`-`!!!`, waypoint e zone (DSS/ASS, DZ/FZ) esportati in OpenRally.
2. Strade laterali nei tulipani (vedi sopra).
3. Prova con un dispositivo o un'app OpenRally reale e con un porta-roadbook a rotolo.
