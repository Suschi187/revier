# ADR 006: Standortverfremdung

Status: angenommen (M1), überarbeitet in M3 (v2: deterministischer Versatz je Besitzer und Kreis)

## Kontext
SPEC 3.3: Exakte Revierkoordinaten werden nie gespeichert. Angezeigt wird ein verfremdeter Pun## Entscheidung (v2, M3)
- Ein `BEFORE INSERT OR UPDATE OF display_location, region_id`-Trigger (`listings_zz_blur_location`, `security definer`) ersetzt den eingehenden Punkt `p` sofort. Der Eingabepunkt wird nie gespeichert.
  1. **Einrasten:** `c` = Mitte der 1-km-Rasterzelle von `p` in EPSG:3035 (LAEA Europa).
  2. **Schlüssel:** `k = HMAC-SHA256(secret, owner_id || ':' || region_id)` über `extensions.hmac`. Bytes 0–3 ergeben die Richtung (0–360°), Bytes 4–7 die Distanz (3000–5000 m), jeweils als vorzeichenlose Zahl / 2³².
  3. **Ausgabe:** `display_location = ST_Project(c, Distanz, radians(Richtung))`.
- Folge: Derselbe Besitzer bekommt im selben Kreis für jede Anzeige und jedes Update **denselben Versatzvektor**. Das Mittel beliebig vieler Anzeigen desselben Reviers ist `mittel(c_i) + Versatz` und bleibt 3–5 km neben der wahren Lage.
- `owner_id` im Schlüssel verhindert ein Orakel: Wer eigene Entwürfe an vermuteten Orten anlegt, bekommt einen anderen Versatz.
- Den Punkt setzt nur der Besitzer, auch kein Admin (sonst lernt der Setzende den Versatz und damit die Zellen aller Anzeigen des Besitzers im Kreis). Entfernen (`null`) ist für Admins erlaubt.
- Ein Kreiswechsel ohne neuen Punkt setzt `display_location` auf `null`, weil der alte Punkt mit altem Schlüssel neben dem neuen eine zweite Stichprobe wäre.
- Plausibilität ohne Polygone: `p` liegt höchstens `listing_location_max_km` (80 km) vom Centroid des Kreises, sonst `23514`. Die Meldung enthält keine Koordinaten.
- Ohne Punkt bleibt `display_location` NULL, Clients zeigen den Centroid des Kreises. Das Web sendet in M3 keinen Punkt (Kartenanbieter offen, SPEC 7.10); iOS und die API können ihn setzen, deshalb gilt alles schon in M3.
- `attributes` darf keine Koordinaten enthalten (Check auf `lat`, `lng`, `lon`, `latitude`, `longitude`, `location`, `coordinates`, `geo`, `position`).
- Für Clients (iOS, später Web mit Karte): einen gelesenen Punkt nie unverändert als neue Eingabe zurückschicken, außer exakt gleich (dann ändert sich nichts). Nach einer Rundung würde er als neuer Eingabepunkt erneut verschoben.

### Secret
- `listing_location_key` im Vault, von der Migration `20261029104000_listing_location_v2` je Umgebung zufällig angelegt (32 Byte), nie im Repo, nie ausgegeben. Lesbar nur über die Trigger-Funktion; sie ist für keine API-Rolle ausführbar (`00_meta`).
- `app_settings.listing_location_key_fp` = HMAC(secret, 'fingerprint'). Passt er nicht oder fehlt das Secret, bricht die Migration ab bzw. der Trigger antwortet mit `RV003` (fail closed). So entsteht nach einem Restore in ein anderes Projekt nicht still ein neues Secret.
- **Nie rotieren:** Die Eingaben sind nicht gespeichert; nach einer Rotation spränge jeder Punkt beim nächsten Update, und alter und neuer Punkt ließen sich vergleichen.
- **Runbook Stage/Prod:** Nach der Ersteinrichtung das Secret einmalig offline hinterlegen (Passwortmanager mit zwei Berechtigten). Bei Umzug oder Restore in ein anderes Projekt vor den Migrationen per `vault.create_secret(<hinterlegter Wert>, 'listing_location_key')` importieren und den Fingerprint vergleichen. Backups im selben Projekt enthalten das Secret verschlüsselt; die Wiederherstellung wird einmal real getestet (SPEC 8).
- **Ernstfall:** Wird das Secret bekannt, liegen die Zellen aller Anzeigen offen (1 km). Das ist ein Datenschutzvorfall (Revierlage privater Pächter ist personenbezogen), Meldepflicht nach Art. 33 DSGVO prüfen. Danach Rotation mit bewusstem Sprung aller Punkte.

### Logging-Checkliste (Review M1 Punkt 10, Cloud bei Stage-Einrichtung abhaken)
- Postgres: `log_statement` = `none` bzw. `ddl`, `log_min_duration_statement` ohne Parameter (`log_parameter_max_length` = 0, `log_parameter_max_length_on_error` = 0), `auto_explain` ohne Parameter
- Supabase-API- und Edge-Function-Logs speichern keine Request-Bodies
- Server Actions protokollieren kein Payload (ab der Kartenauswahl läuft `p` durch den Next.js-Server)
- Fehlermeldungen enthalten keine Koordinaten (Plausibilitätsprüfung, `RV003`)

t`, `lng`, `lon`, `latitude`, `longitude`, `location` und `coordinates`.

## Alternativen
- Verfremdung im Client: Die Regel würde je Plattform doppelt gepflegt und wäre umgehbar.
- Raster-Snapping: Es ist vorhersagbar und verrät bei kleinen Rastern zu viel.

## Folgen
- Der Originalpunkt ist nur im Request kurz sichtbar (Logging-Checkliste oben).
- Restrisiken:
  - Die relative Lage mehrerer Anzeigen eines Besitzers im selben Kreis bleibt erkennbar (Form, nicht Ort).
  - Teilt ein Anbieter im Chat die genaue Lage einer Anzeige, kennt der Empfänger den Versatz und damit die Zellen der anderen Anzeigen dieses Besitzers im Kreis.
  - Verschiedene Besitzer desselben Reviers (z. B. Pächter und Genossenschaft) haben unabhängige Versätze; ebenso ein Revier über eine Kreisgrenze, wenn die Kreiswahl wechselt. Das sind wenige Stichproben.
  - Zwei Punkte wenige Meter auseinander über eine Zellgrenze ergeben Ausgaben 1 km auseinander (beabsichtigt).
  - Der Guard sieht den Rohpunkt: Jedes Update mit `display_location` zählt als Inhaltsänderung und führt eine freigegebene Anzeige zurück in die Prüfung, auch bei gleichem Punkt.
- Verworfen wurde der Schlüssel `(owner_id, Zelle)`: Ein Revier über mehrere Zellen bekäme unabhängige Versätze, deren Mittel sich dem Revier mit etwa 4 km/√n nähert (Review Plan M3, B0).
- Tests: pgTAP `12_location` (Zelle, konstanter Versatz, Mittelwert, Streuung, kein Orakel, Speicherorte, Plausibilität, Kreiswechsel, Admin, Rechte, Fingerprint), `04_listings`.
