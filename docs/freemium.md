# Modello freemium: decisioni e piano

Decisioni del 4 ottobre 2026.

## Decisioni

- **Freemium**, più economico dei concorrenti (Whip Live Plus 59,99 €/anno, Calimoto ~59,99 €, Scenic 59,90 $,
  REVER Pro 39,99 $, OsmAnd Pro 39,99 $, Kurviger Tourer+ 29,99 € / Tourer 14,99 €).
- **Oggi niente partita IVA**: donazioni (regali, senza nulla in cambio) e AdSense nelle guide. Lancio professionale
  solo se funziona.
- **Ordine**: prima online gratis + **lista d'attesa** per Plus; poi account, pagamenti e prime funzioni Plus.
- **Piano Organizzatori** (motoclub, raduni, rally amatoriali) più avanti.
- Prezzo di Plus: **da decidere** al lancio. Proposta: 9,99 €/anno, solo annuale (con un *merchant of record* la
  commissione fissa di ~0,50 € pesa troppo sui mensili); alternativa da valutare: pass stagionale.

## Gratis per sempre

Giro dall'elenco delle località, GPX turn by turn / traccia / rotta, link per Google Maps e Apple Mappe, profilo
altimetrico, passi di montagna, roadbook base stampabile, convertitore GPX → roadbook, giri salvati sul dispositivo.

## Plus (quando ci sarà)

Roadbook Pro (editor, pericoli, waypoint, OpenRally completo), viaggi in più giorni, autonomia e rifornimenti, meteo
all'ora di passaggio, tre varianti e giro ad anello, giri sincronizzati tra dispositivi, niente pubblicità.

## Cosa servirà per il lancio a pagamento

| Cosa | Come (costo fisso basso) | Note |
| --- | --- | --- |
| Partita IVA, condizioni di vendita, recesso | commercialista | prima di incassare |
| Pagamenti e IVA UE | Paddle o Lemon Squeezy (*merchant of record*), ~5% + 0,50 € a transazione | Stripe costa meno ma l'IVA estera resta a carico nostro |
| Account | accesso con link via email, Cloudflare Workers + D1 (piano gratuito) | invio email: servizio da scegliere (piani gratuiti da verificare) |
| Calcolo dei percorsi | server nostro (Valhalla o BRouter) o openrouteservice | primo costo fisso vero, indicativamente 5-20 €/mese (**DA VERIFICARE**); obbligatorio per un servizio commerciale |
| Blocchi Plus | le funzioni di valore passano dal server (sincronizzazione, meteo, varianti) | nel browser i blocchi si possono aggirare |

## Indicatori per decidere il lancio

- Visite mensili allo strumento e alle guide (Search Console).
- Iscritti alla lista d'attesa (D1).
- Donazioni ricevute.

Se la lista d'attesa cresce e qualcuno dona senza che glielo chiediamo, è il segnale per passare alla fase a pagamento.
