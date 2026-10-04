# Verifiche su limiti e parametri esterni

Ogni numero usato dall'app per servizi di terzi, con la fonte e lo stato. «DA VERIFICARE» = non confermato da
documentazione ufficiale o da una prova su telefono vero: non va dato per buono.

Ultimo controllo: 4 ottobre 2026.

## Google Maps URLs

Fonte: <https://developers.google.com/maps/documentation/urls/get-started>

| Cosa | Valore | Stato |
| --- | --- | --- |
| Formato | `https://www.google.com/maps/dir/?api=1&origin=…&destination=…&travelmode=driving&waypoints=a%7Cb` | verificato (documentazione) |
| Punti intermedi | 3 su browser mobile, 9 altrove | verificato (documentazione) |
| Lunghezza massima dell'URL | 2048 caratteri | verificato (documentazione) |
| Evitare autostrade/pedaggi | nessun parametro nei link web `api=1` (esiste solo negli intent Android) | verificato (documentazione) |
| Comportamento reale con 3 punti nell'app Google Maps su iPhone | — | DA VERIFICARE su iPhone |
| Waypoint che restano "via" e non diventano soste | — | DA VERIFICARE su iPhone e Android |

## Apple Mappe (unified Maps URLs)

Fonte: <https://developer.apple.com/documentation/mapkit/unified-map-urls>

| Cosa | Valore | Stato |
| --- | --- | --- |
| Formato | `https://maps.apple.com/directions?source=…&destination=…&waypoint=…&mode=driving` | verificato (documentazione) |
| `waypoint` ripetuto per più punti | sì | verificato (documentazione) |
| `avoid` | `tolls`, `highways`, `busy-roads`, `stairs` | verificato (documentazione) |
| Numero massimo di `waypoint` | non dichiarato; l'app ne usa 3 per tratta | DA VERIFICARE su iPhone |
| Versione minima di iOS per i nuovi URL | iOS 18.4 secondo la documentazione | DA VERIFICARE su iPhone |

## Valhalla (FOSSGIS) e altri servizi

| Cosa | Valore | Stato | Fonte |
| --- | --- | --- | --- |
| Uso del server pubblico | demo/uso leggero, non per servizi di terzi in produzione | verificato | <https://github.com/valhalla/valhalla/discussions/3373> |
| Limite di distanza profilo moto | ~500 km in linea d'aria (errore 154) | osservato nelle risposte del server | — |
| Nominatim | max 1 richiesta/s, niente autocompletamento, cache, User-Agent/Referer identificativo | verificato | <https://operations.osmfoundation.org/policies/nominatim/> |
| Tile OpenStreetMap | uso leggero, niente uso commerciale intenso | verificato | <https://operations.osmfoundation.org/policies/tiles/> |
| Tile CARTO | gratuite per uso non commerciale | DA VERIFICARE prima di qualsiasi monetizzazione | — |

## Da provare su telefono vero (fine milestone M3)

1. Su iPhone: apri ogni tratta in Apple Mappe e controlla che i punti di forzatura siano tutti presenti come tappe
   del percorso e che la strada resti quella del giro.
2. Su iPhone con Google Maps installato: stessa prova con «Google». Se Google taglia i punti, il limite di 3 è giusto.
3. Su computer: «Google su PC» con fino a 9 punti per tratta.
4. Un giro con un passo (es. Stelvio da Bormio, discesa verso Trafoi) per vedere i punti «per tenere la strada scelta».
5. Senza rete o con il server di calcolo fuori uso: la modalità «solo tappe».
