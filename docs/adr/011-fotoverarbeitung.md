# ADR 011: Fotoverarbeitung ohne Metadaten

Status: angenommen (M3), umgesetzt in Commit 5. Limits nach Lasttest und Speichermessung vom 2026-10-29.

## Kontext
Fotos von Revieren tragen oft GPS-Koordinaten in EXIF/XMP und würden damit die exakte Lage verraten (CLAUDE.md Standorte, Review M2). Clientseitiges Entfernen ist umgehbar, weil die API mit dem öffentlichen Key direkt erreichbar ist. Web und iOS müssen sich gleich verhalten.

## Entscheidung
- **Zwei Buckets:**
  - `listing-uploads` (privat, 15 MB, nur `image/jpeg`; PNG gestrichen, Spike-Review Auflage 7): Eingang für Originale. Nutzer dürfen dort nur **hochladen**, und nur unter dem `upload_path` eines eigenen, registrierten, unverarbeiteten Fotos. Kein Lesen, Überschreiben oder Löschen, auch nicht durch den Besitzer.
  - `listing-photos` (privat, nur `image/jpeg`): verarbeitete Bilder und Thumbnails. Schreiben nur `service_role`. Lesen nur für Fotos mit `processed_at` an sichtbaren Anzeigen; der Besitzer sieht seinen Ordner.
- **Zeile zuerst:** Der Client legt `listing_photos (listing_id, sort_order, alt_text)` an. Ein Trigger leitet aus Besitzer, Anzeige und Foto-id die Pfade ab:
  - `upload_path` = `{owner}/{listing}/{id}`
  - `storage_path` = `{owner}/{listing}/{id}.jpg`
  - `thumb_path` = `{owner}/{listing}/{id}_thumb.jpg`
  - `processed_at`, `width`, `height` setzt nur der Server (Spaltenrechte).
- **Vertrag für Clients (Web, iOS I4):**
  - vor dem Upload verkleinern: lange Seite ≤ 2560 px, JPEG, sRGB, Orientierung in die Pixel gedreht
  - Web wandelt PNG/WebP per Canvas nach JPEG; HEIC wird mit klarer Meldung abgelehnt, iOS konvertiert HEIC nativ
  - Das ist Entlastung, keine Sicherheitsmaßnahme.
- **Edge Function `process-listing-photo`** (`verify_jwt = true`, `getUser()`), Code unter `supabase/functions/process-listing-photo/`:
  1. Besitz ausdrücklich prüfen (`owner_id` = Nutzer); fremde und unbekannte IDs bekommen dieselbe Antwort.
  2. Original aus dem Eingang laden. Fehlt es, `not_uploaded` ohne Versuch. Dann einen Versuch beanspruchen (`claim_photo_processing`, höchstens 3 je Foto, Zähler `processing_attempts` nur vom Server).
  3. Strenger Header-Parser (`jpeg_header.ts`), bevor dekodiert wird:
     - nur JPEG (SOF0/1/2, 8 Bit, 1 oder 3 Komponenten, genau ein Frame)
     - Durchlauf über alle Scans, höchstens 16
     - ≤ 4096 px je Seite, **≤ 8 MP Baseline, ≤ 5 MP progressiv** (Messung unten)
     - EOI vorhanden; Daten nach EOI werden ignoriert
     - jede Ausnahme ergibt `corrupt`
  4. Dekodieren, Abmessungen und Komponenten gegen den Header prüfen, verkleinern (Flächenmittel, lange Seite 2048 px), dann Orientierung anwenden (alle 8 EXIF-Werte, Drehen nach dem Verkleinern ist billiger), **neu kodieren** (Baseline-JPEG q82, Thumbnail 480 px q80). Neukodieren verwirft alle Metadaten und angehängten Daten; die Ausgabe wird gegen eine Marker-Allowlist geprüft.
  5. Ausgaben per Upsert schreiben, dann `complete_photo_processing` (`processed_at … where processed_at is null`). Ist das Foto inzwischen gelöscht (`gone`), die eigenen Ausgaben wieder entfernen; bei einem parallelen Lauf (`already`) bleiben sie, weil die Pfade gleich sind. Danach den Eingang löschen, auch bei `corrupt`, `unsupported` und `too_large`, damit der Client neu hochladen kann.
  6. Ist die Anzeige `active` oder `paused`, setzt `complete_photo_processing` sie auf `pending_review`. Das ist der einzige Schreibzugriff auf `listings` (Review Plan M3, A1).
  - Logs: nur Foto-id, Ergebnis-Code und Dauer, keine Pfade, Bildbytes oder EXIF-Werte (Auflage 9).
- **Vertrag für Clients (Web, iOS I4):** `POST /functions/v1/process-listing-photo` mit `{ "photo_id": "<uuid>" }` und dem Access Token, nach dem Upload in den Eingang.

| HTTP | Antwort | Bedeutung für den Client |
|---|---|---|
| 200 | `{ status: "processed", width, height }` | verarbeitet; wiederholter Aufruf liefert `{ status: "processed" }` |
| 400 | `bad_request` | Body falsch |
| 401 | (Gateway) bzw. `unauthorized` | neu anmelden |
| 404 | `not_found` | unbekannt, fremd, Anzeige entfernt oder Konto gesperrt |
| 409 | `not_uploaded` | Upload fehlt, erst hochladen |
| 413 | `too_large` | Bild zu groß, Eingang gelöscht |
| 422 | `unsupported` / `corrupt` | kein lesbares JPEG, Eingang gelöscht |
| 429 | `attempts_exhausted` | Foto löschen und neu anlegen |
| 500, 502, 504, 546, Netzabbruch | – | **fehlgeschlagen:** Der Eingang bleibt liegen und lässt sich nicht überschreiben. „Neu hochladen“ legt eine neue Fotozeile an und löscht die alte (zählt gegen das Tageslimit). Den Eingang räumt der Job in M9 ab (≤ 24 h). Meldung in 4 Sprachen (Spike-Review Auflage 1). |

  - Zustände für Clients: `registriert` → `hochgeladen` → `verarbeitet` oder `fehlgeschlagen` (neu hochladen).
- **Sichtbarkeit der Zeilen:** Fremde sehen nur verarbeitete Fotos sichtbarer Anzeigen, der Besitzer alle eigenen.
- **Absenden und Freigabe** verlangen, dass alle Fotos verarbeitet sind (Guard, Plan M3 Commit 6).
- **Limits:** 8 Fotos je Anzeige; 100 neue Fotos je Konto in 24 h, auch nach Löschen (`private.photo_creations`, `RV002`).
- **Alt-Text:** optional je Foto (max 200 Zeichen), Fallback der Titel der Anzeige.
- **Aufräumen:** Beim Entfernen eines Fotos oder Entwurfs löscht der Client erst die Dateien, dann die Zeile. Der Job in M9 löscht Eingangsdateien älter als 24 h und Dateien ohne Zeile (ADR 008).

## Alternativen
- **Metadaten im Client entfernen:** umgehbar.
- **Einzelne Segmente byte-genau herausschneiden:** fehleranfällig (XMP, PNG-/WebP-Chunks, angehängte Daten).
- **Ein Bucket mit Statusspalte:** Ein unverarbeitetes Original läge im selben Bucket wie öffentliche Bilder; eine fehlerhafte Policy würde es freigeben.
- **Supabase-Bildtransformation:** Das Original bliebe gespeichert und abrufbar.

## Bibliothek
- **Nur der JPEG-Codec (WASM) aus `imagescript` 1.3.0**, vendored unter `supabase/functions/_shared/imagescript-jpeg/` (Base64-Modul, SHA-256 im README und im Test, Lizenz MIT gewählt aus „AGPL-3.0-or-later OR MIT“).
  - Grund (Spike-Review Auflage 8): `mod.ts` lädt beim Import **alle** WASM-Module (JPEG, PNG, zlib, GIF, Fonts, SVG, TIFF) zur Laufzeit per `fetch` von deno.land nach. Das wäre eine Netzabhängigkeit ohne Integritätsprüfung und eine unnötige Angriffsfläche.
  - Glue-Code (`codec.ts`) nachgebaut nach `utils/wasm/jpeg.js`, mit eigener WASM-Instanz je Aufruf. Die dekodierten Pixel werden direkt im WASM-Speicher gelesen, ohne Kopie in voller Größe.
  - Verkleinern und Orientierung sind eigener Code (`pixels.ts`): `resize` von imagescript nutzt standardmäßig Nearest Neighbor.
- Einzige npm-Abhängigkeit der Function: `@supabase/supabase-js` 2.117.3 (wie im Web), mit Integrity in `deno.lock`; `deno.json` setzt `lock.frozen`.
- Bei jedem Meilenstein Version und Sicherheitsmeldungen von imagescript prüfen. Das Projekt hat wenige Maintainer; Auswege siehe unten.

## Lasttest (Spike, 2026-10-29)
- **Bibliothek im Spike:** `imagescript` 1.3.0 vollständig (`mod.ts`), JPEG und PNG.
- **Aufbau:**
  - temporäre Function `revier-photo-spike-75672a` im Supabase-Projekt des Nutzers (Free-Plan, Region eu-west-1), ohne Datenbank und Storage
  - Schutz über ein Wegwerf-Token
  - danach gelöscht und als gelöscht geprüft (404, kein Secret mehr)
- **Bilder:** synthetisches Rauschen (ungünstigster Fall für JPEG), mit eingefügten Fake-Metadaten:
  - Exif mit GPS-IFD und Orientation 6, XMP, Kommentar, angehängte ZIP-Signatur
  - 4 MP (3,5 MB), 8 MP (7,1 MB), 12 MP (10,6 MB) JPEG und 4 MP PNG (6,3 MB)
- **Ablauf:** Kaltstart, je Bild 10 Aufrufe nacheinander und 5 gleichzeitig (76 Aufrufe).
- **Ergebnis** (Rechenzeit in der Function ohne Upload, Median/Maximum):

| Bild | erfolgreich | Rechenzeit | Dekodieren |
|---|---|---|---|
| 4 MP JPEG | 16/16 | 0,70 / 0,82 s | 0,44 s |
| 8 MP JPEG | 15/15 | 1,13 / 1,32 s | 0,87 s |
| 12 MP JPEG | 13/15, 2 × `546` (Ressourcenlimit) | 1,34 / 2,00 s | 1,04 s |
| 4 MP PNG | 15/15 | 0,41 / 0,52 s | 0,11 s |

- Alle erfolgreichen Ausgaben bestanden die Segment-Allowlist für Bild und Thumbnail (nur SOI, APP0, DQT, SOF0/2, DHT, DRI, SOS, EOI, nichts nach EOI).
- Ein Aufruf ohne Token wurde sofort mit 401 abgewiesen. Der Kaltstart lag nicht messbar über einem warmen Aufruf.
- **Folgerung:**
  - Die Serverobergrenze ist **8 MP**, nicht 12 MP. 12 MP liegt an der Grenze der CPU-Zeit von etwa 2 s.
  - Der Client-Vertrag (≤ 2560 px, also höchstens etwa 4,9 MP bei 4:3) hält etwa 0,8 s ein und lässt damit reichlich Reserve.
  - Die 15 MB Dateigrenze bleibt; maßgeblich ist die Pixelzahl.
- **Nicht gemessen:** der Speicher in der Cloud (`Deno.memoryUsage` liefert dort nichts). Lokal lag 12 MP bei rund 315 MB, 4 MP bei rund 195 MB. Fehler wegen Speicher würden ebenfalls als `546` erscheinen, sind also in den Zahlen oben enthalten.

## Speichermessung (lokal, Commit 5, Auflage 2)
Mit der umgesetzten Pipeline (vendored Codec, Verkleinern direkt aus dem WASM-Puffer), Deno 2.1.4 in Docker, Rauschbilder aus Pillow (ungünstigster Fall), Spitze der RSS inklusive Eingangspuffer und etwa 54 MB Grundlast der Laufzeit:

| Bild (Dateigröße) | Spitze | Dekodieren |
|---|---|---|
| 4,9 MP Baseline 4:2:0 (4,4 MB), Client-Vertrag | 153 MB | 0,23 s |
| 8 MP Baseline 4:2:0 (7,2 MB) | 178 MB | 0,32 s |
| 8 MP progressiv 4:2:0 (6,6 MB) | 192 MB | 0,58 s |
| 4,9 MP progressiv 4:4:4 (10 MB) | 191 MB | 0,50 s |
| 6,6 MP progressiv 4:4:4 (12 MB) | 236 MB | 0,59 s |
| 8 MP progressiv 4:4:4 (16 MB, über der Dateigrenze) | 248 MB | 0,78 s |

- Vorher (mit Kopien in voller Größe) lag 8 MP Baseline bei 242 MB.
- Folgerung: Baseline bleibt bei **8 MP**. Progressiv liegt erst bis **5 MP** sicher unter 200 MB, deshalb dort die engere Grenze. Der Client-Vertrag (Baseline, ≤ 2560 px) ist nicht betroffen.
- Die Messung in eu-central-1 (Auflage 3) bleibt Blocker für den Go-live; sind die Grenzen dort enger, greifen die Auswege unten.
- **Bei der Einrichtung von Stage und Prod wiederholen:** Region und Plan können abweichen. Das Testprojekt liegt in eu-west-1, Ziel ist eu-central-1 (CLAUDE.md).
- **Auswege, falls die Grenzen dort enger sind:**
  - Obergrenze auf 5 MP senken, was der Client-Vertrag ohnehin einhält
  - Thumbnail im Client erzeugen und auf dem Server nur neu kodieren
  - Supabase-Bildtransformation (Pro-Plan) nur für Thumbnails

## Folgen
- Neue Abhängigkeiten nur in der Edge Function: der vendored JPEG-Codec aus `imagescript` 1.3.0 (einzige leichte JPEG-Dekodierung in Deno; siehe Lasttest) und `@supabase/supabase-js`. Die lokale Edge Runtime erzwingt die gehosteten Limits nicht.
- Die Web-API-Tests importieren die Fixtures der Function (`allowImportingTsExtensions` in `web/tsconfig.json`), damit beide dieselben Testbilder nutzen.
- CI: Job `functions` (Deno-Typcheck, Lint, Tests mit gefrorenem Lockfile); der E2E-Job startet die Edge Runtime für die API-Tests.
- Tests:
  - Deno (`supabase/functions/process-listing-photo/tests/`): Header-Parser mit allen Fällen aus Auflage 5, EXIF-Grenzprüfung, Pixeltest für alle 8 Orientierungen, Metadaten- und Anhangsuche in der Ausgabe, Verkleinern, Prüfsumme des WASM
  - pgTAP `16_photo_processing` (Rechte, Versuche, Ergebnis, Statuswechsel), `08_storage`, `04_listings`
  - API-Tests `web/integration/photo-processing.test.ts` (GPS weg, Orientierung, Eingang gelöscht, fremd = unbekannt, 401/400/409/422/429, kein PNG, Rückkehr in die Prüfung) und `storage.test.ts`
- Testbilder erzeugen die Fixtures zur Laufzeit; im Repo liegen keine Binärdateien.
