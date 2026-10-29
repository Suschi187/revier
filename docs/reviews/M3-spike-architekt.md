# Review Architekt: Spike-Ergebnis Fotoverarbeitung (Auflage 9, M3)

Datum: 2026-10-29. Grundlage: ADR 011, Abschnitt „Lasttest (Spike, 2026-10-29)“ (a820471), Spike-Code (index.ts, load.mjs, gen.mjs, results.json), Migration 20261029104100_listing_photo_processing.sql, Review M3-plan-architekt.md (A5–A11).

## Ergebnis

**Freigabe für Commit 5: ja, mit Auflagen.** imagescript 1.3.0 und eine Serverobergrenze von 8 MP sind tragfähig, weil legitime Clients nach dem Vertrag (lange Seite ≤ 2560 px, höchstens 6,55 MP bei quadratischem Bild, typisch 4,9 MP) im gemessenen Bereich 4 MP bleiben (16/16, max. 0,82 s). 8 MP betrifft nur Clients, die den Vertrag verletzen, und dort ist ein seltener `546` hinnehmbar, **wenn** der Fehlerpfad sauber ist (Auflage 1). Der Header-Parser des Spikes taugt als Skizze, **nicht** als Grundlage; er muss neu und streng geschrieben werden (Auflagen 5–7).

## 1. Messung: Was trägt, was fehlt

Nachgerechnet: Die Zahlen in der ADR-Tabelle stimmen mit results.json überein (z. B. 12 MP max. 1598+26+51+296+32 ≈ 2,0 s). Die Zeiten sind mit `performance.now()` gemessene Wandzeit innerhalb der Function, also eine obere Schranke der CPU-Zeit. Das ist konservativ und richtig so.

| Lücke | Bewertung |
|---|---|
| Speicher in der Cloud nicht gemessen | **Wichtigste Lücke.** Lokal 12 MP ≈ 315 MB, 4 MP ≈ 195 MB, das Limit liegt bei etwa 256 MB. Interpoliert liegt 8 MP bei etwa 255 MB, also genau an der Grenze. Die beiden `546` bei 12 MP können ebenso gut Speicher wie CPU gewesen sein. WASM-Linear-Memory wächst und schrumpft nicht. Ein wiederverwendeter Worker behält die Spitze, und in Produktion kommen noch der Storage-Download, supabase-js und der Upload-Puffer dazu. 15/15 bei 8 MP schließen eine Fehlerrate von einigen Prozent statistisch nicht aus (Dreierregel: bis etwa 20 %). Für legitime Uploads (≤ 6,5 MP) ist das unkritisch, für die Wahl der Grenze aber nicht belegt. → Auflage 2. |
| eu-west-1 statt eu-central-1 | CPU- und Speicherlimits gelten plattformweit, die Hardware kann abweichen. Kein Blocker für Commit 5. Pflicht vor dem Go-live von Stage/Prod, so wie im ADR vermerkt. → Auflage 3. |
| Free-Plan | Das CPU-Limit von 2 s und der Speicher von 256 MB gelten laut Supabase für alle Pläne, nur die Wandzeit ist auf Pro länger. Kein Blocker. |
| Rauschbilder als ungünstigster Fall | Für die Huffman-Dekodierung von Baseline-JPEG richtig, aber **nicht** für: progressive JPEG (Koeffizientenpuffer für das ganze Bild, mehrere Scans; mehr Speicher und CPU), Chroma 4:4:4 (Chromium-Canvas liefert vermutlich 4:2:0), PNG mit 8 MP (nur 4 MP getestet), PNG mit 16 Bit oder Interlacing, PNG mit Alpha. → Auflage 2. |
| Wandzeit inkl. Upload | Die Spalte „ms“ in results.json (2,5–24 s) enthält den Upload vom Testrechner. Bei „parallel“ ist sie vermutlich vom Upstream begrenzt (5 × 7–10 MB). Für die Limits ist sie nicht aussagekräftig, die ADR nutzt sie richtig nicht. Nicht gemessen wurden Download und Upload aus Storage in derselben Region. Das ist asynchrones I/O, belastet die CPU kaum, erhöht aber den Speicher (Eingangspuffer bis 15 MB). |
| Kaltstart | Der erste Aufruf war möglicherweise nicht kalt (nach dem Deploy). Die WASM-Kompilierung fällt bei der ersten Dekodierung an und steckt deshalb in den Decode-Zeiten. Akzeptabel. |

## 2. Sicherheit imagescript 1.3.0

- **WASM/JS-Decoder mit nicht vertrauenswürdigen Eingaben:** Ein Speicherfehler im WASM-Decoder bleibt im linearen Speicher der Sandbox. Daraus folgt kein Ausbruch, aber falsche Pixel, ein Absturz oder eine Endlosschleife. Das reale Risiko ist **DoS**, nicht Codeausführung. Die Abwehr ist mehrstufig: Header-Grenzen vor dem Dekodieren, das CPU-Limit der Plattform als letzte Stufe und Neukodierung (aus dem Decoder gelangen nur Pixel in die Ausgabe). Das reicht, wenn der Fehlerpfad nach einem Abbruch geregelt ist (Auflage 1) und Wiederholungen begrenzt sind (Auflage 4).
- **`deno.land/x`-Import:** Die Versionen auf deno.land/x sind unveränderlich, eine Integritätsprüfung im Repo gibt es ohne Lockfile aber nicht. Supabase bündelt Remote-Imports beim Deploy (eszip). Was beim Deploy geladen wird, ist ohne `deno.lock` nicht festgehalten. Offen ist außerdem, ob imagescript WASM **zur Laufzeit** per `fetch(new URL(..., import.meta.url))` nachlädt, statt es inline (Base64) mitzubringen. In diesem Fall läge eine Netzabhängigkeit an deno.land zur Laufzeit vor, und die Integrität wäre nicht abgedeckt. → Auflage 8.
- **Pflege:** Das Projekt hat wenige Maintainer und seltene Releases. Für Sicherheitsmeldungen gibt es keinen festen Prozess. Vertretbar, weil die Angriffsfläche klein ist (zwei Formate, Sandbox, Neukodierung). Die Folge muss aber im ADR stehen: Bei jedem Meilenstein die Version prüfen, und ein Ausweg muss benannt sein (die ADR nennt ihn bereits).
- **Typ des Decoders:** Der Spike nutzt `Image.decode(...) as Image`. Der Cast verdeckt, wenn die Bibliothek für ein Format ein `GIF` bzw. Frame-Objekt liefert. → Auflage 6.
- **Angriffsfläche verkleinern (Empfehlung):** Kein legitimer Client sendet PNG (Web wandelt per Canvas nach JPEG, iOS nativ). Wird PNG auf dem Server gestrichen, entfallen inflate/zlib, APNG und die Fragen zu Chunks und Bittiefe vollständig. Dafür sind eine kleine Folgemigration (`allowed_mime_types` von `listing-uploads` nur `image/jpeg`) und ein Satz in ADR 011 nötig. Bleibt PNG, gilt Auflage 7.

## 3. Header-Parser des Spikes (`readHeader`, `exifOrientation`, `jpegMarkersAllowed`)

Als Grundlage ungeeignet. Konkrete Mängel:

**JPEG (`readHeader`)**
- Die Segmentlänge wird nicht geprüft. `length < 2` und `start + length - 2 > bytes.length` werden nicht abgefangen, abgeschnittene Dateien laufen durch. Bei `length = 0` rückt die Schleife um 2 Byte weiter und liest Unsinn.
- Die SOF-Erkennung zählt C3, C5–C7, C9–CB und CD–CF als gültige Frames, also lossless, hierarchisch und arithmetisch. Richtig ist eine **Allowlist SOF0/SOF1/SOF2**, alles andere `unsupported`. Außerdem fehlen die Prüfungen von Präzision = 8, Komponenten ∈ {1, 3} (CMYK/YCCK mit 4 Komponenten ablehnen oder bewusst zulassen und testen) und Segmentlänge = 8 + 3·Nc.
- Gelesen wird nur bis zum ersten SOS. Weitere SOF-Marker nach dem ersten Scan (hierarchisch, mehrere Frames) bleiben unsichtbar, ebenso **die Zahl der progressiven Scans**. A7 verlangt eine Obergrenze für SOS, sie fehlt. Nötig ist ein Durchlauf durch die Entropiedaten: `FF00` (Stuffing) und `FFD0–FFD7` (RST) überspringen, an jedem anderen Marker Segmente weiter prüfen, SOS zählen (z. B. ≤ 16), DHT/DQT/DRI zwischen Scans zulassen, bei einem zweiten SOF ablehnen und mit EOI enden. Daten nach EOI (MPO, ZIP) dürfen bleiben, weil neu kodiert wird, werden aber nicht dekodiert.
- DNL (Höhe 0 im SOF) wird zufällig richtig abgelehnt (`!height`). Das ausdrücklich beibehalten und testen.
- Füllbytes (`FF FF` vor einem Marker) und Standalone-Marker vor SOS werden abgelehnt. Diese Strenge ist in Ordnung, muss aber bewusst gewählt und getestet sein.

**EXIF (`exifOrientation`)**
- Es gibt keinerlei Grenzprüfung. Ein IFD-Offset außerhalb oder `count` über das Ende hinaus löst einen `RangeError` aus, der nicht gefangen wird: HTTP 500, und der Eingang bleibt liegen.
- Geprüft werden nur `E`, `x` statt `Exif\0\0`. TIFF-Kopf (`II*\0`/`MM\0*`), Typ SHORT und Count 1 werden nicht geprüft, der Wertebereich 1–8 ebenfalls nicht.
- Nur die Orientierungen 3, 6 und 8 werden behandelt. **Die gespiegelten Werte 2, 4, 5 und 7 fehlen.** Die Drehrichtung von `rotate(270)` für 6 ist nicht durch einen Pixeltest belegt.

**PNG**
- Signatur nur 4 statt 8 Byte. Ob der erste Chunk `IHDR` mit Länge 13 ist, wird nicht geprüft. Bei `bytes.length < 24` führt der DataView-Zugriff zu einem `RangeError` (500).
- Bittiefe, Farbtyp und Interlacing werden nicht geprüft. Bei 16 Bit ist der Rohpuffer doppelt so groß.
- Ein Chunk-Durchlauf fehlt: `acTL`/`fcTL` (APNG) ablehnen, Größe von `zTXt`/`iCCP`/`iTXt` begrenzen (A7), `IDAT` muss vorhanden und zusammenhängend sein, und am Ende muss `IEND` stehen. Die IDAT-Gesamtgröße ist durch 15 MB gedeckelt, das Inflate-Ergebnis durch Breite × Höhe × Byte je Pixel. Die Pixelgrenze greift deshalb nur, wenn sie die Bittiefe einrechnet.

**`jpegMarkersAllowed`**
- Taugt nur als **Testprüfung der eigenen Ausgabe**, nicht als Eingangsprüfung. Die Allowlist für die Ausgabe enger fassen: Kodiert wird baseline, also SOF0 und nicht SOF2. Zusätzlich die Ausgabe byteweise nach `Exif`, `http://ns.adobe.com`, `PK\x03\x04`, dem Kommentartext und den GPS-Rationals der Fixtures durchsuchen.

## 4. Auflagen für Commit 5

1. **Fehlerpfad bei Plattformabbruch (`546`/Timeout).** Die Function kann sich danach nicht selbst aufräumen, der Eingang bleibt liegen. Nach der Migration darf der Client ihn weder überschreiben noch löschen (kein UPDATE/DELETE in `listing-uploads`), ein erneuter Upload auf denselben `upload_path` scheitert also. Festlegen und in ADR 011 schreiben, gleich für Web und iOS (I4):
   - Der Client bildet `546`, `502`, `504` und Netzabbrüche auf `failed`/`retry` ab.
   - Ein „Neu hochladen“ legt eine **neue** Fotozeile an und löscht die alte. Das zählt gegen das Tageslimit, was gewollt ist.
   - Den verwaisten Eingang räumt der M9-Job weg (≤ 24 h, DSGVO-relevant, weil er GPS enthalten kann).
   - Die Meldung ist lokalisiert in 4 Sprachen.
2. **Messung vor dem Festschreiben der 8 MP (lokal genügt, Aufwand klein):**
   - Speicherspitze lokal für 8 MP baseline 4:2:0, 8 MP **progressive** 4:4:4 und 8 MP PNG (falls PNG bleibt) messen, jeweils inklusive Eingangspuffer.
   - Liegt einer dieser Werte über etwa 200 MB (Reserve zu 256 MB plus Laufzeit), die Grenze auf **6,6 MP** (2560², deckt den Client-Vertrag vollständig ab) senken. PNG gegebenenfalls getrennt enger fassen.
   - Werte im ADR nachtragen.
3. **Cloud-Checkliste (Stage/Prod, eu-central-1):**
   - den Spike mit der echten Function wiederholen, inklusive Storage-Download/-Upload und 30 serieller Aufrufe mit 8 MP
   - Abbruchrate dokumentieren
   - Ist sie über 0, greift Auflage 2 (Grenze senken)
   - Blocker für den Go-live, nicht für Commit 5
4. **Wiederholungen begrenzen (Kosten-DoS, A9).** Solange der Eingang nach einem `546` liegt, kann ein Angreifer die Function für dasselbe Foto beliebig oft auslösen, je bis zu 2 s CPU. Abhilfe: einen Versuchszähler bzw. ein Feld `processing_attempts`/`processing_started_at` (nur service_role) setzen und nach höchstens 3 Versuchen den Eingang nicht mehr anfassen (`failed`). Alternativ ein Rate-Limit je Nutzer auf Function-Aufrufe. Einen pgTAP- oder Integrationstest dafür ergänzen.
5. **JPEG-Header-Parser neu, streng, als eigenes Modul mit Unit-Tests (Deno test):**
   - Segmentlänge ≥ 2 und innerhalb der Datei
   - SOF nur C0/C1/C2, Präzision 8, Nc ∈ {1, 3}, Längenprüfung
   - genau ein SOF
   - Durchlauf über alle Scans mit RST/Stuffing, SOS-Obergrenze
   - EOI vorhanden
   - Seite ≤ 4096, Pixel ≤ Grenze aus Auflage 2
   - Jede Ausnahme im Parser ergibt `corrupt`, nie 500
   - Testfälle: abgeschnitten, Länge 0, SOF3, SOF9, 4 Komponenten, 12 Bit, zwei SOF, 100 SOS, DNL/Höhe 0, SOF2 50 000², 4097 × 10, 8,1 MP, HEIC-ftyp, WebP-RIFF, GIF, leere Datei
6. **Dekodieren und Ausgabe:**
   - Format aus den Magic Bytes, formatspezifisch dekodieren, `instanceof Image` prüfen (kein `as Image`)
   - Nach dem Dekodieren `image.width/height` gegen die Header-Werte vergleichen, bei Abweichung `corrupt`
   - EXIF-Parser mit Grenzprüfung (`Exif\0\0`, TIFF-Kopf, Typ/Count, Wert 1–8), alle 8 Orientierungen inklusive Spiegelung
   - Pixeltest mit einer Fixture, deren Ecken farbig markiert sind, je Orientierung
   - Alpha (PNG) vor dem Kodieren auf Weiß legen
   - Ausgabetests: enge Marker-Allowlist (SOF0), Bytesuche nach Exif/XMP/COM/ZIP/GPS-Werten, nichts nach EOI, Thumbnail ≤ 480 px
7. **PNG:** Bevorzugt den Server-Eingang auf JPEG beschränken (Folgemigration für `allowed_mime_types` plus ADR). Andernfalls:
   - 8-Byte-Signatur, IHDR zuerst mit Länge 13
   - Bittiefe 8 (16 nur mit halbierter Pixelgrenze), Interlacing ablehnen oder testen
   - Chunk-Durchlauf mit Längenprüfung, `acTL`/`fcTL` → `unsupported`
   - Text- und ICC-Chunks ≤ 64 KB, IEND am Ende
   - Tests: APNG, IHDR 50 000², abgeschnitten, 16 Bit
8. **Abhängigkeit festhalten:**
   - `supabase/functions/process-listing-photo/deno.json` mit Import-Map auf genau `imagescript@1.3.0`
   - `deno.lock` mit Integrity einchecken, in der CI `--frozen` bzw. `--lock` prüfen
   - Im gecachten Modul nachsehen, ob WASM zur Laufzeit per `fetch` nachgeladen wird. Wenn ja, vendoren (`deno vendor` bzw. `vendor: true`) oder die npm-Variante mit Lock nutzen, damit zur Laufzeit kein Netz nötig ist.
   - Lizenz (MIT) und Prüfung bei jedem Meilenstein im ADR vermerken
9. **Logging ohne personenbezogene Daten:** Die Function protokolliert nur Foto-id, Ergebnis-Code und Dauer, keine Pfade mit Nutzer-id über das Nötige hinaus, keine Bildbytes und keine EXIF-Werte (GPS).
10. **Spike-Reste:** Der Wegwerf-Token, `token.txt` und die Testbilder liegen nur im Scratchpad und nicht im Repo. Die Projekt-Referenz `<projekt-ref>` nicht in Repo-Dateien übernehmen. Die Testbilder für Commit 5 deterministisch neu erzeugen (Generator ins Repo, keine Binärdateien von Dritten).

## 5. Risiken (Rest)

- 8 MP liegt beim Speicher wahrscheinlich nahe am Limit. Das Risiko trifft nur nicht konforme Clients und wird über Auflage 2 entschärft.
- imagescript wird kaum gepflegt. Einen Ausweg nennt ADR 011.
- Gehostete Limits und Hardware in eu-central-1 sind noch nicht gemessen (Auflage 3).
- Display-P3-Fotos von iOS verlieren beim Neukodieren ohne ICC an Farbtreue, wenn der Client nicht nach sRGB wandelt (Vertrag, A6). Für I4 im Blick behalten.
