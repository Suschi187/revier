# ADR 006: Standortverfremdung

Status: angenommen (M1)

## Kontext
SPEC 3.3: Exakte Revierkoordinaten werden nie gespeichert. Angezeigt wird ein verfremdeter Punkt (Versatz etwa 3–5 km), der einmal bei der Erstellung festgelegt wird.

## Entscheidung
- Ein `BEFORE INSERT OR UPDATE OF display_location`-Trigger auf `listings` ersetzt den eingehenden Punkt sofort durch einen versetzten Punkt (`ST_Project` auf `geography`). Der Originalpunkt wird nicht geschrieben.
- Der Versatz (Richtung 0–360°, Distanz 3000–5000 m, als Ring statt 0–5 km) wird **einmal pro Anzeige** zufällig erzeugt und in `private.listing_location_offsets` gespeichert. Spätere Änderungen des Punkts verwenden denselben Versatz.
  Grund: Mit einem jedes Mal neuen Zufall ließe sich der echte Punkt aus vielen Updates herausmitteln.
- Ohne Punkt bleibt `display_location` NULL. Clients zeigen dann den Centroid des Landkreises.
- `attributes` darf keine Koordinaten enthalten. Ein Check verbietet die Schlüssel `lat`, `lng`, `lon`, `latitude`, `longitude`, `location` und `coordinates`.

## Alternativen
- Verfremdung im Client: Die Regel würde je Plattform doppelt gepflegt und wäre umgehbar.
- Raster-Snapping: Es ist vorhersagbar und verrät bei kleinen Rastern zu viel.

## Folgen
- Der Originalpunkt ist nur im Request kurz sichtbar. Statement-Logging darf in keiner Umgebung Parameter protokollieren (prüfen in M2/M10).
- Es gibt keine Prüfung, ob der gewählte Punkt im Landkreis liegt, weil keine Polygone gespeichert werden. Bei Bedarf kommt eine grobe Distanzprüfung zum Centroid in M3.
