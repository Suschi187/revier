# ADR 013: Regeln für Anzeigen (Pflichtfelder, Gates, Freigabe)

Status: angenommen (M3, Commit 6, Migration `listing_rules`)

## Kontext
Plan M3 Abschnitte 2, 5 und 6: Pflichtfelder je Art (vom Nutzer freigegeben), Legal-Gate, Rate-Limit, Fortsetzen nur ohne Änderung seit der Freigabe. Architekt-Auflagen 1 und 8 (A1, C1–C3, F1), Review PLZ 3–4, QA M3 F1. Web und iOS nutzen dasselbe Backend und brauchen denselben Vertrag. Die Regeln stehen deshalb in der Datenbank an einer Stelle; Zod im Web prüft dasselbe vorab, mit gemeinsamen Fixtures (Commit 9).

## Entscheidung
- **Attribute je Art** (SPEC 3.2): nur bekannte Schlüssel mit gültigen Werten, geprüft bei jedem Schreiben, auch an Entwürfen (`private.listing_attributes_error`). `trophy_details` ist ein Attribut von `trophy_hunt`, `legal_ack` das Rechtshinweis-Häkchen.
- **Text und Länge:** Leerraum am Rand zählt nie als Inhalt. Die DB kürzt mit `private.trim_all` genau die Zeichen, die `String.prototype.trim` (JavaScript) entfernt: TAB, LF, VT, FF, CR, Leerzeichen, U+00A0, U+1680, U+2000–U+200A, U+2028, U+2029, U+202F, U+205F, U+3000, U+FEFF; nicht nur U+0020 wie `btrim`. iOS braucht dafür ein eigenes `CharacterSet`, denn `.whitespacesAndNewlines` enthält zusätzlich U+0085 und nicht U+FEFF. Längen zählen Codepoints (`char_length`; im Web `[...s].length`, in Swift `unicodeScalars.count`), nicht UTF-16-Einheiten oder Grapheme (QA M3 F2).
- **Preis:** Betrag > 0 (sonst „auf Anfrage“), höchstens EUR/CHF 10⁹, CZK 2,5·10¹⁰, PLN 5·10⁹ Minor-Einheiten (Check `price_bounds`).
- **Bereitschaft** (`private.listing_readiness`, Tabelle Plan M3 6):
  - Mindestfelder für alle: Beschreibung 30–5000 Zeichen; Titel, Kreis und Sprache erzwingt das Schema.
  - Angebote: PLZ und Ortsname; die PLZ muss existieren und zum Kreis passen (auch bei Gesuchen, wenn angegeben). Dazu je Art: Pacht (Pachtart, Reviertyp, Fläche, Wildart), Begehungsschein (Umfang, entgeltlich, Wildart), Gesellschaftsjagd (Datum, freie Plätze), Trophäenjagd (Wildart), Jagdhelfer (Aufgaben).
  - Trophäenjagd, Angebot und Gesuch: `legal_ack = true`. Ein Termin (`event_date`) liegt nie in der Vergangenheit.
  - **Wann:** als `constraint trigger … deferrable initially deferred`, also am Ende der Transaktion auf dem Endzustand. Geprüft wird jede Änderung, nach der die Anzeige in der Prüfung liegt, sowie die Freigabe durch einen Admin. Server-Pfade (`service_role`, Jobs, Edge Functions) sind ausgenommen.
  - **Fotos:** „alle Fotos verarbeitet“ gilt beim Absenden (aus Entwurf, abgelehnt, abgelaufen) und bei der Freigabe (A1), nicht für Änderungen in der Prüfung. Ein neues Foto ist sonst zwischen Anlegen der Zeile und Verarbeitung (Sekunden) unverarbeitet, und an eingereichten oder aktiven Anzeigen ließen sich keine Fotos hinzufügen.
- **Legal-Gate `RV001`:** beim Anlegen, bei Inhaltsänderungen (auch an Fotos, Wildarten, Ort), beim Absenden und beim Fortsetzen; nicht beim Pausieren, Zurückziehen und Löschen. Zusätzlich verlangt die Insert-Policy die Zustimmung.
- **Rate-Limit `RV002`:** 3 neue Anzeigen in 24 h für Konten jünger als 7 Tage, sonst 10 (`app_settings`). Gezählt wird in `private.listing_creations`, gelöschte Anzeigen zählen mit; eine Sperre je Besitzer verhindert, dass parallele Inserts das Limit umgehen. Lokal hebt `supabase/seed.sql` das Limit für API- und E2E-Tests an; pgTAP prüft die echten Grenzen mit gesetzten Werten. **Achtung Supabase Branching:** Preview-Branches führen `seed.sql` ebenfalls aus, dort gälte dann das Limit 1000. Vor dem Einschalten von Branching den Seed für Branches abschalten (`[db.seed] enabled = false` bzw. eigene `sql_paths`) oder das Limit dort zurücksetzen; Punkt der Cloud-Checkliste (QA M3 F10).
- **Freigabe-Hash:** Bei jeder Freigabe (`pending_review → active`) speichert ein Trigger den SHA-256 über den Inhalt in `private.listing_approvals`.
  - Inhalt: alle Spalten der Anzeige außer Verwaltungsspalten (neue Spalten zählen automatisch mit), Wildarten, Fotos mit Reihenfolge, Alt-Text und Verarbeitung, PLZ und Ort.
  - `paused → active` gelingt nur, wenn der Hash gleich ist; sonst wird die Anzeige `pending_review`. Fehlt der Hash, ebenso (fail closed).
  - Der Hash ist für keine API-Rolle lesbar, weil er die PLZ enthält und bei rund 8 200 PLZ durchprobierbar wäre. `private.listing_resume_allowed` liefert dem Besitzer nur ja/nein.
- **Vier-Augen-Prinzip:** Ein Admin an der eigenen Anzeige ist Besitzer. Inhaltsänderungen führen zurück in die Prüfung, die Limits gelten, und freigeben kann er die eigene Anzeige nicht (QA M3 F1).
- **Hinweis auf Waffen und Munition** (Entscheidung 6, Commit 7): `rpc('listing_content_hints', { p_listing_id })` liefert Fundstellen `(field, term, language, category)` aus Titel, Beschreibung, Text-Attributen und Alt-Texten, abgeglichen mit der Begriffsliste aller 4 Sprachen in `private.content_terms` (keine API-Rechte).
  - Web und iOS zeigen beim Absenden einen deutlichen Hinweis mit den Fundstellen und dem Verweis auf die Richtlinien; Absenden bleibt möglich.
  - Fremde und unbekannte Anzeigen ergeben dieselbe leere Antwort; PLZ und Ort werden nicht ausgewertet.
  - Die Liste ist bewusst breit (Hinweis, keine Sperre). In M4 markiert derselbe Abgleich Anzeigen für die Moderation; Änderungen an der Liste kommen als Migration.
- **Status:** Nur der Guard setzt `status`; der Kinder-Guard und `complete_photo_processing` setzen höchstens `pending_review` (Meta-Test).

## Vertrag für Clients (Web, iOS I4)
| Code | Bedeutung | `hint` |
|---|---|---|
| `RV001` | Zustimmung zur aktuellen Version der Rechtstexte fehlt | Text; Client fragt `legal_status()` ab und zeigt die Zustimmung |
| `RV002` | Rate-Limit Anzeigen (bzw. Fotos) erreicht | Anzeigen: `{"retry_after": "<ISO-Zeitpunkt UTC>"}` |
| `23514` + Meldung `listing_not_ready` | Absenden bzw. Freigabe nicht möglich | `{"fields": ["description.length", "place.postal_code.required", …]}` |
| `23514` + Meldung „Ungültige Angaben zur Art“ | Attribut falsch oder unbekannt | `{"fields": ["attributes.<schlüssel>" bzw. "attributes.unknown"]}` |
| `23514` (Check `price_bounds`, `price_consistent`) | Preis außerhalb der Grenzen | – |
| `42501` | Statuswechsel nicht erlaubt, fremde Anzeige | – |

Feldcodes der Bereitschaft: `description.length`, `place.postal_code.required`, `place.place_name.required`, `place.postal_code.unknown`, `place.postal_code.region_mismatch`, `attributes.legal_ack`, `attributes.event_date.past`, `attributes.lease_type`, `attributes.revier_type`, `area_hectares`, `attributes.permit_scope`, `attributes.paid`, `attributes.event_date`, `attributes.spots_available`, `attributes.tasks`, `species`, `photos.unprocessed`. Die Hints nennen nie Werte (keine PLZ in Logs).

Clients übersetzen die Feldcodes in die 4 Sprachen. Weil die Prüfung am Ende der Transaktion läuft, kommt der Fehler bei PostgREST als Antwort auf den Request, der die Anzeige in die Prüfung bringt. Mehrere Änderungen an einer eingereichten oder aktiven Anzeige schickt der Client deshalb so, dass jeder Zwischenstand bereit bleibt (z. B. neue Wildart vor dem Entfernen der alten), oder er setzt Kreis und Ort gemeinsam per `set_listing_location`.

## Alternativen
- **Prüfung je Statement statt deferred:** Kreis und PLZ in zwei Tabellen blockierten sich gegenseitig (Review PLZ 3).
- **Pflichtfelder nur im Client:** über die API umgehbar.
- **Hash in `listings`:** lesbar für `authenticated` und damit ein PLZ-Orakel.

## Folgen
- Die Feldliste ist rechtlich offen (SPEC 7.2). Änderungen kommen als neue Migration und gleichzeitig in die gemeinsamen Fixtures.
- Tests: pgTAP `18_content_hints` (Fundstellen, Sprachen, Komposita, keine Treffer in harmlosen Texten, Rechte), `17_listing_rules` (Attribute, Preise, Bereitschaft je Feld, Freigabe mit Fotos, Hash, Statusmatrix auch als Admin-Besitzer, Legal-Gate, Rate-Limit, Meta-Tests), `14_qa_m3` (F1), `15_listing_places`; API-Tests folgen mit `listings.test.ts` (Commit 8).
