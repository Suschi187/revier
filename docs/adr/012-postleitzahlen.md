# ADR 012: Postleitzahlen und Ort der Anzeige

Status: angenommen (M3)

## Kontext
Entscheidung des Nutzers (Plan M3 6.1):
- Angebote brauchen PLZ und Ortsnamen. Bei Gesuchen reicht der Kreis, die PLZ ist optional.
- Der Ort beim Gesuch ist das gesuchte Gebiet, nicht der Wohnort.
- Die PLZ muss im Verzeichnis existieren und zum gewählten Kreis passen.
- Öffentlich dürfen nur die ersten beiden Ziffern erscheinen.

Eine volle PLZ grenzt ein Revier oft enger ein als der verfremdete Punkt (ADR 006) und gilt deshalb als Standortdatum (CLAUDE.md Standorte). Für Deutschland gibt es kein offenes amtliches PLZ-Verzeichnis mit Flächen.

## Entscheidung
- **Referenzdaten** in drei Tabellen:
  - `postal_codes`, `postal_code_regions` (PLZ → Kreis, mehrere möglich), `postal_code_places` (Ortsnamen als Vorschläge)
  - öffentlich lesbar, schreibbar nur per Migration
  - erzeugt von `supabase/data/postal_codes/generate.py`; Quellen, Hashes und Regeln in `SOURCES.md`
- **Quellen:**
  - **DE:** PLZ-Gebiete aus OpenStreetMap (`boundary=postal_code`, ODbL), verschnitten mit den Kreisgrenzen aus BKG VG250 (dieselbe Quelle wie `regions.code`).
    - Eine PLZ gehört zu einem Kreis ab 1 % ihrer Fläche oder 0,5 km², immer zum Kreis mit dem größten Anteil.
    - Ohne Schwelle hinge fast jede Rand-PLZ wegen Ungenauigkeiten auch am Nachbarkreis.
  - **AT:** Statistik Austria, Gemeindeliste mit „PLZ des Gemeindeamts“ und „weitere Postleitzahlen“ (CC BY 4.0), Bezirk aus der Gemeindekennziffer.
  - **Ortsnamen:** in DE die Gemeinden aus VG250, die einen nennenswerten Teil der PLZ-Fläche bedecken, dazu bereinigte Ortsteile aus OSM; in AT der Gemeindename. Der Generator bricht bei verdächtigen Namen ab (QA M3 F2).
  - Korrekturen über `overrides.csv` mit Begründung. Die Fehlermeldung „PLZ passt nicht zum Kreis“ nennt einen Meldeweg, damit eine echte Kombination nicht dauerhaft blockiert ist.
- **Abweichung von ADR 007** (dort wurde OSM wegen Share-Alike verworfen):
  - Für Kreise gibt es amtliche offene Daten (VG250), für PLZ-Flächen in DE nicht. Die Alternative wäre die kostenpflichtige Lizenz der Deutsche Post Datafactory oder eine reine Formatprüfung.
  - Der Nutzer hat OSM gewählt.
- **Weitere Pflichtvermerke** (Seite „Datenquellen“, M5/M9): „© GeoBasis-DE / BKG (2026)“ (dl-de/by-2-0) für die Zuordnung zu Kreisen und die Gemeindenamen; „Datenquelle: Statistik Austria“ (CC BY 4.0) mit dem Hinweis, dass der Bezirk aus der Gemeindekennziffer abgeleitet ist.
- **ODbL-Pflichten:**
  - Namensnennung „© OpenStreetMap-Mitwirkende“ direkt am PLZ-Feld (Web und iOS) und auf der Seite „Datenquellen“ (M5/M9).
  - Die abgeleitete PLZ-Tabelle wird unter ODbL zum Download angeboten (Seite „Datenquellen“).
  - Die Produktdatenbank gilt als Sammlung (Collective Database): `listing_places` speichert nur die Eingabe des Nutzers, die Anzeigen fallen nicht unter Share-Alike.
  - Anwaltlich zu prüfen (SPEC 7.2).
- **Ort der Anzeige** (Plan M3 Commit 5b, Migration `listing_places`):
  - eigene Tabelle `listing_places (listing_id, postal_code, place_name, updated_at)`, 1:1 zur Anzeige, nur Besitzer und Admin (aal2, `is_admin`) lesbar, nie öffentlich
  - Schreiben nur der Besitzer einer bearbeitbaren Anzeige eines aktiven Kontos; Admins schreiben nicht, ein Admin an der eigenen Anzeige gilt als Besitzer. Kein DELETE, die Zeile verschwindet mit der Anzeige.
  - PLZ und Ort sind nullable, weil Gesuche ohne PLZ auskommen; Pflicht bei Angeboten prüft die Bereitschaftsprüfung (Commit 6).
  - Das Land wird nicht gespeichert, es folgt dem Kreis. Das Format prüft ein Trigger nach dem Land der Anzeige (DE 5 Ziffern, AT/CH 4 Ziffern ohne führende 0, CZ `123 45`, PL `12-345`), Fehler `23514` mit `hint` `place.postal_code.format`, ohne den Wert.
  - kein FK auf `postal_codes`, damit Anzeigen ein Update der Referenzdaten überstehen; der Ortsname ist Freitext mit Vorschlägen
- **Vertrag für Clients (Web, iOS I4):** `rpc('set_listing_location', { p_listing_id, p_region_id, p_postal_code, p_place_name })`
  - setzt Kreis und Ort in einer Transaktion (security invoker, RLS und Guards greifen)
  - `RV001` ohne aktuelle Zustimmung, `42501` für fremde und unbekannte Anzeigen (gleiche Antwort), `23514` bei falschem Format
  - Unverändert zurückgeschrieben bleibt eine freigegebene Anzeige aktiv; jede Änderung an PLZ, Ort oder Kreis führt nach `pending_review`.
- **Öffentliches Präfix:** Der Server leitet `listings.postal_prefix` (2 Zeichen) aus `listing_places` ab.
  - In DE gibt es rund 95 zweistellige Leitregionen bei 401 Kreisen, in AT rund 80 Bereiche bei 94 Bezirken.
  - Das Präfix ist damit meist gröber als der Kreis.
- **Kein Such-Orakel:** Keine Suche, kein Filter, kein Suchauftrag und keine Sortierung nutzen die volle PLZ oder den Ortsnamen aus `listing_places`, weil Durchprobieren aller rund 8 200 PLZ die PLZ jeder Anzeige verraten würde. Das öffentliche Präfix darf gefiltert werden. Ein Meta-Test hält fest, welche Funktionen und Views `listing_places` verwenden dürfen.
- **Nie in öffentlichen Ausgaben:** PLZ und Ort erscheinen nicht in `search_vector`, Meta-Tags, JSON-LD, Sitemap und URL. In M5 kommt dafür ein HTML-Test. In M4 erscheinen sie nur in der Moderations-Detailansicht, nicht in Listen, Exporten oder `audit_log`.
- **Prüfung:**
  - PLZ und Kreis werden in einem Schritt gesetzt (RPC `set_listing_location`, security invoker).
  - Die Prüfung „PLZ existiert und passt zum Kreis“ läuft in der Bereitschaftsprüfung beim Absenden und bei der Admin-Freigabe.
  - Eine Änderung an PLZ oder Ort führt eine freigegebene Anzeige zurück nach `pending_review`.
- **Abruf im Client:** Nach der Kreiswahl lädt der Client alle PLZ dieses Kreises auf einmal, nicht eine einzelne PLZ per GET. Sonst stünde die eingegebene PLZ mit dem Nutzer im API-Log.
- **iOS (I4):** Dieser ADR ist der Vertrag, inklusive Namensnennung in der App.

## Alternativen
- **Deutsche Post Datafactory:** amtlich genau, aber kostenpflichtig und mit Lizenzvertrag.
- **Nur Formatprüfung:** Falsche PLZ blieben unbemerkt.
- **PLZ als Spalte in `listings`:** `anon` hat SELECT auf `listings`, die PLZ wäre öffentlich.

## Folgen
- Weitere Märkte (CH, CZ, PL) brauchen ihre PLZ-Daten zusammen mit den Kreisen, sonst lassen sich dort keine Angebote absenden.
- PLZ-Änderungen kommen als neue Daten-Migration.
- Tests: pgTAP `13_postal_codes` (Umfang, jeder Kreis abgedeckt, Ortsnamen, Stichproben, Rechte), `15_listing_places` (RLS, Präfix, Format, Statuswechsel, Legal-Gate, Allowlist der Funktionen), `09_grants` (Snapshot); API-Tests `web/integration/places.test.ts` (Embedding, Filter, Zählung, RPC-Antworten).
