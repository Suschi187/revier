# COSTS – Laufende Kosten von Huntery (Arbeitsname)

Stand: 2026-11-15. Dies ist eine **Planungsrechnung mit Annahmen**, keine Zusage. Preise ändern sich häufig und müssen vor jeder Buchung auf den offiziellen Preisseiten geprüft werden (Links in Abschnitt 9). Beträge von Supabase und Vercel sind in US-Dollar (USD), Hetzner in Euro (EUR). Umrechnungskurs und Umsatzsteuer sind nicht eingerechnet.

## 1. Zweck
- Die monatlichen Betriebskosten für drei Nutzungsgrößen abschätzen
- Die Kostentreiber sichtbar machen, bevor sie teuer werden
- Eine Grundlage für die Hosting-Entscheidung (SPEC 7.9) und die Entscheidung Supabase Pro (Free reicht nur für die Entwicklung)

## 2. Annahmen (zum Überschreiben, sobald es echte Messwerte gibt)

| Größe | Klein (S) | Mittel (M) | Groß (L) |
|---|---|---|---|
| Aktive Anzeigen | 500 | 5.000 | 50.000 |
| Monatlich aktive Nutzer (MAU) | 2.000 | 20.000 | 100.000 |
| Seitenaufrufe pro Monat | 20.000 | 300.000 | 3.000.000 |
| Fotos je Anzeige (Durchschnitt) | 6 | 6 | 6 |
| Speicher je Foto nach Verarbeitung (alle Varianten) | 0,5 MB | 0,5 MB | 0,5 MB |
| Daten pro Seitenaufruf (ohne Zwischenspeicher) | 1 MB | 1 MB | 1 MB |
| Anteil aus dem Zwischenspeicher (mit Bildoptimierung/Cache) | 90 % | 90 % | 90 % |
| Datenbankgröße | unter 8 GB | unter 8 GB | unter 8 GB |

*Offene Messwerte, die die Annahmen verbessern:* tatsächliche Fotogröße nach der Verarbeitung (aus M3 und dem Lasttest), Daten pro Seitenaufruf (aus der Web-App messen), tatsächliche Nutzerzahlen nach dem Start.

## 3. Feste Posten pro Monat

**Supabase (Datenbank, Anmeldung, Fotos, Chat, Edge Functions)**
- Free: 0 USD; nur für Entwicklung. Kleine Kontingente, inaktive Projekte können pausiert werden, kein Produktivbetrieb.
- **Pro: 25 USD** je Organisation. Enthalten: 8 GB Datenbank, 100 GB Dateispeicher, 250 GB Datenverkehr, 100.000 MAU, tägliche Sicherungen, 10 USD Rechenguthaben.
- Rechenleistung je Projekt: Micro ist durch das Guthaben abgedeckt; Small 15 USD, Medium 60 USD (jeweils abzüglich 10 USD Guthaben).
- Zweites Projekt (z. B. Staging): ca. 10 USD je Monat zusätzlich (Micro).
- Team-Plan 599 USD: nicht nötig.

**Hosting der Web-App (Entscheidung offen, siehe SPEC 7.9)**
- Variante A, **Vercel Pro**: 20 USD je Nutzer mit Zugang und monatlich 20 USD Nutzungsguthaben, darüber nutzungsabhängig. Das Gratisangebot (Hobby) ist für kommerzielle Nutzung nicht erlaubt. Ausgabenlimit (Spend Management) aktivieren.
- Variante B, **eigener Server bei Hetzner (Deutschland)**: ca. 5 bis 10 EUR je Monat für einen kleinen Server, Sicherungen gegen Aufpreis. Preise sind 2026 gestiegen, Verfügbarkeit einzelner Tarife schwankt. Dazu kommt Pflegeaufwand (Updates, Sicherheit, Sicherungen).
- Variante C, **Next.js-fähiger EU-Hoster** (z. B. Hostinger): Preis je Paket prüfen; Funktionsumfang (Proxy, Cache-Aktualisierung, Umgebungsvariablen) vorher testen.

## 4. Variable Posten (Formeln)
- Dateispeicher (GB) = Anzeigen × Fotos je Anzeige × Speicher je Foto ÷ 1.024
  Überschreitung über 100 GB: 0,021 USD je GB und Monat
- Datenverkehr aus Supabase (GB) = Seitenaufrufe × Daten je Aufruf × (1 − Cache-Anteil) ÷ 1.024
  Überschreitung über 250 GB: 0,09 USD je GB
- MAU: 100.000 enthalten, darüber 0,00325 USD je MAU
- Edge Functions: 2 Mio. Aufrufe enthalten, darüber 2 USD je Mio.
- Realtime-Nachrichten (Chat): 5 Mio. enthalten, darüber 2,50 USD je Mio.

## 5. Ergebnis je Größe (Supabase, Annahmen aus Abschnitt 2)

| Posten | S | M | L (mit Cache 90 %) | L (ohne Cache) |
|---|---|---|---|---|
| Pro-Plan | 25 | 25 | 25 | 25 |
| Zusatz Rechenleistung | 0 (Micro) | 5 (Small) | 50 (Medium) | 50 (Medium) |
| Dateispeicher (1,5 / 15 / 146 GB) | 0 | 0 | ca. 1 | ca. 1 |
| Datenverkehr (2 / 29 / 293 GB mit Cache; 20 / 293 / 2.930 GB ohne) | 0 | 0 | ca. 4 | ca. 241 |
| MAU, Functions, Realtime | 0 | 0 | 0 | 0 |
| **Summe Supabase (USD/Monat)** | **ca. 25** | **ca. 30** | **ca. 80** | **ca. 320** |

Hinweis: Bei M ohne Cache lägen die Datenverkehrskosten bei ca. 4 USD (zusätzlich zu den 30), bei S ohne Cache bei 0.

## 6. Gesamtbild pro Monat (Supabase plus Hosting, ohne Steuern)

| Größe | Supabase | Hosting Vercel Pro | Hosting Hetzner (ca.) | Summe mit Vercel | Summe mit Hetzner |
|---|---|---|---|---|---|
| S | ca. 25 USD | 20 USD | ca. 5–10 EUR | ca. 45 USD | ca. 30–35 (USD und EUR gemischt) |
| M | ca. 30 USD | 20 USD (Nutzung prüfen) | ca. 5–15 EUR | ca. 50 USD | ca. 35–45 |
| L | ca. 80 USD (mit Cache) | offen (Nutzung nicht belastbar geschätzt) | größerer Server nötig, offen | offen | offen |

Die Gesamtzeile für L ist bewusst offen. Die Hosting-Nutzungskosten bei Millionen Seitenaufrufen hängen stark von Caching und Bildoptimierung ab und sollten erst mit echten Messwerten geschätzt werden.

## 7. Einmalige und jährliche Posten
- Apple Developer Program: 99 USD je Jahr (erst für TestFlight und App Store)
- Domains und E-Mail-Postfächer (United Domains): ___ EUR je Jahr (eintragen)
- E-Mail-Versand (Anmeldecodes, Benachrichtigungen): ___ EUR je Monat (Anbieter und Menge klären, viele haben Gratisstufen)
- Markenrecherche zu "Reviro": ___ EUR (Angebot einholen)
- Anwalt (AGB, Datenschutz, Jagdrecht, DSA): ___ EUR (Festpreis anfragen)
- Muttersprachler-Prüfung Tschechisch und Polnisch: ___ EUR
- Logo und Gestaltung (falls extern): ___ EUR
- Claude-Abo (Claude Code): laufend nach Tarif

## 8. Kostentreiber und Gegenmaßnahmen
1. **Datenverkehr durch Fotos** ist der Posten, der am schnellsten wächst. Maßnahmen: Bildoptimierung und Zwischenspeicher (`next/image`), kleine Vorschaubilder in Listen, Originale nur in der Detailansicht, keine ungenutzten Bildgrößen ausliefern.
2. **Rechenleistung der Datenbank**: erst erhöhen, wenn Messwerte es zeigen (Abfragezeiten, Auslastung), nicht vorsorglich.
3. **Bot- und Angriffsverkehr** wird bei Vercel mitberechnet: Ausgabenlimit setzen, Bot-Schutz prüfen, Rate-Limits der App behalten.
4. **Chat und Echtzeit**: Verbindungen und Nachrichten zählen; nur dort Echtzeit nutzen, wo es nötig ist.
5. **Zweite Umgebung (Staging)** kostet dauerhaft zusätzlich; nur bei Bedarf und ggf. nur während Tests betreiben.
6. **Ausgabenlimit bei Supabase** prüfen und aktiv lassen, damit eine Lastspitze nicht unbemerkt teuer wird.

## 9. Entscheidungen und Aktualisierung
- Offen: Hosting (SPEC 7.9), Kartendatei-Speicherort (ADR zur Karte), Staging-Umgebung ja/nein und ab wann
- Aktualisieren bei: Abschluss M3 (echte Fotogrößen), Lasttest-Ergebnis, vor Veröffentlichung (Preisseiten prüfen), nach den ersten 30 Tagen Betrieb (echte Nutzung statt Annahmen)
- Preisseiten zum Prüfen: supabase.com/pricing, vercel.com/pricing, hetzner.com/de/cloud, Preisseite des gewählten E-Mail-Dienstes
- Quellen dieser Rechnung (Recherche am 2026-11-15): Supabase-Preisübersichten (makerkit.dev, toolradar.com, jetadmin.io, costbench.com), Vercel-Preisübersichten (stork.ai, docs der Plattform), Hetzner-Preisanpassung (docs.hetzner.com, learnwithhasan.com). Die offiziellen Seiten haben Vorrang.
