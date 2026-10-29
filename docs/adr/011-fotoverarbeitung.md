# ADR 011: Fotoverarbeitung ohne Metadaten

Status: angenommen (M3). Bildbibliothek und gehostete Limits folgen nach dem Lasttest (Spike).

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
  2. Magic Bytes und Header prüfen, bevor dekodiert wird: nur JPEG (+PNG), ≤ 4096 px je Seite, ≤ 12 MP, Grenzen für Frames und Scans. Sonst `unsupported` bzw. `too_large`.
  3. Dekodieren, Orientierung anwenden, **neu kodieren** (JPEG, lange Seite 2048 px, Thumbnail 480 px). Neukodieren verwirft alle Metadaten und angehängten Daten.
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

## Folgen
- Die Bildbibliothek ist eine neue, gepinnte Abhängigkeit nur in der Edge Function. Auswahl und gemessene Limits (Speicher, CPU-Zeit, Kaltstart bei 12 MP und 15 MB) trägt der Spike hier nach. Die lokale Edge Runtime erzwingt die gehosteten Limits nicht; gemessen wird im Frankfurt-Projekt.
- In der CI muss die Edge Runtime laufen.
- Tests: pgTAP `08_storage` (Buckets, Spaltenrechte, Pfade, Sichtbarkeit, Tageslimit), `04_listings`, API-Tests `web/integration/storage.test.ts` (Eingang nur beschreibbar). Die Tests der Metadaten-Entfernung kommen mit der Function.
