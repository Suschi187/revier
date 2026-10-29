# Plan M3: Anzeigen erstellen (Web)

Stand: 2026-10-29, Entwurf zur Prüfung durch den Architekten. Noch nichts umgesetzt.
Antworten des Nutzers zu den offenen Fragen sind eingearbeitet (Abschnitt 11), ebenso die Auflagen 1–13 aus dem Review des Architekten (`docs/reviews/M3-plan-architekt.md`, Abschnitt 12 hier). Wo Abschnitt 12 einem älteren Absatz widerspricht, gilt Abschnitt 12.

## 0. Auftrag und Akzeptanz (SPEC 6)
- Assistent für alle 5 Arten (`lease`, `permit`, `driven_hunt`, `trophy_hunt`, `helper`), jeweils Angebot oder Gesuch
- Foto-Upload mit Verkleinerung, höchstens 8 Fotos
- Preisfeld mit Währung, Entwurf speichern, Absenden → `pending_review`
- *Akzeptanz:* Die Anzeige erscheint in „Meine Anzeigen“ mit Status. Pflichtfelder je Art werden validiert.

Pflichtpunkte aus dem Review M2 (Architekt), beide **hoch**:
- **A:** EXIF/GPS werden serverseitig entfernt, für Web und iOS gleich.
- **B:** Die Standortverfremdung ist stabil und lässt sich nicht herausmitteln, auch über mehrere Anzeigen desselben Reviers (M1-Punkt 10, ADR 006 „offen bis M3“).

Zusätzlich verlangt: zeigen, dass ein Nutzer den Status nie selbst auf `active` setzen kann, und wie die Tests das belegen (Abschnitt 5).

## 1. Umfang
**Drin:**
- DB: Validierung je Art beim Absenden, Fotoverarbeitung, Standortverfremdung neu, Legal-Gate, Rate-Limit, Preisgrenzen
- Erste Edge Function `process-listing-photo`
- Web:
  - „Meine Anzeigen“ (`/{locale}/account/listings`)
  - Assistent (`/new`, `/[id]/edit`)
  - Vorschau, Absenden
  - Entwurf löschen
  - Absenden zurückziehen (`pending_review → draft`)

**Nicht drin** (spätere Schritte):
- öffentliche Detailseite (M5), Suche/Karte (M5/M6)
- Pausieren/Verlängern im Dashboard (M6)
- Freigabe durch Admins (M4)
- Ablauf-Job `expired` (M9)
- iOS (I4, Lücke im CHANGELOG, ADR 011 ist der Vertrag)
- Kartenauswahl des Punkts (entschieden: in M3 nur Landkreis, `display_location` bleibt im Web leer; die DB-Verfremdung wird trotzdem gebaut und getestet)

## 2. Datenmodell und Migrationen (Entwurf, je eine Migration pro Thema)
1. `listing_photo_processing`:
   - Bucket `listing-uploads`:
     - privat, max 15 MB
     - Der Nutzer wählt JPEG/PNG/WebP (entschieden); der Client wandelt vor dem Upload nach JPEG (Auflage 4). Der Bucket nimmt nur `image/jpeg` und `image/png` an. HEIC lehnt der Client vorab mit klarer Meldung ab („HEIC wird nicht unterstützt, bitte als JPEG exportieren“), Bucket und Function lehnen es zusätzlich ab (Magic Bytes, nicht nur MIME-Typ). iOS konvertiert HEIC vor dem Upload nativ nach JPEG.
   - `listing_photos` bekommt:
     - `upload_path` (Eingang, nullable)
     - `processed_at`, `width`, `height`
     - `thumb_path`
   - `storage_path` bleibt der Pfad der **verarbeiteten** Datei `{owner}/{listing}/{photo_id}.jpg`.
2. `listing_photos_storage_policies`:
   - In den Bucket `listing-photos` schreibt nur noch `service_role`; Insert/Update für `authenticated` entfällt.
   - Lesen geht nur für `processed_at is not null` und eine sichtbare Anzeige; der Besitzer sieht die eigenen verarbeiteten Fotos.
   - In den Eingang dürfen nur Besitzer, und nur für registrierte, unverarbeitete Fotos.
3. `listing_location_v2`: deterministische Verfremdung, siehe Abschnitt 4. Ersetzt `private.listing_location_offsets` (noch keine Daten); das Secret liegt im Vault.
4. `listing_review_rules`:
   - `private.listing_ready_for_review(listings)`: Pflichtfelder je Art, siehe Abschnitt 6
   - Fotos: alle verarbeitet
   - Aufruf im `listings_guard` beim Übergang `→ pending_review`
5. `listing_gates`:
   - `private.require_current_legal()` (`RV001`) im Guard und im `listing_children_guard`, zusätzlich als Policy-Bedingung `(select private.has_accepted_current_legal())` bei Insert
   - Rate-Limit beim Insert (eigener Fehlercode `RV002`), zählt Inserts der letzten 24 h je Besitzer:
     - Konten jünger als `listing_new_account_days` (7 Tage, Alter aus `auth.users.created_at`): höchstens `listing_create_daily_limit_new` = 3
     - danach höchstens `listing_create_daily_limit` = 10
     - gelöschte Entwürfe zählen mit (Zählung über die Tabelle `private.listing_creations` mit Besitzer und Zeitpunkt, damit Löschen und Neuanlegen das Limit nicht umgeht)
   - Preisobergrenze `price_minor <= 100_000_000_00`
6. `listing_attributes_check`:
   - DB-Check der erlaubten Schlüssel und Typen in `attributes` je Art; Entwürfe dürfen unvollständig sein
   - nur bekannte Schlüssel, keine Koordinaten wie bisher
7. `listing_photos.alt_text` (optional, max 200 Zeichen, in der Sprache der Anzeige). Fallback in Web und iOS: der Titel der Anzeige, bei mehreren Fotos „{Titel}, Foto n von m“.
8. `listing_content_hints`: Begriffsliste für Waffen und Munition je Sprache in `private.content_terms` (de/en/cs/pl) und RPC `public.listing_content_hints(p_listing_id)` (nur Besitzer), die die gefundenen Begriffe liefert. Web zeigt beim Absenden einen deutlichen Hinweis, blockiert aber nicht. iOS nutzt dieselbe RPC; M4 baut darauf den Abgleich, der Anzeigen für die Moderation markiert.
9. Typen neu generieren (`database.types.ts`).

## 3. Pflichtpunkt A: EXIF/GPS serverseitig entfernen

### 3.1 Ablauf (Web und iOS gleich)
1. Der Client legt die Zeile in `listing_photos` an (`processed_at = null`). Wie bisher prüft die DB Besitz, Pfad und das Limit von 8.
2. Der Client verkleinert das Bild **verbindlich** (Vertrag für Web und iOS, Auflage 4): lange Seite ≤ 2560 px, JPEG, sRGB, Orientierung in die Pixel gedreht. Das Web wandelt so auch PNG und WebP per Canvas nach JPEG; der Nutzer wählt weiter JPEG/PNG/WebP bis 15 MB. Das ist **keine** Sicherheitsmaßnahme, der Server prüft und kodiert trotzdem neu.
   - Er lädt die Datei nach `listing-uploads/{owner}/{listing}/{photo_id}` hoch.
3. Der Client ruft die Edge Function `process-listing-photo` mit `{ photo_id }` und seinem JWT auf. Die Function:
   1. Sie prüft den Nutzer (`getUser`) und lädt die Zeile mit einem Client im Namen des Nutzers. Damit belegt die RLS Besitz und Bearbeitbarkeit, kein Orakel für fremde IDs.
   2. Sie lädt den Eingang mit `service_role` und prüft Magic Bytes, Größe und die Abmessungen aus dem Header **vor** dem Dekodieren: höchstens 12 MP und je Seite höchstens 4096 px (Dekompressionsbombe; Header über alle SOF-Marker bzw. IHDR, Grenzen für Frames und Scans). Eingang am Server nur JPEG (+PNG); WebP, HEIC, SVG/HTML → `unsupported`.
   3. Sie dekodiert das Bild und dreht die Pixel gemäß EXIF-Orientation. Dann **kodiert sie neu**: JPEG q≈82, lange Seite 2048 px, dazu ein Thumbnail mit 480 px. Neukodieren verwirft alle Metadaten: EXIF, GPS, XMP, IPTC, ICC, PNG-`tEXt`/`eXIf`, WebP-`EXIF`/`XMP`-Chunks und angehängte Daten (Polyglotte). Byte-genaues Herausschneiden einzelner Segmente ist bewusst verworfen, weil es zu fehleranfällig ist.
   4. Sie schreibt nach `listing-photos/{owner}/{listing}/{photo_id}.jpg` und `…_thumb.jpg`, setzt `processed_at`, `width` und `height` und löscht den Eingang.
   5. Sie ist idempotent (erneuter Aufruf: „schon verarbeitet“). Fehler kommen als Code zurück (`too_large`, `unsupported`, `corrupt`, `not_found`), der Client übersetzt sie.
4. Solange eine Anzeige unverarbeitete Fotos hat, kann sie nicht nach `pending_review` (Guard). Unverarbeitete Fotos sind für niemanden außer dem Besitzer sichtbar, und auch für ihn nur im Eingang.
5. **Neu (Auflage 1):** Nach erfolgreicher Verarbeitung setzt die Function eine Anzeige mit Status `active`/`paused` ausdrücklich auf `pending_review`. Das ist ihr einziger Schreibzugriff auf `listings`. Außerdem prüft der Admin-Übergang `pending_review → active` im Guard dieselbe Bereitschaft (`listing_ready_for_review`, inklusive „keine unverarbeiteten Fotos“); ein Admin kann also nicht freigeben, solange ein Foto aussteht.
6. Verwaiste Eingangsdateien (Upload ohne Verarbeitung) räumt der Lösch-Job in M9 nach 24 h ab (ADR 008 ergänzen).

### 3.2 Warum serverseitig und warum zwei Buckets
- Clientseitiges Entfernen ist umgehbar, weil die API mit dem öffentlichen Key direkt erreichbar ist.
- Ins öffentliche Bucket kommen nur Bytes, die der Server selbst erzeugt hat. Ein unbearbeitetes Original ist zu keinem Zeitpunkt für Dritte lesbar.

### 3.3 Tests (Pflichtpunkt A belegt)
- **Integration** (`web/integration/photos.test.ts`, gegen die lokale Edge Runtime):
  - Fixtures erzeugt der Test selbst, ohne fremde Bilder und ohne neue Abhängigkeit:
    - JPEG mit Exif-APP1 inklusive GPS-IFD (Breite/Länge), XMP-APP1 und Kommentar
    - PNG mit `eXIf`- und `tEXt`-Chunk
    - WebP mit `EXIF`-Chunk
    - JPEG mit Orientation 6
    - JPEG mit angehängtem ZIP (Polyglott)
    - Header mit 50 000 × 50 000 px
  - Danach prüft der Test auf dem Ergebnis:
    - keine APP1/Exif-, XMP- oder `GPS`-Bytes, kein angehängter Rest, keine PNG/WebP-Metadatenchunks
    - lange Seite höchstens 2048 px, Orientation in Pixel umgesetzt (Breite und Höhe vertauscht)
    - Eingang gelöscht
  - Negativfälle:
    - anon/Fremde lesen weder den Eingang noch unverarbeitete Fotos
    - der Besitzer schreibt nicht direkt in `listing-photos`
    - ein Fremder verarbeitet keine fremde `photo_id` (gleiche Antwort wie bei einer unbekannten ID)
    - die Bombe wird abgelehnt
    - Absenden mit unverarbeitetem Foto → `23514`
- **pgTAP:** Policies beider Buckets, Spalten-GRANTs (`processed_at` usw. nur `service_role`), Guard „unverarbeitete Fotos blockieren das Absenden“.
- **E2E:** Upload im Assistenten zeigt das verarbeitete Thumbnail. Ein Foto mit GPS-Fixture wird hochgeladen, die öffentlich ausgelieferte Datei enthält kein GPS.
- **CI:** Im Job `e2e` muss `edge-runtime` laufen; heute ist es ausgeschlossen.

### 3.4 Bibliothek (Entscheidung, mit Spike als erstem Commit)
| | `@imagemagick/magick-wasm` | `imagescript` |
|---|---|---|
| Lizenz | Apache-2.0 | MIT |
| Formate | JPEG, PNG, WebP, **HEIC** | JPEG, PNG (WebP/HEIC nicht dekodierbar) |
| Orientation/Strip | `autoOrient()`, `strip()` | Orientation manuell |
| Kosten | große WASM-Datei, langsamer Kaltstart | klein, schnell |

Entschieden: HEIC wird nicht angenommen. Damit fällt der Hauptvorteil von `magick-wasm` weg. WebP muss aber dekodierbar sein. Der Spike prüft deshalb zuerst eine leichte Bibliothek mit JPEG/PNG/WebP-Dekodierung, sonst `magick-wasm` gegen die Limits der Edge Functions (Speicher, CPU-Zeit, Kaltstart) mit einem 15-MB-Bild. Neue Abhängigkeit nur in der Edge Function, mit fester Version gepinnt.

## 4. Pflichtpunkt B: Standortverfremdung stabil und nicht herausmittelbar

### 4.1 Verfahren (Trigger `listings_zz_blur_location`, `security definer`)
Eingabe ist der Punkt `p` aus dem Client (WGS84); er wird nie gespeichert.
1. **Einrasten:** `c` = Mittelpunkt der 1-km-Rasterzelle von `p` in EPSG:3035 (LAEA Europa, metrisch). Kleine Klickunterschiede ergeben denselben Punkt.
2. **Schlüssel:** `k = HMAC-SHA256(secret, owner_id || ':' || region_id)`, mit `extensions.hmac` aus pgcrypto.
   - Richtung = `k[0..3] / 2^32 · 360°`
   - Distanz = `3000 + k[4..7] / 2^32 · 2000 m`
3. **Ausgabe:** `display_location = ST_Project(c, Distanz, Richtung)`.
4. **Plausibilität:** `p` muss höchstens 60 km vom Centroid des gewählten Kreises entfernt liegen, sonst `23514`. Polygone gibt es nicht (ADR 006).

### 4.2 Eigenschaften
- **Stabil:** Derselbe Besitzer im selben Kreis bekommt immer denselben Versatz, für jede Anzeige und jedes Update. Neuauflagen und mehrere Arten desselben Reviers liefern denselben Punkt bzw. einen um denselben Vektor verschobenen. Das Mittel beliebig vieler Anzeigen ist `mittel(c_i) + Versatz` und bleibt 3–5 km neben der wahren Lage, es konvergiert nicht.
- **Kein Orakel:** `owner_id` steckt im Schlüssel. Wer eigene Entwürfe an vermuteten Orten anlegt, bekommt einen anderen Versatz und kann die Punkte fremder Anzeigen nicht nachbauen.
- **Restrisiken (im ADR festhalten):**
  - Die relative Lage mehrerer Anzeigen eines Besitzers im selben Kreis bleibt erkennbar (Form, nicht Ort).
  - Teilt ein Anbieter im Chat die genaue Lage einer Anzeige mit, kennt der Empfänger den Versatz und damit die Zelle seiner anderen Anzeigen im selben Kreis.
  - Verschiedene Besitzer desselben Reviers, etwa Pächter und Genossenschaft, haben unabhängige Versätze; das sind wenige Stichproben.
- **Alternative (für den Architekten):** Schlüssel `(owner_id, Zelle)` statt `(owner_id, region_id)`. Dann gibt es kein Chat-Leck auf andere Orte, aber Anzeigen eines großen Reviers in verschiedenen Zellen bekommen unabhängige Versätze, deren Mittel gegen den Revier-Mittelpunkt konvergiert. Empfehlung: `(owner_id, region_id)`.
- **Secret:**
  - Die Migration legt es per `vault.create_secret(encode(gen_random_bytes(32), 'hex'), 'listing_location_key')` an, wenn es fehlt. Es ist je Umgebung verschieden und nie im Repo.
  - Lesbar ist es nur für die `security definer`-Funktion.
  - **Nie rotieren:** Die Eingaben sind nicht gespeichert, eine Rotation würde jeden Punkt beim nächsten Update springen lassen und alte und neue Punkte vergleichbar machen.
  - Backups müssen den Vault enthalten (Cloud-Checkliste).
- Logging wie ADR 006: Statement-Parameter werden nicht protokolliert.

### 4.3 Tests (Pflichtpunkt B belegt)
- **pgTAP** (`12_location.test.sql`):
  1. Gleicher Besitzer und Kreis, zwei Anzeigen mit Punkten 300 m auseinander, nachweislich in derselben Zelle → identischer `display_location`.
  2. Gleicher Besitzer und Kreis, zehn Anzeigen über 6 km verteilt → der Vektor Ausgabe − Zellmitte ist für alle zehn identisch (in EPSG:3035 gerechnet); der Abstand der Mittelwerte liegt in [2,28; 5,72] km (Ring 3–5 km ± halbe Zellendiagonale 707 m, mit Rundungsreserve).
  3. Zehn Updates derselben Anzeige mit demselben Punkt → immer derselbe Wert. Änderung nur des Titels → Punkt unverändert.
  4. Zwei Besitzer, gleicher Punkt → verschiedene Ausgaben (kein Orakel).
  5. 200 zufällige Besitzer → alle Distanzen liegen im Ring; die Richtungen sind gestreut (kein konstanter Versatz, mindestens 6 von 8 Oktanten belegt).
  6. Der Eingabepunkt steht nirgends: Keine `geography`/`geometry`-Spalte in `public` oder `private` hat einen Wert innerhalb von 1 km um `p`, keine Offsets-Tabelle mehr.
  7. Punkt 80 km vom Kreis-Centroid entfernt → `23514`.
  8. `authenticated`/`anon` lesen das Secret nicht (`vault.decrypted_secrets`) und können die Funktion nicht aufrufen.
- **Integration** (PostgREST): Insert mit Punkt → der gelieferte Wert liegt 2,28–5,72 km entfernt; erneutes PATCH mit demselben Punkt ändert nichts; eine zweite Anzeige im selben Kreis bekommt denselben Versatzvektor.

## 5. Der Nutzer setzt den Status nie selbst auf `active`

### 5.1 Alle Wege zu `active` und ihre Sperre
| Weg | Sperre | Ergebnis |
|---|---|---|
| `INSERT … status = 'active'` (REST, supabase-js, Upsert) | `listings_guard`: Insert nur als `draft` oder `pending_review` | `42501` |
| `UPDATE status = 'active'` aus `draft`, `pending_review`, `rejected`, `expired`, `removed` | Übergangsliste des Guards: für Besitzer nicht enthalten | `42501` |
| Upsert (`INSERT … ON CONFLICT DO UPDATE`) auf andere Konflikt-Spalten | Insert- und Update-Zweig laufen durch denselben Guard | `42501` |
| Inhalt einer `active`/`paused`-Anzeige ändern | Guard setzt auf `pending_review` | Status wird `pending_review` |
| Foto oder Wildart an einer `active`/`paused`-Anzeige ändern | `listing_children_guard` setzt auf `pending_review` | dito |
| `paused → active` **mit** gleichzeitiger Inhaltsänderung | Inhaltsänderung gewinnt | `pending_review` |
| `expires_at` verlängern, `owner_id` ändern | nur Server | `42501` |
| Admin gibt die eigene Anzeige frei | Vier-Augen-Prinzip | `42501` |
| Trigger umgehen (`session_replication_role`, `ALTER TABLE … DISABLE TRIGGER`) | nur Tabelleneigentümer bzw. Superuser | Rechte fehlen |
| Edge Function (`service_role`, Guard übersprungen) | Die Foto-Function setzt `listings.status` nur auf `pending_review` (Auflage 1) | kein `active` |
| `security definer`-Funktionen, die `listings` ändern (`is_server()` = true) | Meta-Test: Allowlist der Funktionen, deren Quelltext `update public.listings` enthält; heute nur der Children-Guard, der nur `pending_review` setzt | kein `active` |
| Delete + Reinsert | `id` steht nicht im INSERT-GRANT, Insert nur `draft`/`pending_review`, Rate-Limit zählt mit | kein `active` |
| Upsert über `id` (`on_conflict=id`, `merge-duplicates`) | Spaltenrecht auf `id` fehlt | `42501` |
| Admin über Claims (`app_role`) | `is_admin()` braucht `user_roles` **und** `aal2` | Tests: Claim ohne Rolle → `42501`; Admin mit `aal1` → `42501` |
| `set role service_role` als `authenticated` | keine Mitgliedschaft | Fehler |
| Trigger-Reihenfolge | nur `listings_guard` setzt `new.status` | Meta-Test über Trigger-Namen und Quelltext |
| `approved_content_hash` selbst setzen | private Tabelle, nur der Guard schreibt | `42501` |
| pg_graphql | gleiche Rollen, RLS und Trigger; ist deaktiviert (Review M1) | kein Sonderweg |

**Einzige Ausnahme laut SPEC 3.4:** `paused → active` durch den Besitzer, also das Fortsetzen ohne erneute Prüfung.
- `paused` erreicht nur, wer vorher `active` war, und `active` setzt nur ein Admin.
- Der Übergang klappt nur ohne Inhaltsänderung und solange `expires_at > now()`.
- Eine nie freigegebene Anzeige kann also nie `active` werden.
- **Entschieden:** Fortsetzen ohne Prüfung nur, wenn sich seit der Freigabe nichts geändert hat. Jede Änderung an Titel, Text, Preis, Fotos oder Ort führt zurück nach `pending_review`.
  - Der heutige Guard erfüllt das schon über den Status: Jede Inhaltsänderung an `active`/`paused` setzt sofort `pending_review`, eine pausierte Anzeige ist also nie unbemerkt geändert.
  - Zusätzlich als zweite Sicherung: Beim Freigeben speichert der Server `approved_content_hash` (Hash über alle Inhaltsfelder, Wildarten und Fotos inklusive Reihenfolge und Alt-Text). `paused → active` prüft, dass der aktuelle Hash gleich ist, sonst `pending_review`. So hält die Regel auch, falls ein späterer Weg (z. B. Admin-Korrektur, Server) Inhalte ändert.

### 5.2 Tests
- **pgTAP** (`04_listings` erweitert):
  - Eine Schleife über **alle** Werte von `listing_status` als Ausgangszustand prüft `UPDATE … status = 'active'` durch den Besitzer: `42501` für jeden Zustand außer `paused` mit gültigem `expires_at`.
  - Der Insert mit `active` ist bereits abgedeckt.
  - Neu:
    - Upsert-Varianten
    - `paused → active` plus Titeländerung → `pending_review`
    - `paused → active` nach Ablauf → `42501`
    - Foto an pausierter Anzeige → `pending_review`
    - **Regel aus Antwort 4**, je Feld ein Fall: Änderung an Titel, Beschreibung, Preis (Betrag, Währung, Einheit), Kreis, Punkt, Foto (neu, gelöscht, Reihenfolge, Alt-Text) an einer pausierten Anzeige → `pending_review`; danach `paused → active` unmöglich. Ohne Änderung → Fortsetzen klappt.
    - Hash-Sicherung: Inhalt als Server geändert, dann `paused → active` durch den Besitzer → `pending_review`
    - `authenticated` darf `session_replication_role` nicht setzen und Trigger nicht abschalten
- **Integration** (`web/integration/listings.test.ts`): dieselben Kernfälle über die echte API, also PATCH, POST, POST mit `Prefer: resolution=merge-duplicates` und `supabase-js` `upsert`. So ist belegt, dass kein Client-Weg am Trigger vorbeiführt.
- **E2E:** Nach dem Absenden zeigt „Meine Anzeigen“ den Status „In Prüfung“. Die UI bietet keine Aktion „Freischalten“.

## 6. Pflichtfelder je Art (vom Nutzer freigegeben 2026-10-29)
Die DB prüft beim Übergang nach `pending_review` und bei der Admin-Freigabe (`23514`, `hint` als JSON mit Feldcodes); Zod prüft dasselbe vorab, beide über gemeinsame Fixtures. Entwürfe dürfen unvollständig sein.

**Mindestfelder, Pflicht für alle Anzeigen (Angebot und Gesuch):**
| Feld | Regel |
|---|---|
| Art (`kind`) | Pflicht |
| Angebot/Gesuch (`direction`) | Pflicht |
| Ort: PLZ und Ortsname | Pflicht; PLZ wird gegen ein Verzeichnis geprüft und muss zum Landkreis passen (siehe 6.1) |
| Land und Landkreis (`region_id`); Bundesland folgt daraus | Pflicht |
| Titel | Pflicht, 3–100 Zeichen |
| Beschreibung | Pflicht, 30–5000 Zeichen |
| Sprache des Textes | Pflicht, vorbelegt mit der UI-Sprache |
| Rechtshinweis-Häkchen `legal_ack` | Pflicht nur bei `trophy_hunt`, bei Angebot **und** Gesuch |

Immer optional: Preis (wenn angegeben: Betrag + Währung + Einheit oder „auf Anfrage“), Fotos (höchstens 8, alle verarbeitet), Zeitraum.

**Zusätzlich Pflicht nur bei Angeboten:**
| Art | Pflicht | Optional |
|---|---|---|
| Jagdpacht (`lease`) | Pachtart `lease_type`, Reviertyp `revier_type[]` (≥ 1), Fläche `area_hectares`, Wildarten (≥ 1) | Abgabefrist, Pachtdauer, Abschussplan, Jagdhütte, Plätze für Mitpächter |
| Begehungsschein (`permit`) | Umfang `permit_scope`, entgeltlich `paid`, Wildarten (≥ 1) | Saison, Abschussgrenzen |
| Gesellschaftsjagd (`driven_hunt`) | Datum `event_date` (nicht in der Vergangenheit), freie Plätze `spots_available` (≥ 1) | Treffpunkt, Hunde erforderlich, Wildarten |
| Trophäen-/Gastjagd (`trophy_hunt`) | Wildarten (≥ 1, normale Auswahl über `listing_species`) | Trophäendetails (Freitext `trophy_details`, max 1000 Zeichen), Saison, Unterkunft, Hinweis zu Import/Export |
| Jagdhelfer/Mitjäger (`helper`) | Aufgaben `tasks[]` (≥ 1) | Erfahrung, Zeitraum |

**Gesuche:** nur die Mindestfelder, alle Felder der Art sind optional. Das Häkchen bei `trophy_hunt` gilt auch hier.

`species_targeted[]` entfällt (Antwort 2): Trophäenanzeigen nutzen die normale Wildartenauswahl und erscheinen damit im Wildartenfilter.

SPEC 7.2 bleibt offen: Die endgültigen Pflichtangaben je Art prüft der Anwalt. Die Regeln stehen deshalb an einer Stelle (DB-Funktion und Zod mit gemeinsamen Fixtures) und sind per Test fixiert.

### 6.1 Ort mit PLZ (neu, Antwort 1)
- PLZ und Ortsname sind Pflicht. Die PLZ muss im Verzeichnis existieren und zum gewählten Landkreis passen. Die Eingabe der PLZ schlägt Kreis und Ortsnamen vor.
- **Nie öffentlich (CLAUDE.md Standorte):** Eine PLZ grenzt das Revier oft enger ein als der verfremdete Punkt. PLZ und Ortsname liegen deshalb in einer eigenen Tabelle `public.listing_places` (nur Besitzer und Admin lesbar, RLS, Tests), nicht in `listings`. Öffentlich bleibt nur der Landkreis.
- Datenbasis (entschieden): Tabelle `public.postal_codes (country, code, place_name, region_id)` für DE und AT, ADR 012.
  - DE: OpenStreetMap (`boundary=postal_code`, Ortsnamen aus `note`/`postal_code`-Relationen bzw. `place`-Knoten), Zuordnung zu Kreisen per Verschneidung mit den OSM-Kreisgrenzen (`admin_level=6`) und Abgleich der amtlichen Kreisschlüssel (`de:amtlicher_gemeindeschluessel`/`de:regionalschluessel`) mit `regions.code`. Lizenz ODbL 1.0: Namensnennung „© OpenStreetMap-Mitwirkende“ auf Impressum/Über-Seite und in der Dokumentation; die abgeleitete Datenbank steht unter ODbL (Share-Alike für die Tabelle, nicht für den übrigen Code).
  - AT: Statistik Austria, PLZ–Gemeinde-Verzeichnis (CC BY 4.0), Zuordnung über die Gemeindekennziffer zum Bezirk.
  - Import wie bei den Regionen (ADR 007): ein reproduzierbares Skript unter `supabase/seed/tools/` erzeugt eine eingecheckte, versionierte SQL-Datei mit Stand und Quelle; keine Laufzeitabfragen an OSM.
  - `postal_codes` ist öffentlich lesbar (reine Referenzdaten, kein Personenbezug), RLS mit Select-Policy und Tests wie `regions`.
- Sichtbarkeit (entschieden): PLZ und Ort einer Anzeige sind nie öffentlich, nur für Besitzer und Admin/Moderation.
- Formatprüfung vorab: DE 5 Ziffern, AT 4 Ziffern; die Verzeichnisprüfung entscheidet.
- Eine PLZ, die mehrere Kreise schneidet, erlaubt jeden dieser Kreise.

**Preis:** Eingabe als Text, Umrechnung in `price_minor` ohne Gleitkomma (reine Funktion mit Vitest, Exponent 2 für EUR/CHF/CZK/PLN). Die Standardwährung leitet sich aus dem Land des Kreises ab, ist aber änderbar.

**Waffenhinweis beim Absenden (Antwort 6):** Findet `listing_content_hints` Begriffe, zeigt die Vorschau einen deutlichen Hinweis mit den Fundstellen und dem Verweis auf die Richtlinien; Absenden bleibt möglich.

## 7. Web
- **Routen** unter `/{locale}/account/listings` (geschützt, `noindex`, über `PROTECTED_SECTIONS` schon abgedeckt):
  - Liste „Meine Anzeigen“: Status-Badge, Ablehnungsgrund, Aktionen Bearbeiten, Entwurf löschen, Zurückziehen
  - `/new`
  - `/[id]/edit?step=…`
- **Assistent** wie SPEC 4.1:
  - Schritte: Art → Angebot/Gesuch → Details (Felder je Art, Wildarten) → Fotos → Ort (Land → Bundesland → Kreis) / Zeitraum / Preis → Vorschau → Absenden
  - Der Entwurf entsteht beim ersten „Weiter“ nach Art, Richtung, Titel und Kreis, weil die DB diese Spalten als Pflicht führt.
  - Jeder Schritt speichert per Server Action, mit Anmeldeprüfung; das erzwingt `guards.test.ts`.
- **Fotos:** Client Component, Upload in den Eingang über den Browser-Client (öffentlicher Key), dann Aufruf der Function. Reihenfolge per Tastatur änderbar, optionales Alt-Text-Feld je Foto, Fallback der Titel. HEIC wird vor dem Upload mit klarer Meldung abgelehnt.
- **Services:** `web/lib/services/listings.ts`, `photos.ts`, `regions.ts`. Fehler `RV001` → Onboarding, `RV002` → Hinweis „Limit erreicht“, `23514` → Feldfehler.
- **Barrierefreiheit:** `fieldset`/`legend` je Schritt, Fortschritt „Schritt x von 7“, Fehlerzusammenfassung mit Ankern, ab 360 px.
- **Texte** in 4 Sprachen. Glossar: Arten, Richtungen (cs/pl fehlen noch) und die Attributbegriffe aus SPEC 3.2.
- **CSP:** `connect-src` erlaubt Supabase schon (Functions laufen unter `/functions/v1`). Die Function setzt CORS auf `SITE_URL`.

## 8. Doku
- ADR 011 „Fotoverarbeitung“
- ADR 006 überarbeitet (Verfahren 4.1, Restrisiken, Secret)
- ADR 008 (Eingangsdateien)
- ADR 010 (`RV002`)
- SPEC v0.5 (3.1 Fotospalten, 3.2 Pflichtfelder, 3.3 Raster und Versatz)
- Glossar, CHANGELOG mit iOS-Lücke (I4)

## 9. Commits (je grün, Reihenfolge nach Auflage 13)
Bis zur Bestätigung der Tabelle in Abschnitt 6 nur die Commits 1–5.
1. Spike Bildbibliothek: Speicher, CPU und Kaltstart bei 12 MP und 15 MB; Ergebnis an den Architekten **vor** Commit 5. ADR 011 hält fest, dass die gehosteten Limits bei der Stage-Einrichtung gemessen werden, und nennt die Auswege.
2. ADR 011, ADR 006 (inklusive Secret-Runbook), ADR 008 (Eingang, verwaiste Dateien, Entwürfe), SPEC v0.5, Glossar
3. Migration Standort v2 (inklusive „Punkt nur durch den Besitzer“, Trigger auch bei `region_id`, Fingerprint) und `12_location`, `00_meta` mit Allowlist für `private`
4. Migration Fotos: Buckets, Spalten, Spalten-GRANTs, Pfad-Trigger, Policies, `alt_text`, Foto-Tageslimit; `08_storage` und `web/integration/storage.test.ts` im selben Commit angepasst
5. Edge Function `process-listing-photo`, `deno check`/`lint`/`test` mit Lockfile, Integrationstests mit Allowlist-Prüfung, CI mit Edge Runtime
5a. ADR 012, Generator und Daten-Migration (`supabase/data/postal_codes/`, Quell-Hashes) für PLZ, PLZ→Kreis und PLZ→Ortsname; Verschneidung gegen VG250 mit Flächenschwelle, Override-Datei, Statistik mit Abbruchprüfungen; RLS, pgTAP; Seite „Datenquellen“ mit OSM-Namensnennung und ODbL-Download
5b. `listing_places` (RLS nur Besitzer und Admin mit aal2, Spaltenrechte, kein FK auf `postal_codes`), RPC `set_listing_location` (security invoker, Kreis und PLZ in einem Schritt), Children-Guard deckt `listing_places` ab, Meta-Test „wer darf `listing_places` verwenden“
6. Eine Migration fasst den `listings_guard` neu (inklusive PLZ-Prüfung in der Bereitschaft beim Absenden und bei der Freigabe), mit benannten Hilfsfunktionen: Pflichtfelder, Legal-Gate, Rate-Limit, Hash, Admin-Bereitschaft (A1), Status-Matrix in pgTAP; Preisgrenzen je Währung, Attribut-Check
7. RPC `listing_content_hints` und `private.content_terms`

8. Integration `listings.test.ts`
9. Web: Services, Zod mit gemeinsamen Pflichtfeld-Fixtures, Preisumrechnung (Vitest)
10. Web: „Meine Anzeigen“
11. Web: Assistent ohne Fotos
12. Web: Fotos im Assistenten, Umwandlung im Client
13. E2E: Kernflow Inserieren für alle 5 Arten (mindestens 1 vollständig, 4 per Pflichtfeld-Validierung), Freigabe nur im globalSetup
14. CHANGELOG, QA-Hinweise

## 10. Neue Abhängigkeiten
- Bildbibliothek in der Edge Function (3.4), gepinnt
- Web: keine (Canvas nativ)

## 11. Entscheidungen des Nutzers (2026-10-29)
1. In M3 nur Landkreis; Verfremdung trotzdem bauen und testen; Kartenanbieter später.
2. Nur JPEG/PNG/WebP, klare Fehlermeldung bei HEIC.
3. Gesuche lockerer; Mindestfelder Art, Ort, Land/Region, Titel, Beschreibung. Tabelle aus Abschnitt 6 vor der Umsetzung vorlegen.
4. Fortsetzen ohne Prüfung nur ohne Änderung seit der Freigabe; jede Änderung an Titel, Text, Preis, Fotos oder Ort → `pending_review`, mit Test.
5. 15 MB je Foto, 8 Fotos. Konten in den ersten 7 Tagen höchstens 3 neue Anzeigen pro Tag, danach 10.
6. Deutlicher Hinweis beim Absenden, kein Blocken. In M4 markiert ein Begriffsabgleich verdächtige Anzeigen.
7. In M3 darf jeder absenden; Verifizierungspflicht vor M4/M5.
8. Optionales Alt-Text-Feld je Foto, Fallback der Titel.

Noch offen: Bestätigung der Tabelle in Abschnitt 6 inklusive `legal_ack` bei Trophäen-Gesuchen.

## 12. Auflagen des Architekten (eingearbeitet)
1. **Ungeprüfte Fotos auf freigegebenen Anzeigen** (A1, blockierend): Admin-Freigabe prüft die Bereitschaft inklusive „alle Fotos verarbeitet“. Die Function setzt `active`/`paused` nach der Verarbeitung auf `pending_review`. Getestet in pgTAP und Integration: Freigabe vor der Verarbeitung → `23514`; Verarbeitung an aktiver Anzeige → `pending_review`.
2. **Spaltenrechte `listing_photos`** (A2):
   - INSERT nur auf `(listing_id, sort_order, alt_text)`, UPDATE nur auf `(sort_order, alt_text)`
   - `upload_path`, `storage_path`, `thumb_path` leitet ein Trigger aus der `id` ab
   - `processed_at`, `width`, `height` setzt nur `service_role`
   - Test mit `has_column_privilege`
3. **Besitz und Policies** (A3, A4):
   - Die Function prüft `owner_id = getUser().id` ausdrücklich und antwortet für fremde wie für unbekannte IDs gleich. `verify_jwt = true`, `getUser()` erkennt gesperrte Konten.
   - Die Lese-Policy des Buckets `listing-photos` umfasst `storage_path` und `thumb_path` und nur `processed_at is not null`.
   - Eingang: nur INSERT für den Besitzer, weder SELECT noch UPDATE.
4. **Limits und Formate** (A5–A7):
   - Verkleinerung im Client ist Vertrag (≤ 2560 px, JPEG, sRGB, Orientierung in den Pixeln), 15 MB Dateigrenze.
   - Server: ≤ 4096 px, ≤ 12 MP, nur JPEG (+PNG), Format beim Lesen explizit, ResourceLimits.
   - Dazu Idempotenz und Nebenläufigkeit nach A8: Ausgaben per Upsert, `processed_at` nur bei `is null`, dann den Eingang löschen; bei Fehlern den Eingang löschen. Zustände `uploaded`/`processed`/`failed` stehen im ADR 011.
   - Foto-Tageslimit 100 Inserts je Konto (A9).
5. **Tests der Metadaten-Entfernung** (A11):
   - Positivkontrolle der Fixtures mit demselben Parser.
   - Segment-Allowlist für Bild und Thumbnail: nur SOI, APP0, DQT, SOF0/2, DHT, DRI, SOS, EOI; nichts nach EOI.
   - Suche nach den GPS-Rationals, dem XMP-Namespace, dem Kommentar und `PK\x03\x04`.
   - Negativfälle HEIC und SVG/HTML als `image/jpeg`.
   - E2E: WebP mit EXIF durch den ganzen Weg; Freigabe nur im globalSetup.
6. **Standort-Orakel** (B1–B3):
   - `display_location` ändert nur der Besitzer, auch kein Admin.
   - Die Ableitung ist nicht aufrufbar; `00_meta` bekommt eine Allowlist für `private`.
   - Der Trigger feuert auch bei `region_id`; ein Kreiswechsel ohne Punkt setzt `null`.
7. **Standort-Tests** (B4, B5):
   - Ringgrenzen [2,28; 5,72] km.
   - Der konstante Vektor Ausgabe − Zellmitte ist belegt, Mittelwerte in EPSG:3035.
   - Die Testpunkte liegen nachweislich in derselben Zelle bzw. weit genug vom Centroid.
8. **Gates und Statuslogik** (C1–C3, F1):
   - Legal-Gate: `require_current_legal()` wird für `authenticated` ausführbar oder inline, steht nach `is_server()` und greift nicht bei Delete, Pause und Zurückziehen.
   - Die Pflichtfeldprüfung läuft auf dem **endgültigen** Status, auch bei automatischen Übergängen nach `pending_review` und im verschachtelten Children-Guard. Der Assistent speichert Änderungen an aktiven und pausierten Anzeigen gesammelt.
   - Rate-Limit mit Advisory-Lock je Besitzer, Definer-Hilfsfunktion für das Kontoalter, RLS und Cascade auf `private.listing_creations`.
   - `approved_content_hash`:
     - liegt in einer privaten Tabelle, nur der Guard setzt ihn bei der Freigabe
     - kanonische Form über alle Inhaltsfelder, Wildarten, Fotos inklusive Reihenfolge, `alt_text` und `processed_at`
     - fail closed: Fehlt der Hash, gibt es kein Fortsetzen
   - Tabelle 5.1 ergänzt.
   - Meta-Tests:
     - Die Inhaltsspalten im Guard decken den UPDATE-GRANT ab.
     - Nur der Guard setzt `status`.
     - Die Statusschleife läuft zusätzlich mit Inhaltsänderung, als Admin-Besitzer und mit `aal1`.
     - Die Feldliste zu Entscheidung 4 deckt auch `attributes`, `kind`/`direction`, Sprache, Zeitraum und Wildarten ab.
9. **Spike** (A5): Messung bei 12 MP/15 MB vor Commit 5; der Hinweis „gehostet bei Stage messen“ steht im ADR 011.
10. **Secret** (B6, B7):
    - Ein Fingerprint in `app_settings` lässt die Migration abbrechen, wenn das Secret nach einem Restore fehlt oder abweicht. Es wird nicht still neu angelegt.
    - Restore- und Escrow-Runbook, Ernstfallplan bei Leck in ADR 006.
    - Die Logging-Checkliste umfasst Postgres-Parameter, API- und Edge-Logs und Server Actions.
11. **Pflichtfelder** (D1, D2):
    - Gemeinsame Fixtures für DB und Zod, `hint` maschinenlesbar (JSON mit Feldcodes).
    - Wildarten bei `trophy_hunt` über `listing_species` statt `species_targeted[]` (Nutzer muss zustimmen).
    - Der Web-Service behandelt 0 betroffene Zeilen als Fehler.
12. **`listing_content_hints`** (F3): gleiche Antwort für fremde und unbekannte IDs, Eintrag in der `00_meta`-Allowlist, Abgleich über alle 4 Sprachen und Alt-Texte, `content_terms` ohne API-Rechte.
13. **Commits und CI** (D4, D5): siehe Abschnitt 9.
    - Edge Runtime im Job `e2e`, `deno check`/`deno lint`/`deno test` mit `deno.lock`, Aufwärmen vor den Tests.
    - Der Secret-Grep gilt auch für `supabase/functions/`.

Weitere, nicht blockierende Punkte für die Umsetzung:
- **Preisgrenzen je Währung (D3):** EUR/CHF ≤ 10⁹, CZK ≤ 2,5·10¹⁰, PLN ≤ 5·10⁹ Minor-Einheiten. Betrag 0 nicht erlaubt (dann „auf Anfrage“). Vitest prüft Komma/Punkt, Tausendertrenner, mehr als 2 Nachkommastellen und negative Werte.
- **Entwürfe (D6):** In ADR 008 Löschung nach 12 Monaten Inaktivität mit Hinweis vorab (Umsetzung M9). Frage an den Nutzer.
- **Löschen (A10):** Der Web-Service löscht beim Entfernen eines Fotos oder Entwurfs zuerst die Dateien, dann die Zeile. Der M9-Job räumt Eingangsdateien älter als 24 h und Dateien ohne Zeile ab.
- **Plausibilitätsradius (B8):** 60 km.
- **`content_changed` (B9):** vergleicht den Rohpunkt. Ohne Punkt-UI in M3 ist das unkritisch, es steht aber im ADR.
- **RV002 (F4):** `hint` mit dem Zeitpunkt, ab dem wieder inseriert werden kann.
- **Kontrolle `alt_text` (F2):** in den Spalten-GRANTs; die Ausgabe wird nur escaped (React), JSON-LD folgt in M5 mit Escaping.

## 13. Entscheidungen 2026-10-29 (zweite Runde) und noch Offenes
- `legal_ack` auch bei Trophäen-Gesuchen Pflicht; Gesuche sonst nur Mindestfelder. Die Tabelle in Abschnitt 6 gibt der Nutzer nach Durchsicht frei.
- Ort mit PLZ-Prüfung ist Pflicht (6.1).
- Wildarten über `listing_species`, dazu optional `trophy_details` (Freitext).
- **Lasttest** im vorhandenen Frankfurt-Projekt des Nutzers mit Wegwerf-Fotos, nur eine temporäre Spike-Function, keine Migrationen, kein Bucket, kein `supabase link`, danach wieder löschen (siehe 13.2).
- Verkleinerung im Client als Entlastung, die serverseitige Bereinigung bleibt Pflicht (bereits Vertrag, Auflage 4).
- Verlassene Entwürfe: 12 Monate Inaktivität, Hinweis vorab, Umsetzung M9; in SPEC 7.3 als Punkt für den Anwalt eingetragen (Commit `dcef6bd`).

### 13.1 Entschieden (dritte Runde)
1. PLZ-Verzeichnis aus OpenStreetMap (DE), Statistik Austria (AT).
2. PLZ und Ort nie öffentlich.
3. Pflichtfeld-Tabelle in Abschnitt 6 freigegeben.

Nachprüfung durch den Architekten: nur Abschnitt 6.1 (PLZ) und der zugehörige Commit.

### 13.2 Lasttest (Spike, Commit 1)
- Function `photo-spike`:
  - nimmt ein JPEG/PNG direkt im Request-Body an (keine Datei in Storage, keine DB)
  - prüft den Header, dekodiert, dreht, kodiert neu (2048 px plus Thumbnail)
  - antwortet mit Messwerten: Dauer je Phase, Ein- und Ausgabegröße, Ergebnis der Segment-Allowlist
- Schutz: `verify_jwt = false`, stattdessen Header `x-spike-token` gegen das Function-Secret `SPIKE_TOKEN`. Ohne passendes Token antwortet die Function sofort mit 401, damit Fremde den Speicher nicht belasten.
- Bilder: synthetische 12-MP-, 8-MP- und 4-MP-JPEGs mit eingefügten Fake-GPS-Daten, dazu ein PNG, die das Testskript erzeugt. Keine echten Fotos nötig.
- Messung:
  - je Größe 10 Aufrufe nacheinander und 5 parallel
  - Ausfälle durch CPU- oder Speichergrenze (Status 546 bzw. Logs „CPU time exceeded“, „Memory limit exceeded“), dazu Kaltstart
- Ergebnis kommt ins ADR 011 und geht vor Commit 5 an den Architekten.
- Danach löschen: `supabase functions delete photo-spike`, `supabase secrets unset SPIKE_TOKEN`.

## 14. Nachprüfung PLZ-Teil (Architekt, Freigabe mit Auflagen)
Review: `docs/reviews/M3-plan-architekt-plz.md`. Eingearbeitet:
- Prüfung „PLZ existiert und passt zum Kreis“ in der Bereitschaftsprüfung (Absenden, Admin-Freigabe), Kreis und PLZ ändert eine gemeinsame RPC; der Assistent fragt die PLZ vor dem Anlegen des Entwurfs ab.
- Änderungen an PLZ/Ort führen an aktiven und pausierten Anzeigen nach `pending_review`; der Freigabe-Hash enthält PLZ und Ort und bleibt privat (bei rund 8 200 PLZ sonst per Durchprobieren knackbar).
- Kein späteres Such-Orakel: Regel in ADR 012 und SPEC 3.3, Meta-Test; für M5 keine PLZ in Meta-Tags, JSON-LD, Sitemap, URL.
- ODbL: Abweichung von ADR 007 begründen, Namensnennung am PLZ-Feld und auf „Datenquellen“, PLZ-Tabelle als ODbL-Download; Frage „Collective Database“ an den Anwalt (SPEC 7).
- AT-Quelle vor dem Commit prüfen (Gemeindeverzeichnis enthält evtl. nur die PLZ des Gemeindeamts).
- PLZ-Lookup per POST-RPC oder Laden aller PLZ des gewählten Kreises, nicht per GET (API-Log).
- Admin-Ansichten in M4: PLZ nur in der Moderations-Detailansicht.
- Weitere Märkte: PLZ-Daten kommen zusammen mit den Kreisen.

Offen beim Nutzer: Ort beim Gesuch = gesuchtes Gebiet oder Wohnort? Genügt beim Gesuch der Kreis ohne PLZ? Bis zur Antwort gilt „Pflicht für alle“.
