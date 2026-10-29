# ADR 011: Fotoverarbeitung ohne Metadaten

Status: angenommen (M3). Bildbibliothek und Limits nach dem Lasttest vom 2026-10-29 festgelegt.

## Kontext
Fotos von Revieren tragen oft GPS-Koordinaten in EXIF/XMP und würden damit die exakte Lage verraten (CLAUDE.md Standorte, Review M2). Clientseitiges Entfernen ist umgehbar, weil die API mit dem öffentlichen Key direkt erreichbar ist. Web und iOS müssen sich gleich verhalten.

## Entscheidung
- **Zwei Buckets:**
  - `listing-uploads` (privat, 15 MB, nur `image/jpeg`/`image/png`): Eingang für Originale. Nutzer dürfen dort nur **hochladen**, und nur unter dem `upload_path` eines eigenen, registrierten, unverarbeiteten Fotos. Kein Lesen, Überschreiben oder Löschen, auch nicht durch den Besitzer.
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
- **Edge Function `process-listing-photo`** (`verify_jwt = true`, `getUser()`):
  1. Besitz ausdrücklich prüfen (`owner_id` = Nutzer); fremde und unbekannte IDs bekommen dieselbe Antwort.
  2. Magic Bytes und Header prüfen, bevor dekodiert wird: nur JPEG (+PNG), ≤ 4096 px je Seite, **≤ 8 MP** (Lasttest, siehe unten), genau ein Frame. Sonst `unsupported` bzw. `too_large`.
  3. Dekodieren, verkleinern (lange Seite 2048 px), dann Orientierung anwenden (Drehen nach dem Verkleinern ist um ein Vielfaches billiger), **neu kodieren** (JPEG q82, Thumbnail 480 px q80). Neukodieren verwirft alle Metadaten und angehängten Daten.
  4. Ausgaben per Upsert schreiben, dann `processed_at … where processed_at is null`; bei 0 Zeilen die eigenen Ausgaben wieder entfernen. Danach den Eingang löschen, auch bei Fehlern (`corrupt`, `unsupported`, `too_large`), damit der Client neu hochladen kann.
  5. Ist die Anzeige `active` oder `paused`, setzt die Function sie auf `pending_review`. Das ist ihr einziger Schreibzugriff auf `listings` (Review Plan M3, A1).
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

## Lasttest (Spike, 2026-10-29)
- **Bibliothek:** `imagescript` 1.3.0 (MIT, reines TS/WASM, `https://deno.land/x/imagescript@1.3.0/mod.ts`, gepinnt). JPEG und PNG dekodieren und kodieren, Drehen und Verkleinern; kein HEIC/WebP nötig, weil der Client nach JPEG wandelt. `magick-wasm` wurde nicht gebraucht.
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
- **Bei der Einrichtung von Stage und Prod wiederholen:** Region und Plan können abweichen. Das Testprojekt liegt in eu-west-1, Ziel ist eu-central-1 (CLAUDE.md).
- **Auswege, falls die Grenzen dort enger sind:**
  - Obergrenze auf 5 MP senken, was der Client-Vertrag ohnehin einhält
  - Thumbnail im Client erzeugen und auf dem Server nur neu kodieren
  - Supabase-Bildtransformation (Pro-Plan) nur für Thumbnails

## Folgen
- Neue Abhängigkeit: `imagescript` 1.3.0, gepinnt, nur in der Edge Function (Begründung: einzige leichte Bibliothek mit JPEG/PNG-Dekodierung in Deno; siehe Lasttest). Die lokale Edge Runtime erzwingt die gehosteten Limits nicht.
- In der CI muss die Edge Runtime laufen.
- Tests: pgTAP `08_storage` (Buckets, Spaltenrechte, Pfade, Sichtbarkeit, Tageslimit), `04_listings`, API-Tests `web/integration/storage.test.ts` (Eingang nur beschreibbar). Die Tests der Metadaten-Entfernung kommen mit der Function.
