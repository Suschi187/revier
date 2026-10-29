# Architekt-Review: Plan M3 (Anzeigen erstellen, Web)

Datum: 2026-10-29 · Stand Repo: `cfc3156` · Geprüft: `M3-plan.md` **in der Fassung mit den Entscheidungen des Nutzers (Abschnitt 11)** gegen CLAUDE.md, SPEC v0.4 (3.1–3.4, 6 M3, 7), ADR 006/008/009/010, Review M2, Migrationen (`20261029100400_listings.sql`, `…101200_photos_storage_binding.sql`, `…101500_review_medium.sql`, `…102000_legal_acceptances.sql`, `…103100_legal_consent_error.sql`, `…100000_foundation.sql`, `…100800_storage.sql`), Tests `00_meta`, `04_listings`, `08_storage`, `web/integration/`, `.github/workflows/web.yml`, `supabase/config.toml`. Ich habe nichts ausgeführt (nur Lesezugriff).

Kurzurteil: Die Architektur stimmt. Dazu gehören zwei Buckets mit serverseitiger Neukodierung, ein deterministischer Versatz je (Besitzer, Kreis) und die Statuslogik im Trigger. Die Entscheidungen des Nutzers sind gut einbaubar. Es gibt aber **eine Moderationsumgehung über Fotos (blockierend)**, zwei konkrete Implementierungsfehler im Plan (Legal-Gate, Spalten-GRANT) und mehrere Lücken bei Edge-Function-Limits, Orakeln und Tests. Abschnitt 3.1 des Plans ist trotz der Entscheidungen noch unverändert (optionale Verkleinerung, 40 MP, Besitznachweis über RLS, 3.1.5). Die Ergänzungen (Hash, Zähltabelle, Alt-Text, Begriffs-RPC) bewerte ich in Abschnitt F.

---

## A. Pflichtpunkt A: EXIF/GPS (Plan Abschnitt 3)

### A1. Foto nach der Freigabe ohne Prüfung öffentlich: blockierend
Plan 3.1.4/3.1.5. `listing_children_guard` (`photos_storage_binding.sql:41,55`) und `is_server_caller` (`review_medium.sql:28-35`).

Der Ablauf:
1. Der Besitzer legt an einer `active`-Anzeige eine Fotozeile an. Der Children-Guard setzt die Anzeige auf `pending_review`.
2. Ein Admin gibt sie frei, bevor das Foto verarbeitet ist. Der Admin-Zweig des Guards (`review_medium.sql:93-103`) prüft keine Fotos, und die Prüfung „alle verarbeitet“ hängt nur am Übergang durch den Besitzer.
3. Danach lädt der Besitzer beliebige Bytes in den Eingang. Das ist erlaubt, weil das Foto registriert und unverarbeitet ist.
4. Er ruft die Function auf. Der Schreibvorgang von `service_role` ist laut Plan 3.1.5 privilegiert und setzt die Anzeige **nicht** zurück.

Ergebnis: Ein ungeprüftes Bild ist auf einer freigegebenen Anzeige öffentlich (DSA, App-Store 1.2).

Der neue `approved_content_hash` (Plan 5.1) schließt das **nicht**. Er greift nur bei `paused → active`, und die Fotozeile hat sich bei der Verarbeitung nur in Serverspalten geändert.

Planänderung:
- Der Admin-Übergang `pending_review>active` verlangt im Guard `private.listing_ready_for_review(new)` **inklusive** „keine unverarbeiteten Fotos“. Das ist die maßgebliche Prüfung, unabhängig davon, wie die Anzeige nach `pending_review` kam (siehe C2).
- Die Function setzt nach erfolgreicher Verarbeitung eine Anzeige mit Status `active`/`paused` ausdrücklich auf `pending_review`. Das ist der einzige erlaubte Schreibzugriff der Function auf `listings` und muss im ADR 011 stehen. Plan 3.1.5 wird entsprechend umgeschrieben.
- pgTAP und Integration: Foto an aktiver Anzeige, Admin gibt vor der Verarbeitung frei → `23514`. Verarbeitung an einer aktiven Anzeige → `pending_review`.

### A2. Tabellenweites INSERT-Recht auf `listing_photos` umfasst die neuen Serverspalten: hoch
`20261029100400_listings.sql:392` (`grant insert, update (sort_order), delete on public.listing_photos to authenticated`).

Ein INSERT-Recht ohne Spaltenliste gilt auch für später ergänzte Spalten. Ein Nutzer kann also `processed_at = now()`, `width`, `thumb_path` und `upload_path` selbst setzen. Damit besteht er die Prüfung „alle verarbeitet“ ohne Datei. Wenn die Lese-Policy `thumb_path` auswertet (A4), kann er außerdem beliebige Pfade seines Ordners als „verarbeitet“ ausgeben.

Planänderung:
- `revoke insert on public.listing_photos from authenticated` und `grant insert (listing_id, sort_order, alt_text) …`.
- `grant update (sort_order, alt_text)`.
- Ein Trigger leitet `storage_path`, `upload_path` und `thumb_path` **aus `id` und der Anzeige ab**, statt sie vom Client zu übernehmen. Damit gibt es keine selbst gewählten Namen, etwa einen Pfad, der auf `_thumb.jpg` endet und mit dem Thumbnail eines anderen Fotos kollidiert.
- Bei Inserts, die nicht vom Server kommen, setzt der Trigger `processed_at`, `width` und `height` auf `null`.
- pgTAP: `has_column_privilege` für jede Serverspalte (`authenticated`: kein INSERT/UPDATE) und ein Insert mit `processed_at` → `42501`.

### A3. Besitznachweis in der Function über RLS ist falsch: hoch
Plan 3.1.3.1, `listings.sql:375-377`.

`listing_photos_select` gibt Fotozeilen **jeder sichtbaren** Anzeige frei, also auch fremder aktiver Anzeigen. „Zeile mit dem Nutzer-Client laden“ belegt deshalb keinen Besitz.

Planänderung: Die Function prüft ausdrücklich `listing.owner_id = user.id`, dass die Anzeige nicht `removed` ist, dass `is_active_user` gilt und dass das Foto unverarbeitet ist. Dafür nutzt sie eine eigene, schmale Abfrage. „Nicht deins“ und „unbekannt“ bekommen dieselbe Antwort (`not_found`). Test: Ein Fremder verarbeitet das Foto einer **aktiven** fremden Anzeige → `not_found`. Bisher steht im Plan nur der Fall „fremde ID“.

### A4. Storage-Lese-Policy kennt `thumb_path` nicht, der Eingang braucht eigene Policies: hoch
`photos_storage_binding.sql:81-86` (`p.storage_path = name`) und `:101-103` (eigener Ordner).

- Die Lese-Policy für `listing-photos` muss `(p.storage_path = name or p.thumb_path = name) and p.processed_at is not null` prüfen. Sonst sind Thumbnails für niemanden lesbar außer über die Ordner-Policy des Besitzers.
- Für den Eingang reicht INSERT für den Besitzer, also `upload_path = name`, `processed_at is null`, `owns_editable_listing` und die Initplan-Form. Es gibt **kein SELECT und kein UPDATE** für `authenticated`. Die Vorschau im Client kommt aus dem lokalen Blob. Damit können Originale auch nicht per Signed URL weitergegeben werden.
- Für einen erneuten Versuch braucht der Besitzer ein DELETE im Eingang, oder die Function löscht bei `corrupt`/`unsupported` selbst (A8).
- `upload_path` braucht einen Unique-Index (die Policy fragt danach).

### A5. Edge-Function-Limits: Pixelzahl ist das Problem, nicht 15 MB; der Spike misst lokal das Falsche: hoch
Plan 3.1.3.2 und 3.4; Entscheidung 5 (15 MB).

Die gehosteten Limits sind rund 256 MB Speicher, **2 s CPU-Zeit** je Request und etwa 20 MB Bundle. Ein dekodiertes Bild mit 40 MP braucht als RGBA mindestens 160 MB, bei ImageMagick Q16 etwa 320 MB, und Kopien beim Skalieren kommen hinzu. Dekodieren, Skalieren und Kodieren in WASM dauert bei 12 MP schon nahe 2 s CPU. Die lokale Edge Runtime erzwingt diese Limits nicht wie gehostet. Ein Cloud-Projekt gibt es noch nicht (SPEC 7.1). Ein lokaler Spike belegt also nichts.

Die 15 MB je Foto (Entscheidung 5) können bleiben, als Grenze für die gewählte Datei und den Eingangs-Bucket. Für Speicher und CPU entscheidend ist die **Pixelzahl**.

Planänderung:
- **Die Verkleinerung im Client wird Vertrag für Web und iOS, nicht „optional“** (Plan 3.1.2 ändern). Lange Seite höchstens 2560 px, Ausgabe JPEG, Orientierung in die Pixel übernommen. Sie bleibt ausdrücklich keine Datenschutzmaßnahme. Damit wandelt der Client auch PNG und WebP vor dem Upload nach JPEG.
- Das Serverlimit wird eng: lange Seite ≤ 4096 px und ≤ 12 MP statt 10 000 px / 40 MP. Alles darüber wird mit `too_large` abgelehnt. Ehrliche Clients erreichen das Limit nie.
- Der Spike misst Speicher-Spitze, CPU-Zeit und Kaltstart (WASM-Kompilierung) am Grenzfall (12 MP und 15 MB). Er dokumentiert, dass die Werte **gehostet** noch zu prüfen sind (Auflage für die erste Stage-Einrichtung, Cloud-Checkliste).
- Im ADR 011 als Ausweg nennen:
  - (a) Storage Image Transformations (imgproxy, Pro-Plan): Metadatenentfernung und Rotation selbst testen.
  - (b) Verarbeitung im Next.js-Server mit `sharp`. Das widerspricht der Plattformparität, weil iOS dann vom Web-Backend abhängt, und wäre nur eine Notlösung.
- Ein Abbruch durch die Plattform (`WORKER_LIMIT`, HTTP 546) muss auf einen definierten Code (`too_large`/`retry`) abgebildet werden, den der Client übersetzt.

### A6. Bibliothek nach der Entscheidung „JPEG/PNG/WebP, kein HEIC“: mittel
Plan 3.4 (neu), Entscheidung 2.

Die Entscheidung legt fest, was der **Nutzer** auswählen darf. Der Server muss nur annehmen, was die Clients nach dem Vertrag aus A5 senden.

- **Empfehlung:** Server-Eingang JPEG (und zur Sicherheit PNG). Der Client wandelt WebP per Canvas nach JPEG; das können alle aktuellen Browser. iOS wandelt nativ.
  - Für den Server reicht dann eine leichte JPEG/PNG-Bibliothek; `imagescript` kommt wieder in Frage.
  - Ein WebP-Decoder auf dem Server ist nicht nötig. Das macht die Angriffsfläche klein und hält den Spike einfach.
  - Liefert ein nicht konformer Client trotzdem WebP, antwortet der Server mit `unsupported`.
- **Soll der Server WebP doch dekodieren:**
  - Infrage kommen `magick-wasm` oder ein reiner WebP-Decoder als zweite Abhängigkeit.
  - Bei `magick-wasm` das Format beim Lesen ausdrücklich angeben, keine automatische Erkennung (Coder wie MSL, MVG, SVG, TEXT). Magic Bytes prüft die Function selbst.
  - Dazu `ResourceLimits` (width, height, area, memory) setzen und die Bundle-Größe gegen die 20 MB prüfen.
- **In jedem Fall:**
  - Vor dem Entfernen des ICC-Profils nach sRGB umrechnen bzw. im Client über Canvas in sRGB ausgeben. iPhone-Fotos sind Display P3, sonst stimmen die Farben nicht.
  - Exakte Version, `deno.lock` mit Integrity und Begründung im ADR (CLAUDE.md).
- **HEIC:** Nach Plan 2.1 lehnt die Function es über die Magic Bytes ab (`ftypheic`/`ftypheix`/`ftypmif1` bei Offset 4). Den Test dafür in 3.3 ergänzen.
- Die Vergleichstabelle in 3.4 an die Entscheidung anpassen. Die HEIC-Spalte ist hinfällig, Entscheidungsmaßstab sind die Tests aus A11 und die Messung aus A5.

### A7. Dekompressionsbomben über die Abmessungen hinaus: mittel
Plan 3.1.3.2.

Der Header-Parser muss **alle** SOF-Marker (0xC0–0xCF außer C4, C8 und CC) und bei PNG den `IHDR` lesen. Abzulehnen sind:
- mehrere Frames (APNG, animiertes WebP, falls WebP serverseitig angenommen wird)
- progressive JPEGs mit sehr vielen Scans (CPU-DoS), also eine Obergrenze für die Zahl der SOS
- PNG mit `zTXt`/`iCCP`/`iTXt` über einer Größe X
- abgeschnittene Dateien

Als letzte Stufe greift das Plattformlimit (A5). Test: zusätzlich ein SOF2-Header mit 50 000 × 50 000 und ein PNG-`IHDR` mit 50 000 × 50 000.

### A8. Idempotenz, Nebenläufigkeit und Fehlerzustände: mittel
Plan 3.1.3.5.

Reihenfolge festlegen:
1. Ausgaben mit `upsert` schreiben.
2. `update listing_photos set processed_at … where id = $1 and processed_at is null returning *`. Bei 0 Zeilen: „schon verarbeitet“ bzw. die Zeile wurde gelöscht. Dann die eigenen Ausgaben wieder entfernen.
3. Den Eingang löschen.

Bei `corrupt`/`unsupported`/`too_large` löscht die Function den Eingang, damit der Client neu hochladen kann (es gibt kein UPDATE im Eingang). Zwei parallele Aufrufe sind damit unschädlich. Die Zustände (`uploaded`, `processed`, `failed`) und die Wiederholung im Client gehören ins ADR 011, damit iOS (I4) sie gleich umsetzt.

### A9. Kosten-DoS durch unbegrenzte Aufrufe: mittel
Anlegen und Löschen von Fotozeilen ist unbegrenzt möglich, und jede Zeile erlaubt einen Function-Aufruf mit bis zu 15 MB Download. Das Rate-Limit für Anzeigen (Plan 2.5) greift hier nicht.

Planänderung:
- Ein Tageslimit für Foto-Inserts je Konto im Children-Guard, z. B. 100 in 24 h. Der Zähler übersteht Löschungen (gleiches Muster wie `private.listing_creations`).
- Die Function verarbeitet nur Zeilen mit vorhandenem Eingang.

### A10. Verwaiste Dateien und Löschen: mittel
- Ist die Anzeige gelöscht, kann der Besitzer die Dateien nicht mehr löschen, weil `owns_editable_listing` die Anzeigenzeile braucht (`photos_storage_binding.sql:89-96`).
- Direktes `DELETE` auf `storage.objects` per SQL blockiert Supabase.

Der Web-Service löscht deshalb beim Löschen eines Entwurfs oder Fotos **zuerst** die Dateien und dann die Zeile. ADR 008 regelt den Job in M9: Eingangsdateien älter als 24 h **und** verarbeitete Dateien ohne Zeile werden gelöscht. Das ist DSGVO-relevant, denn Originale können GPS enthalten.

### A11. Die Tests belegen die Entfernung so noch nicht: hoch
Plan 3.3.

- „Keine `GPS`-Bytes“ als ASCII-Suche ist wertlos. Das GPS-IFD ist der Tag 0x8825, darin steht kein Text „GPS“.
- **Positivkontrolle:** Derselbe Parser im Test belegt vor dem Upload, dass das Fixture GPS, XMP und Kommentar wirklich enthält. Sonst besteht ein kaputtes Fixture den Test.
- **Ausgabe per Allowlist:** Für **beide** Ausgaben (Bild und Thumbnail) die JPEG-Segmente durchlaufen. Erlaubt sind nur SOI, APP0 (JFIF), DQT, SOF0/SOF2, DHT, DRI, SOS und EOI. Kein APP1–APP15, kein COM, nach EOI kein Byte mehr.
- Zusätzlich die Rational-Bytes der Fixture-Koordinaten, den XMP-Namespace, den Kommentartext und die ZIP-Signatur `PK\x03\x04` in der Ausgabe suchen.
- Negativfälle:
  - eine Datei mit `Content-Type: image/jpeg`, die in Wahrheit SVG/HTML oder HEIC ist → `unsupported`
  - WebP direkt an den Server → je nach A6 `unsupported` bzw. ohne Metadaten
- Fixtures ohne neue Abhängigkeit: Die Pixel als nicht-quadratisches JPEG per Chromium-Canvas (Playwright) erzeugen oder eine selbst erzeugte Minimaldatei als Konstante einchecken, Segmente dann programmatisch einfügen.
- E2E: Ein WebP mit `EXIF`-Chunk geht durch die Umwandlung im Client und den Server. Belegt wird das Ergebnis, nicht der Zwischenstand.
- Der E2E-Fall „öffentlich ausgelieferte Datei“ braucht eine freigegebene Anzeige. Die Freigabe erfolgt **nur im globalSetup** (lokale DB bzw. Fixture-Service-Key wie heute in `web/integration/context.ts`), nie im Test selbst.

### A12. Plattformparität und Function-Konfiguration: niedrig
- ADR 011 als Vertrag für I4: Reihenfolge, Limits, Fehlercodes, Wiederholung, Zustände, Umwandlung im Client.
- Im CHANGELOG die iOS-Lücke mit Verweis auf diesen Vertrag. Der Plan nennt dafür zweimal **I2** (Abschnitt 1 „Nicht drin“ und Abschnitt 8). Richtig ist **I4** (SPEC 6).
- `verify_jwt = true` für die Function in `config.toml`. In der Function `getUser()` statt nur `getClaims()`, weil gesperrte oder gelöschte Konten erkannt werden müssen.
- CORS auf `SITE_URL` je Umgebung; iOS braucht kein CORS.

---

## B. Pflichtpunkt B: Standortverfremdung (Plan Abschnitt 4)

Entscheidung 1: Das Web sendet in M3 keinen Punkt. Die API nimmt `display_location` aber weiter an (Spalten-GRANT), und iOS bzw. Angreifer können es setzen. Alle Punkte unten gelten deshalb schon in M3.

### B0. Bewertung des Verfahrens
`(owner_id, region_id)` plus 1-km-Raster ist **richtig gewählt**, ich stimme der Empfehlung zu.

- **Gegen `(owner_id, Zelle)`:** Ein Revier von 5–20 km² erstreckt sich über mehrere Zellen, und Besitzer klicken je Anzeige anders. Jede neue Zelle liefert einen unabhängigen Versatz. Das Mittel nähert sich dem Revier mit etwa 4 km/√n, bei 4 Anzeigen also rund 2 km. Das ist genau das Problem aus M1-Punkt 10.
- **Bei `(owner_id, region_id)`:** Der Unterschied `o_i − o_j = c_i − c_j` verrät nur Form, keinen Ort. Das Chat-Leck aus Plan 4.2 ist der richtige Preis dafür.
- **ADR 006** sagt heute noch „Besitzer + gerundeter Punkt“ (`006-standortverfremdung.md:23`) und muss ausdrücklich überarbeitet werden, mit Begründung gegen die Zellen-Variante.

Restrisiken, die im ADR fehlen:
- **Mehrere Konten** eines Besitzers ergeben unabhängige Versätze. Das ist irrelevant, weil der Besitzer die Lage kennt.
- **Revier über eine Kreisgrenze:** Wechselt die Kreiswahl zwischen den Anzeigen, entstehen zwei Stichproben.
- **Kreiswechsel** einer bestehenden Anzeige, siehe B3.

### B1. Orakel über Dritte, die `display_location` setzen dürfen (Admins): hoch
`review_medium.sql:124` (`content_changed and not is_admin` lässt Inhaltsänderungen durch Admins zu).

Wer den Punkt einer fremden Anzeige setzen darf, schickt ein bekanntes `p`, liest `o` und kennt damit den Versatz `v` des Besitzers im Kreis. Mit `c = o − v` hat er die **Zellen aller anderen Anzeigen** dieses Besitzers im Kreis. Für Admins ist das ein vollständiges Orakel, und es zerstört nebenbei den Punkt. Der Plan nennt in 5.1 selbst „Admin-Korrektur“ als möglichen Weg.

Planänderung: Im Guard gilt „`display_location` ändert nur der Besitzer“, das heißt bei `is distinct from` und `not is_owner` → `42501`, auch für Admins. Die Moderation entfernt einen Punkt höchstens (`null`), das muss erlaubt bleiben. Dazu ein pgTAP-Test.

### B2. Die Ableitungsfunktion darf nie aufrufbar sein: hoch
Lagert der Plan die HMAC-Ableitung in eine Hilfsfunktion aus (etwa `private.location_offset(owner, region)`), ist ein EXECUTE-Recht für `authenticated` oder ein `public`-Wrapper ein direktes Orakel für jeden Besitzer.

Planänderung:
- Die Ableitung steht nur in der Trigger-Funktion. Eine Hilfsfunktion bekommt `revoke … from public, anon, authenticated, service_role`.
- `00_meta` bekommt eine zweite Allowlist für Funktionen in `private`, die für `anon`/`authenticated` ausführbar sind (heute prüft `00_meta.test.sql:30-37` nur `public`).
- Die neue RPC `listing_content_hints` kommt in die `public`-Allowlist (F4).
- Test 8 prüft `has_function_privilege` für **jede** neue Funktion.

### B3. Kreiswechsel: alter Punkt mit altem Schlüssel und zweite Stichprobe: mittel
Der Trigger feuert nur bei `update of display_location` (`listings.sql:250-252`).

Bei einer Änderung nur von `region_id` bleibt der alte Punkt stehen, berechnet mit dem alten Schlüssel und ohne Plausibilitätsprüfung gegen den neuen Kreis. Schickt der Client denselben Punkt mit, entsteht `o2 = c + v2` neben dem öffentlich schon gesehenen `o1 = c + v1`. Ein Crawler schneidet dann zwei Ringe und grenzt die Lage stark ein.

Planänderung:
- Trigger auf `update of display_location, region_id`.
- Bei einem Kreiswechsel ohne neuen Punkt wird `display_location` auf `null` gesetzt.
- Restrisiko „Kreiswechsel mit Punkt“ im ADR festhalten.

### B4. Rechenfehler bei den Ringgrenzen: mittel (Test wäre instabil)
Plan 4.3 Test 2 und Integration.

Die halbe Zellendiagonale ist 707,1 m. Damit gilt `|o − p| ∈ [3000 − 707,1; 5000 + 707,1] = [2292,9; 5707,1] m`. **Die Grenzen 2,3–5,7 km sind zu eng.** Ein Punkt nahe der Zellenecke fällt durch.

Dazu kommen:
- Die Längenverzerrung der LAEA (EPSG:3035) im Zielgebiet beträgt bis etwa 0,3 %.
- Der Unterschied zwischen geodätischem `ST_Project` und projizierten Metern.

Planänderung:
- Grenzen [2,28; 5,72] km.
- Besser die eigentliche Eigenschaft prüfen: Der Test berechnet `c` selbst (Snap in 3035) und belegt `ST_Distance(o, c) ∈ [3000; 5000] ± 1 m`. Der **Vektor `o_i − c_i` ist für alle Anzeigen identisch** (± 0,5 m, gemessen in 3035). Erst das belegt „konvergiert nicht“.
- Den Mittelwert in EPSG:3035 bilden, nicht in Grad.
- Die Richtung im Code mit `radians()` angeben (`ST_Project` erwartet Radiant, siehe `listings.sql:242`). Plan 4.1 spricht von Grad.

### B5. Weitere Testlücken: mittel
- Test 1: Die zwei Punkte müssen nachweislich in **derselben Zelle** liegen; der Test berechnet die Zelle. Zusätzlich gehört ein Test dazu: 10 m Abstand über eine Zellgrenze ergeben einen Ausgabeabstand von genau 1 km. Das ist beabsichtigt und muss im ADR stehen, denn „kleine Klickunterschiede ergeben denselben Punkt“ stimmt nur meistens.
- Test 6: `p` muss mindestens 2 km vom Kreis-Centroid und von Seed-Punkten entfernt sein, sonst schlägt der Test falsch an (`regions.centroid`). Der Test durchsucht alle Schemas mit Geo-Spalten (`information_schema.columns` mit `udt_name in ('geography','geometry')`).
- Neu: Wird der gelesene Wert unverändert zurückgeschickt, bleibt der Punkt gleich. Grund: Der Kurzschluss im Trigger greift nur bei exakter Gleichheit; nach einem Rundweg mit Rundung würde `o` als `p` behandelt und erneut verschoben. Der Web-Service sendet `display_location` in M3 gar nicht (Entscheidung 1). iOS bekommt diese Regel über ADR 006.
- Neu (B1): Ein Admin setzt einen Punkt → `42501`.

### B6. Secret: Restore, Fingerprint, Kompromittierung: mittel
- **Anlage per Migration** mit `vault.create_secret(encode(extensions.gen_random_bytes(32),'hex'), 'listing_location_key')`, wenn es fehlt. Das ist in Ordnung: Der Wert entsteht in SQL, steht nicht als Literal in der Migration und nicht im Repo, und jede Umgebung bekommt ihren eigenen. Der Wert darf nirgends per `raise notice` ausgegeben werden.
- **Gefahr „wenn es fehlt“:** Bei einem Restore oder Dump in ein *anderes* Projekt (`pg_dump`, `supabase db dump`, neues Stage-Projekt) ist das Vault-Secret nicht entschlüsselbar oder fehlt. Die Migration legt dann **still ein neues** an, und alle Punkte springen beim nächsten Update.
  Planänderung: Einen Fingerprint ablegen (`app_settings.listing_location_key_fp` = HMAC(secret, 'fingerprint')). Der Trigger prüft ihn und bricht ab, wenn er nicht passt (fail closed, eigener Code z. B. `RV003`). Für Stage und Prod gibt es ein Runbook: Das Secret wird einmalig offline hinterlegt und beim Umzug importiert (Cloud-Checkliste in ADR 002/010).
- **Supabase-Backups** im *selben* Projekt enthalten das Secret verschlüsselt, der Schlüssel liegt außerhalb der DB. Die Wiederherstellung einmal real testen (SPEC 8).
- **„Nie rotieren“** akzeptiere ich. Es fehlt ein Plan für den Ernstfall: Wird das Secret bekannt, liegen alle Zellen offen (1 km). Das ist ein Datenschutzvorfall, denn die Revierlage privater Pächter ist personenbezogen; Art. 33 DSGVO prüfen. Die Folge ist eine Rotation mit Sprung. Im ADR festhalten.
- HMAC-Kodierung festlegen: `extensions.hmac(convert_to(owner_id::text || ':' || region_id::text, 'UTF8'), decode(secret, 'hex'), 'sha256')`. Bytes über `get_byte`, als vorzeichenlose Zahl lesen.

### B7. Logging-Nachweis (M1-Punkt 10) fehlt weiterhin: mittel
Plan 4.2 „wie ADR 006“ reicht nicht, denn der M1-Punkt verlangt einen **Nachweis**. PostgreSQL protokolliert bei `log_min_duration_statement` die Bind-Parameter vollständig (`log_parameter_max_length` = -1 ist der Standard).

Planänderung: Eine Checkliste in ADR 006 mit diesen Punkten:
- `log_statement`, `log_min_duration_statement`, `log_parameter_max_length(_on_error)` und `auto_explain` in Cloud prüfen
- Supabase-API- und Edge-Logs speichern keine Bodies
- Server Actions protokollieren kein Payload (ab der Kartenauswahl läuft `p` durch den Next.js-Server)
- die Fehlermeldung der Plausibilitätsprüfung enthält keine Koordinaten

Die Cloud-Punkte werden bei der Stage-Einrichtung abgehakt.

### B8. Plausibilitätsradius 60 km: niedrig
Große, längliche Kreise wie Mecklenburgische Seenplatte (5 470 km²) oder Bezirk Liezen (3 270 km²) reichen am Rand an 60 km heran oder darüber. Empfehlung: einen Radius je Kreis beim Datenimport aus den amtlichen Polygonen berechnen und speichern, nur die Zahl, keine Polygone (ADR 007). Andernfalls 80 km. Der Test nimmt dann 120 km.

### B9. Hinweis: `content_changed` sieht den Rohpunkt: niedrig
Der Guard läuft vor dem Blur-Trigger und vergleicht den Roh-`p` mit dem gespeicherten `o` (`review_medium.sql:82-87`). Jedes PATCH mit `display_location` zählt deshalb als Inhaltsänderung, auch bei gleichem `p`. Das ist sicher und passt zu Entscheidung 4, sollte aber im ADR stehen.

---

## C. Status nie selbst `active` (Plan Abschnitt 5)

Gegen den tatsächlichen `listings_guard` (`review_medium.sql:38-137`) geprüft: Die Tabelle 5.1 ist inhaltlich richtig. Für den direkten Weg über PostgREST finde ich keinen Pfad zu `active` außer `paused>active`. Es fehlen aber Zeilen und Begründungen, und zwei geplante Erweiterungen des Guards sind fehlerhaft. Zum Hash siehe F1.

### C1. Legal-Gate im Guard: Rechtefehler statt `RV001`: hoch
`legal_consent_error.sql:22-23` (EXECUTE nur für `service_role`), `review_medium.sql:38-42` (Guard ist **security invoker**).

Ruft der Guard `private.require_current_legal()` als `authenticated` auf, bekommt der Client `42501 permission denied for function`, nicht `RV001`. Die Signalisierung aus ADR 010 läuft dann ins Leere.

Planänderung:
- Entweder `grant execute … to authenticated` (unschädlich, die Funktion wirft nur) oder im Guard inline `if not private.has_accepted_current_legal() then raise … errcode 'RV001'`. `has_accepted_current_legal` hat das Recht schon (`legal_acceptances.sql:70`).
- Der Aufruf steht **nach** `if private.is_server() then return new` (der Server hat keine `auth.uid()`).
- Kein Gate beim **DELETE** (Children-Guard) und keins bei `pending_review>draft` oder `active>paused`. Sichtbarkeit verringern, Entwürfe löschen und das Konto löschen muss ohne neue Zustimmung möglich sein.
- pgTAP prüft genau den Code `RV001` für Insert, Inhaltsänderung, `draft>pending_review` und `paused>active` sowie das Fehlen des Gates bei Delete und Pause.

### C2. Prüfung der Pflichtfelder wird bei automatischen Übergängen übersprungen: hoch
- **Weg 1:** Der Children-Guard ist `security definer` und ändert `listings` (`photos_storage_binding.sql:56`). Im verschachtelten Guard ist `current_user = postgres`, also `is_server()` = true (`listings.sql:86-93`). Der Guard kehrt sofort zurück: keine Pflichtfelder, kein Foto-Check, kein Legal-Gate.
- **Weg 2:** Eine Inhaltsänderung an `active`/`paused` setzt den Status erst am Ende des Guards auf `pending_review` (`review_medium.sql:129-131`). Eine Prüfung, die nur am expliziten Übergang `draft>pending_review` hängt, greift dort nicht.

Planänderung:
- Die Pflichtfeldprüfung steht am **Ende** des Guards auf dem endgültigen `new.status` (`= 'pending_review'` und `old.status <> 'pending_review' or content_changed`), für Aufrufer, die nicht der Server sind.
- **Maßgeblich** ist die Prüfung beim Admin-Übergang `pending_review>active` (A1). Sie schließt alle Wege, auch Weg 1 und künftige Server-Pfade.
- Folge für die UX: Bearbeitet ein Nutzer eine aktive Anzeige schrittweise, darf kein Zwischenzustand ungültig sein, sonst kommt `23514`. Der Assistent speichert bei aktiven und pausierten Anzeigen deshalb erst bei „Absenden“ gesammelt. Das in Plan 7 festlegen; Entscheidung 4 verlangt das ohnehin, weil jeder Zwischenschritt die Anzeige aus der Öffentlichkeit nimmt.

### C3. Rate-Limit `RV002`: Zähltabelle ist richtig, die Details fehlen: mittel
Plan 2.5 (neu), Entscheidung 5.

Die Zähltabelle `private.listing_creations` gegen Löschen und Neuanlegen löst meinen Hauptpunkt. Es fehlen noch:
- **Nebenläufigkeit:** `pg_advisory_xact_lock(hashtextextended(owner_id::text, 0))` vor dem Zählen, sonst überschreiten parallele Inserts das Limit.
- **Rechte:** Der Guard ist Invoker, liest aber `auth.users.created_at` und schreibt `private.listing_creations`. Beides braucht eine `security definer`-Hilfsfunktion (`search_path = ''`, kein EXECUTE für `anon`). Alternativ `profiles.created_at` statt `auth.users`.
- **Tabelle:**
  - RLS aktivieren (Konvention, auch in `private`)
  - FK auf `auth.users` mit `on delete cascade`, damit die Account-Löschung (M9) sie mitnimmt
  - Index `(owner_id, created_at)`
  - Einträge nach z. B. 7 Tagen löschen, ADR 008 ergänzen
- **Reihenfolge:** Legal → Rate-Limit. Ein Insert, der später scheitert, rollt den Zähler mit zurück. Das ist in Ordnung.
- **Restrisiko:** Mehrere Konten umgehen das Limit; der Schutz vor Massenanmeldung liegt beim Captcha-ADR (Review M2 Punkt 5). Im ADR 010 vermerken.
- **Tests:**
  - 3 Anzeigen bei neuem Konto, die 4. → `RV002`
  - Konto älter als 7 Tage (`created_at` im Setup als `postgres` zurückdatiert): 10, dann das 11. → `RV002`
  - Alle löschen, dann erneut anlegen → weiter `RV002`
  - Zwei parallele Sitzungen im Integrationstest

### C4. Fehlende Zeilen in Tabelle 5.1: mittel
| Weg | Sperre | Ergebnis |
|---|---|---|
| Delete + Reinsert | Insert nur `draft`/`pending_review`. `id` steht nicht im INSERT-GRANT (`listings.sql:350-352`), eine Wiederverwendung der ID ist also unmöglich | kein `active`; Rate-Limit zählt mit (C3) |
| Upsert über `id` (PostgREST `on_conflict=id`, `merge-duplicates`) | Spaltenrecht auf `id` fehlt | `42501` (Test erwartet genau das; die Zeile „Upsert“ in 5.1 begründet es heute falsch über den Guard) |
| `security definer`-Funktionen, die `listings` ändern | laufen als `postgres`, `is_server()` = true, **Guard wird komplett übersprungen** | heute nur der Children-Guard, der nur `pending_review` setzt. Meta-Test: Allowlist der Funktionen, deren `prosrc` `update public.listings` enthält |
| `service_role` (Edge Function) | Guard wird übersprungen | Function schreibt `listings` nur nach A1 (nur `pending_review`); Zeile „Edge Function oder RPC“ in 5.1 entsprechend ändern |
| Admin über Claims | `is_admin()` = `user_roles` **und** `aal2` (`foundation.sql:72-84`); `app_role` im Token ist nur UI | Tests: Claims `{"app_role":"admin","aal":"aal2"}` ohne `user_roles`-Zeile → `42501`; echter Admin mit `aal1` → `42501` |
| `is_server_caller()`-Missbrauch | liest `current_setting('role')`, das PostgREST per `SET LOCAL ROLE` setzt. Ohne SQL-Zugang nicht änderbar; `authenticated` hat keine Mitgliedschaft in `service_role` | Test: `set role service_role` als `authenticated` → Fehler |
| Trigger-Reihenfolge | BEFORE-Trigger laufen alphabetisch; `listings_guard` < `listings_zz_blur_location`. Neue Trigger dürfen `status` nicht ändern | Meta-Test: nur `listings_guard` setzt `new.status` (prosrc-Suche), Trigger-Namen fest |
| `approved_content_hash` selbst setzen | Spalte nicht im UPDATE-/INSERT-GRANT, Guard überschreibt | `42501` (F1) |
| pg_graphql (falls aktiv) | gleiche Rollen, RLS und Trigger | kein Sonderweg; in `config.toml` prüfen und sonst deaktivieren |

### C5. Tests zu Abschnitt 5: niedrig
- Die Statusschleife zusätzlich durchlaufen lassen:
  - **mit gleichzeitiger Inhaltsänderung**
  - **als Admin-Besitzer** (Vier-Augen-Prinzip, je Zustand)
  - als Admin mit `aal1`
- Ausgangszustände im Setup als `postgres` herstellen und das im Test kommentieren.
- Meta-Test für `content_changed`: Die Spalten des UPDATE-GRANTs ohne `status` und `reject_reason` müssen der Zeilenliste im Guard entsprechen. Wer eine neue Inhaltsspalte vergisst, soll einen roten Test bekommen. Heute hängt das an einer manuellen Liste (`review_medium.sql:82-87`).
- Die geplante Feldliste zu Entscheidung 4 (5.2) ist gut. Ergänzen: `attributes`, `kind`/`direction`, Sprache, Zeitraum und Wildarten (neu, gelöscht). Erst dann ist „jede Änderung“ belegt.

---

## D. Weitere Punkte

### D1. Pflichtfelder in DB und Zod: mittel
Plan 2.4/2.6 und 6 (neue Tabelle).

Die Tabelle ist schlüssig und setzt Entscheidung 3 um. Anmerkungen:

- **`legal_ack` bei Trophäen-Gesuchen:** Fachlich befürworte ich es. Der Hinweis auf Einfuhr-, Trophäen- und Waffenrecht betrifft gerade den Suchenden. Das bleibt aber eine Bestätigung durch den Nutzer und eine Frage an den Anwalt (SPEC 7.2).
- **Wildarten doppelt geführt:** `trophy_hunt.species_targeted[]` (Attribut) und `listing_species` (Tabelle, Filter in SPEC 4.3) sind zwei Quellen. Empfehlung: Für `trophy_hunt` gilt „Wildarten (≥ 1)“ über `listing_species`, und `species_targeted` entfällt bzw. wird nicht separat gepflegt. Sonst findet der Wildartenfilter in M5 Trophäenanzeigen nicht. SPEC 3.2 in v0.5 entsprechend anpassen.
- **Quelle der Wahrheit:** Die DB ist die einzige Quelle, Zod spiegelt sie nur.
  - Gegen Abweichungen: Fixture-Dateien mit gültigen und ungültigen Anzeigen je Art und Richtung, z. B. unter `supabase/tests/fixtures/listings/*.json`. Das sind Testdaten, kein geteilter Code. Ein Integrationstest schickt jede Fixture durch Zod **und** die DB und erwartet dasselbe Ergebnis. iOS (I4) nutzt dieselben Fixtures.
  - Der Satz „Die Regeln stehen an einer Stelle in der DB-Funktion und im Zod-Schema“ beschreibt zwei Stellen. Die Fixtures machen daraus eine geprüfte Regel.
- **`hint`:** maschinenlesbar und stabil, z. B. `fields=title,attributes.lease_type,species`, als Vertrag in ADR 010/011.
- **Attribut-Check:**
  - Enum-Werte, Längen je Textfeld (`shooting_plan`, `meeting_point_description`, `season`, `species_limits`, `import_export_note`), Höchstlänge der Arrays, Ganzzahlen nicht negativ
  - Ein Wechsel von `kind` verlangt im selben Statement passende `attributes`. Der Web-Service setzt sie dann zurück.
- **`event_date` vs. `start_date`:** abgrenzen, bei `driven_hunt` redundant. „Nicht in der Vergangenheit“ ist zeitabhängig und deshalb kein CHECK, nur Teil der Prüfung beim Absenden und bei der Freigabe.

### D2. Reihenfolge Trigger und RLS, stille 0-Zeilen-Updates: mittel
- INSERT: BEFORE-Trigger laufen **vor** `WITH CHECK`. `RV001`/`RV002` aus dem Guard kommen also vor dem `42501` der Policy an. Die Policy-Bedingung ist richtig als zweite Stufe in der Initplan-Form.
- UPDATE und DELETE: `USING` filtert **vorher**. Scheitert es, gibt es **0 Zeilen ohne Fehler**, zum Beispiel bei einem gesperrten Konto (`listings_update_own` mit `is_active_user`). Deshalb gehört das Legal-Gate nie in `USING`; im Plan ist das richtig.
- Der Web-Service muss jedes Update und Delete mit `.select()` ausführen und 0 Zeilen als Fehler behandeln (CLAUDE.md: nie stumm schlucken). Ein Vitest für die Service-Schicht kommt dazu.

### D3. Preisgrenzen: niedrig
- `100_000_000_00` (10¹⁰ Minor-Einheiten) funktioniert syntaktisch (PG 17, `config.toml:43`) und liegt unter 2⁵³ (JS).
- Das Review M2 verlangte aber Grenzen **je Währung**, und 100 Mio. EUR ist keine Plausibilitätsgrenze.
- Vorschlag:
  - EUR/CHF ≤ 10⁹ Minor (10 Mio.)
  - CZK ≤ 2,5·10¹⁰
  - PLN ≤ 5·10⁹
  - als CHECK mit `case currency`
- Die Untergrenze `0` bei Beträgen bewusst erlauben oder verbieten.
- Die Umrechnung per Vitest prüfen: Komma/Punkt je Locale, Tausendertrenner, mehr als 2 Nachkommastellen ablehnen, negative Werte.

### D4. Commit-Reihenfolge: mittel
- Der Guard wird in Commit 6 mehrfach neu geschrieben (Pflichtfelder, Legal, Rate-Limit, Hash, A1, B1, C2). Besser ist **eine** Migration, die den Guard einmal neu fasst und die Teilprüfungen in benannte Hilfsfunktionen auslagert. Sonst droht Kopier-Drift wie zwischen `listings.sql` und `review_medium.sql`.
- B1 (Punkt nur durch den Besitzer) gehört in Commit 3, A1 und A2 in Commit 4/6.
- Commit 4 entzieht `authenticated` das INSERT in `listing-photos`. Bestehende Integrationstests und Fixtures (`web/integration/storage.test.ts`, `paths.draftPhotoA`) und `08_storage` müssen **im selben Commit** angepasst werden, sonst ist er nicht grün.
- `alt_text` (Plan 2.7) und `listing_content_hints` (Plan 2.8) fehlen in der Commit-Liste. Vorschlag: `alt_text` mit Commit 4, die Begriffs-RPC als eigener Commit nach 6.
- Die Tabelle in Abschnitt 6 bestätigt der Nutzer noch. Die Commits 6 bis 12 hängen daran, die Commits 1 bis 5 nicht. Bis zur Bestätigung also nur 1 bis 5.
- Der Spike (Commit 1) endet mit dem Hinweis „gehostet noch zu messen“ (A5).

### D5. CI: mittel
- In `.github/workflows/web.yml:88` `edge-runtime` aus `-x` entfernen. `imgproxy` bleibt ausgeschlossen, solange der A5-Ausweg (a) nicht gewählt ist.
- Function-Secrets lokal über die Standardwerte der CLI bzw. eine nicht eingecheckte `supabase/functions/.env`. Der Grep-Check auf Keys gilt auch für `supabase/functions/`.
- Ein eigener Schritt für `deno check`/`deno lint`/`deno test` mit `deno.lock` und gepinnter Deno-Version (gleiche Version wie die Edge Runtime).
- Vor den Integrationstests einmal aufwärmen, damit der Kaltstart nicht in die Timeouts fällt.

### D6. Aufbewahrung von Entwürfen: niedrig
Entwürfe und ihre Fotos bleiben bisher unbegrenzt liegen (Datensparsamkeit). ADR 008 sollte einen Standardwert festhalten, etwa Löschung nach 12 Monaten Inaktivität mit Hinweis vorab (Umsetzung M9).

---

## F. Ergänzungen nach den Entscheidungen des Nutzers

### F1. `approved_content_hash` (Plan 5.1, Entscheidung 4): mittel
Als zweite Sicherung ist er sinnvoll, er ersetzt aber weder A1 noch C2. Festzulegen:
- **Wer setzt:** Ausschließlich der Guard beim Admin-Übergang `pending_review>active`. Die Spalte steht weder im INSERT- noch im UPDATE-GRANT. Bei Inserts, die nicht vom Server kommen, wird sie `null`.
- **Wo:**
  - Als Spalte in `listings` ist sie über `grant select on public.listings to anon` öffentlich lesbar (`listings.sql:349`). Das ist unnötig: Für pausierte und andere nicht öffentliche Anzeigen lässt sich damit prüfen, ob ein vermuteter Inhalt zutrifft.
  - Besser in `private.listing_approvals(listing_id, content_hash, approved_at, approved_by)`. Das ist zugleich eine Nachweisspur für die Moderation (DSA) neben dem Audit-Log.
- **Was:** Es braucht eine kanonische Form, sonst ist der Hash nicht stabil.
  - `sha256` über ein `jsonb_build_object` aller Inhaltsspalten (dieselbe Liste wie `content_changed`, siehe C5-Meta-Test)
  - Wildarten per `jsonb_agg(... order by species_code)`
  - Fotos per `jsonb_agg(jsonb_build_object('id', id, 'sort', sort_order, 'alt', alt_text, 'processed_at', processed_at) order by sort_order)`
  - `processed_at` gehört hinein, damit eine erneute Verarbeitung nach der Freigabe als Änderung zählt (A1).
- **Prüfung:** Sie läuft bei `paused>active` im Guard. Der Guard ist Invoker und darf die private Tabelle nicht lesen, also über eine Definer-Hilfsfunktion.
  - Bei Abweichung wird der Status `pending_review`, wie geplant. Kein `42501`, damit der Client einen klaren Zustand bekommt.
  - Gibt es keinen gespeicherten Hash (Altbestand), gilt fail closed: `pending_review`.
- **Test:** Neben „Inhalt als Server geändert“ auch „Foto als Server neu verarbeitet“ und „Wildart als Server ergänzt“ → `pending_review`.

### F2. `alt_text` (Plan 2.7, Entscheidung 8): niedrig
- Spalten-GRANT für INSERT und UPDATE (A2). Der Children-Guard schickt eine Änderung an aktiven Anzeigen zurück in die Prüfung; das steht in 5.2 und ist richtig.
- Es ist UGC: Ausgabe nur escaped (Review M2 Punkt 4, ESLint-Regel). CHECK: 1–200 Zeichen nach `btrim`, keine Steuerzeichen.
- Der Text geht in den Begriffsabgleich (F3) und in die Moderationsansicht (M4).
- Der Fallback „{Titel}, Foto n von m“ wird übersetzt (Message-Dateien bzw. String Catalog), nicht in der DB gespeichert.

### F3. `listing_content_hints` und `private.content_terms` (Plan 2.8, Entscheidung 6): mittel
- **RPC-Rechte:** `security definer`, `search_path = ''`, nur `authenticated`. Die RPC kommt in die Allowlist in `00_meta.test.sql:35`.
  - Für fremde und unbekannte IDs gibt es **dieselbe Antwort** (z. B. leeres Ergebnis oder einheitlich `42501`). Sonst entsteht ein Existenzorakel für Entwürfe.
  - Gesperrte Konten (`is_active_user`) bekommen keine Antwort.
- **Tabelle:** `private.content_terms` mit RLS, ohne Rechte für API-Rollen (`00_meta` prüft das schon). Pflege per Migration oder später per Admin-UI (M4) mit Audit.
- **Abgleich:**
  - Über Titel, Beschreibung, Text-Attribute und Alt-Texte, in **allen vier** Sprachlisten, nicht nur in der Sprache der Anzeige (gemischte Texte, falsche Sprachwahl).
  - Normalisieren mit `lower` und gegebenenfalls `unaccent` (neue Extension, begründen) und auf Wortgrenzen achten. Für Flexion in cs/pl genügen Wortstämme mit Präfix-Suche.
  - Falsch-Positive sind in Jagdtexten häufig (z. B. „Kaliber“, „Büchse“ bei Begehungsscheinen). Deshalb ist „Hinweis statt Sperre“ richtig.
- **Restrisiko:** Durch Probieren eigener Entwürfe lässt sich die Liste ermitteln und umgehen. Das ist bei einem Hinweis akzeptabel. Der M4-Abgleich sollte sich darauf nicht allein verlassen (Moderation sieht alles), im ADR vermerken.
- **Kosten:** Mit dem Rate-Limit der RPC-Aufrufe wenig kritisch. Die Liste bleibt klein, der Text ist höchstens 5 000 Zeichen.
- **Inhalt der Liste:** Die Begriffe in cs/pl prüft ein Muttersprachler (SPEC 7.6). Die Begriffe kommen nicht von Konkurrenzseiten (CLAUDE.md).
- **Tests:**
  - pgTAP: Treffer je Sprache, kein Treffer bei harmlosem Text, gleiche Antwort für fremde und unbekannte Anzeigen
  - E2E: Hinweis sichtbar, Absenden trotzdem möglich

### F4. Rate-Limit nach Kontoalter (Entscheidung 5): niedrig
Siehe C3. Beide Grenzwerte und die 7 Tage stehen in `app_settings` und bleiben damit konfigurierbar (ADR 008/010). Die Fehlermeldung zu `RV002` nennt dem Nutzer verständlich, wann er wieder inserieren kann. Dafür liefert der `hint` den Zeitpunkt.

---

## E. Offene Fragen an den Nutzer (Plan 11)

Die Fragen 1–8 sind beantwortet und eingearbeitet. Offen ist laut Plan nur die Bestätigung der Tabelle in Abschnitt 6 einschließlich `legal_ack` bei Trophäen-Gesuchen. Das bleibt richtig. Ergänzen:

1. **`species_targeted` vs. Wildarten (D1):** Darf es für Trophäenjagden über die normale Wildartenauswahl laufen? Das ist mit der Bestätigung der Tabelle zu klären.
2. **Gehostete Messung und Kosten (A5):** Die Limits der Edge Functions lassen sich ohne Cloud-Projekt nicht belegen, und SPEC 7.1 blockiert es. Akzeptiert der Nutzer das Restrisiko bis zur Stage-Einrichtung, oder legt er jetzt ein temporäres EU-Testprojekt an? Ist ein Pro-Plan denkbar, falls die Storage-Transformationen der Ausweg sind?
3. **Aufbewahrung von Entwürfen (D6):** eine Frist für verlassene Entwürfe samt Fotos.

Nicht als Frage, aber mit Information an den Nutzer: Die Verkleinerung im Client wandelt WebP und PNG vor dem Upload nach JPEG (A5/A6). Für ihn ändert sich nichts, er kann JPEG/PNG/WebP bis 15 MB wählen.

---

## Freigabe

**Freigabe: mit Auflagen.** In der vorliegenden Fassung nicht freigabefähig wegen A1 (blockierend). Sind die Auflagen 1–8 in den Plan eingearbeitet, gilt die Freigabe ohne erneutes Review. Das Ergebnis des Spikes (Auflage 9) geht vor Commit 5 an den Architekten. Die Commits 6–12 beginnen erst nach der Bestätigung der Tabelle in Abschnitt 6 durch den Nutzer.

### Auflagen
1. **(A1, blockierend)** Der Admin-Übergang `pending_review>active` prüft `listing_ready_for_review` inklusive „keine unverarbeiteten Fotos“. Die Function setzt `active`/`paused` nach der Verarbeitung auf `pending_review`, und Plan 3.1.5 wird umgeschrieben. Beides mit pgTAP und Integrationstest.
2. **(A2)** `listing_photos`: INSERT nur auf `(listing_id, sort_order, alt_text)`, UPDATE auf `(sort_order, alt_text)`. Die Pfade leitet ein Trigger aus der `id` ab, die Serverspalten setzt nur `service_role`. Tests mit `has_column_privilege`.
3. **(A3, A4)** Die Function prüft den Besitz ausdrücklich, nicht über die Sichtbarkeit per RLS. Die Lese-Policy umfasst `thumb_path` und `processed_at is not null`. Im Eingang gibt es nur INSERT für den Besitzer und weder SELECT noch UPDATE.
4. **(A5, A6, A7)**
   - Die Verkleinerung im Client wird Vertrag für Web und iOS: ≤ 2560 px, JPEG, sRGB, Orientierung in den Pixeln. Die Dateigrenze bleibt bei 15 MB.
   - Server-Limits: ≤ 4096 px und ≤ 12 MP; Eingang JPEG (+PNG), WebP und HEIC nur als `unsupported`, es sei denn, der Spike begründet einen WebP-Decoder.
   - Format beim Lesen explizit, ResourceLimits. Header-Prüfung über alle SOF-Marker und IHDR, Grenzen für Frames und Scans.
5. **(A11)** Die Tests prüfen per Positivkontrolle und Marker-Allowlist für Bild **und** Thumbnail, die ASCII-Suche fällt weg. Dazu ein HEIC-/SVG-Negativfall. Eine Freigabe für E2E gibt es nur im globalSetup.
6. **(B1, B2, B3)** `display_location` ändert nur der Besitzer, auch kein Admin. Die Ableitung ist nicht aufrufbar, `00_meta` bekommt die Allowlist für `private`. Der Trigger feuert auch bei `region_id`, und ein Kreiswechsel ohne Punkt setzt `null`.
7. **(B4, B5)** Die Ringgrenzen werden korrigiert ([2,28; 5,72] km). Ein Test belegt den konstanten Vektor `o − c`, Mittelwerte entstehen in EPSG:3035, Testpunkte liegen nachweislich in derselben Zelle bzw. weit genug vom Centroid entfernt.
8. **(C1, C2, C3, F1)**
   - Das Legal-Gate ist für `authenticated` ausführbar oder inline und steht nach `is_server()`. Bei Delete, Pause und Zurückziehen gibt es kein Gate.
   - Die Pflichtfeldprüfung läuft auf dem endgültigen Status. Der Assistent speichert Änderungen an aktiven und pausierten Anzeigen gesammelt.
   - Rate-Limit: Advisory-Lock, Definer-Hilfsfunktion, RLS und Cascade auf `private.listing_creations`.
   - `approved_content_hash` setzt nur der Guard bei der Freigabe. Er liegt nicht öffentlich lesbar (private Tabelle), hat eine kanonische Form inklusive `processed_at` und gilt fail closed.
   - Tabelle 5.1 bekommt die Zeilen aus C4, dazu die Meta-Tests aus C4/C5.
9. **(A5)** Der Spike misst Speicher, CPU und Kaltstart bei 12 MP und 15 MB. ADR 011 hält fest, dass die gehosteten Limits bei der Stage-Einrichtung gemessen werden, und nennt die Auswege.
10. **(B6, B7)** Fingerprint des Secrets mit Abbruch bei Abweichung, ein Restore- und Escrow-Runbook und ein Ernstfallplan in ADR 006. Die Logging-Checkliste deckt Postgres-Parameter, API- und Edge-Logs und Server Actions ab.
11. **(D1, D2)** Fixtures für Pflichtfelder gemeinsam für DB und Zod, ein maschinenlesbarer `hint`. Wildarten bei `trophy_hunt` über `listing_species`, sofern der Nutzer zustimmt. Der Web-Service behandelt 0 betroffene Zeilen als Fehler.
12. **(F3)** `listing_content_hints` antwortet für fremde und unbekannte IDs gleich, steht in der `00_meta`-Allowlist, gleicht über alle Sprachen inklusive Alt-Texten ab, und `content_terms` hat keine API-Rechte.
13. **(D4, D5)** Der Guard wird in einer Migration mit Hilfsfunktionen neu gefasst, bestehende Storage-Tests werden im selben Commit angepasst, und `alt_text` sowie die Begriffs-RPC kommen in die Commit-Liste. In der CI läuft die Edge Runtime, dazu `deno check`/`deno test` mit Lockfile. Die iOS-Lücke heißt I4, nicht I2.

Nicht blockierend, im Plan vermerken: A8, A9, A10, A12, B8, B9, D3, D6, F2, F4 sowie die zusätzlichen Fragen in E.
