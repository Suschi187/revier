# Architekt-Nachprüfung: Plan M3, Ort mit PLZ (Abschnitt 6.1, 13.1, Commit 7a)

Datum: 2026-10-29. Stand Repo: `dcef6bd`. Geprüft habe ich `M3-plan.md` (6, 6.1, 9, 12, 13.1) gegen CLAUDE.md, ADR 005, 006, 007 und 008, das Review `M3-plan-review.md` sowie die Migrationen `…100000_foundation.sql` (`is_admin` mit aal2, nur Rolle `admin`), `…100200_regions_species.sql` (`regions.code` wie `DE-09162`/`AT-901`), `…100400_listings.sql` (`search_vector`, `grant select … to anon`) und `…100700_trust_audit.sql` (`audit_log.details`). Ich hatte nur Lesezugriff und habe nichts ausgeführt.

Kurzurteil: Die Grundentscheidung ist richtig: eigene Tabelle `listing_places`, nicht in `listings`, und `postal_codes` als Referenzdaten. Es fehlen aber vier Dinge. Erstens ein atomarer Weg für „Kreis und PLZ zusammen ändern“, sonst blockieren sich Guard und Pflichtprüfung gegenseitig. Zweitens eine verbindliche Sperre gegen spätere Such-Orakel über `listing_places`. Drittens die Begründung, warum ODbL hier tragbar ist, obwohl ADR 007 OSM genau wegen Share-Alike verworfen hat. Viertens die Klärung, was „Ort“ bei Gesuchen bedeutet. Commit 7a steht an der falschen Stelle.

---

## A. Datenschutz und Standortschutz

### 1. Trennung, RLS und Rechte von `listing_places` festschreiben (hoch)
Die Trennung ist nötig. `anon` hat SELECT auf `listings` (`listings.sql`), eine Spalte dort wäre also öffentlich. Planänderung, ausdrücklich in 6.1 und ADR 012:
- Tabelle `public.listing_places (listing_id uuid primary key references public.listings(id) on delete cascade, country, postal_code, place_name, updated_at)`, also 1:1 zur Anzeige.
- RLS aktiv. SELECT gibt es für den Besitzer (`owner_id = (select auth.uid())` über die Anzeige, Initplan-Form) und für `(select private.is_admin())`. Das ist die Funktion mit aal2, **nicht** `has_admin_role()`, die aal2 nicht prüft. Eine Rolle „Moderation“ gibt es heute nicht (`app_role` kennt nur `admin`). Kommt sie in M4, wird sie hier ausdrücklich ergänzt.
- INSERT und UPDATE nur für den Besitzer mit `owns_editable_listing` und `is_active_user`, mit Spalten-GRANT auf `(listing_id, postal_code, place_name)` bzw. `(postal_code, place_name)`. `country` übernimmt ein Trigger aus der Anzeige. Admins schreiben nicht, sie lesen nur.
- `authenticated` bekommt kein DELETE: Die Zeile ist Pflicht, und gelöscht wird nur per Cascade mit der Anzeige. Dadurch entfällt auch der Fall „Ort an aktiver Anzeige gelöscht“.
- `anon` bekommt keine Rechte, `00_meta` prüft das.
- pgTAP:
  - anon, ein Fremder, Admin mit aal1 und ein Claim `app_role=admin` ohne `user_roles` lesen nichts.
  - Ein Fremder schreibt nicht.
  - Der Besitzer eines gesperrten Kontos schreibt nicht, und der Web-Service behandelt die 0 Zeilen als Fehler (D2).
  - Löscht man die Anzeige oder das Profil, verschwindet die Zeile.
  - PostgREST-Embedding `listings?select=*,listing_places(*)` als anon liefert `listing_places` leer bzw. `null` (Integrationstest).

### 2. Kein späteres Such- oder Filter-Orakel (hoch, Leitplanke für M5/M6)
Das Risiko liegt nicht in M3, sondern in den späteren Schritten. Filtert eine öffentliche Suche, Karte, Umkreissuche oder ein Suchauftrag (M8) je nach Ausbau auf `listing_places`, dann zeigt das Durchprobieren aller etwa 8 200 deutschen PLZ, in welcher PLZ jede Anzeige liegt. Dafür reicht ein `count` oder „Treffer ja/nein“.

Planänderung:
- In ADR 012 und SPEC 3.3 festhalten: Kein öffentlicher oder für Nutzer erreichbarer Pfad (View, RPC, Suche, Sortierung, Suchauftrag, Benachrichtigung) wertet `listing_places` aus. Eine Suche „ab PLZ“ nutzt den Centroid der PLZ aus `postal_codes` gegen `display_location` bzw. den Kreis, nie `listing_places`.
- Meta-Test in `00_meta`: Keine Funktion und keine View außerhalb einer Allowlist referenziert `listing_places` (Suche in `pg_proc.prosrc` und `pg_views.definition`). Die Allowlist enthält den Guard bzw. die Bereitschaftsprüfung, den Hash und später die Admin-RPCs.
- `search_vector` ist eine Generated Column aus `title`/`description` und kann die andere Tabelle technisch nicht einbeziehen. Das gehört trotzdem als Satz in den ADR.

### 3. Kreis und PLZ ändern sich gegenseitig, es braucht einen atomaren Weg (hoch)
Kreis (`listings.region_id`) und PLZ (`listing_places`) stehen in zwei Tabellen. Jeder PostgREST-Request ist eine eigene Transaktion. Mit der Prüfung auf dem endgültigen Status (Auflage 8/C2) entsteht eine Blockade:
- Ändert der Nutzer an einer aktiven Anzeige zuerst den Kreis, setzt der Guard `pending_review` und prüft die Bereitschaft. Die PLZ passt noch zum alten Kreis, also `23514`.
- Ändert er zuerst die PLZ, setzt der Children-Guard `pending_review`. Weil er als Definer läuft (`is_server()`, C2 Weg 1), wird dabei nicht geprüft. Die Anzeige liegt dann inkonsistent in der Prüfung, bis der Kreis folgt.

Auch im Entwurf ist die Reihenfolge heikel: Der Entwurf entsteht laut Plan 7 schon mit dem Kreis, der Ort-Schritt kommt erst nach den Fotos.

Planänderung:
- Die Prüfung „PLZ existiert und passt zum Kreis“ steht in `private.listing_ready_for_review` und läuft nur beim Absenden und bei der Admin-Freigabe. Sie läuft nicht bei jedem Schreiben. Beim Schreiben prüft die DB nur das Format.
- Die Bereitschaftsprüfung läuft als `constraint trigger … deferrable initially deferred` auf `listings` **und** `listing_places`, also am Transaktionsende auf dem Endzustand und unabhängig von der Reihenfolge der Statements.
- Für Web und iOS gibt es eine RPC `public.set_listing_location(p_listing_id, p_region_id, p_postal_code, p_place_name)` als **security invoker**, damit RLS, Guard, Legal-Gate und Rate-Limit greifen. Sie schreibt beides in einer Transaktion. Der Assistent nutzt sie für den Ort-Schritt, iOS ebenso (Vertrag in ADR 012). Die RPC kommt in die `00_meta`-Allowlist.
- Der Assistent fragt die PLZ **vor** der Anlage des Entwurfs ab, im selben Schritt wie Art, Richtung, Titel und Kreis. Die PLZ schlägt dort den Kreis vor. Die Schrittfolge in Plan 7 wird entsprechend angepasst.
- Tests:
  - Kreis und PLZ an einer aktiven Anzeige per RPC ändern: Status wird `pending_review`, es gibt keinen Fehler.
  - Nur den Kreis per PATCH ändern, sodass die PLZ nicht mehr passt: `23514` mit `hint` `place.postal_code.region_mismatch`.
  - Admin-Freigabe bei inkonsistentem Ort: `23514`.

### 4. `content_changed` und `approved_content_hash` erfassen die PLZ noch nicht (hoch)
`content_changed` im `listings_guard` vergleicht nur Spalten von `listings` und sieht `listing_places` nicht. Laut Entscheidung 4 führt jede Änderung am Ort zurück nach `pending_review`. Das ist auch für die PLZ richtig, weil die Moderation den Ort auf Plausibilität prüft, obwohl er nicht öffentlich ist.

Planänderung:
- `listing_children_guard` deckt auch `listing_places` ab: INSERT/UPDATE an `active`/`paused` → `pending_review`, mit Legal-Gate (RV001) wie bei Fotos und Wildarten. Bei unverändertem Wert (`is not distinct from`) bleibt der Status, damit ein unverändertes Zurückschreiben aus dem Formular eine Anzeige nicht aus der Öffentlichkeit nimmt.
- Die kanonische Form des Hashes (F1) enthält `country`, `postal_code` und `lower(btrim(place_name))`.
- **Der Hash enthält jetzt die PLZ und ist damit ein Orakel, sobald er lesbar ist.** DE hat nur rund 8 200 PLZ, ein Brute Force dauert Millisekunden. Er muss deshalb in `private.listing_approvals` bleiben (F1), ohne API-Rechte und ohne Ausgabe in Logs, `audit_log.details` oder Fehlermeldungen. pgTAP: `has_table_privilege` für alle API-Rollen ist false.
- Der C5-Meta-Test „Inhaltsspalten = GRANT-Spalten“ bekommt die Spalten von `listing_places`.
- Tests in 5.2 je ein Fall: PLZ geändert, Ortsname geändert, Ort als Server geändert → `pending_review`, danach kein `paused → active`. Gleicher Wert zurückgeschrieben → Status bleibt.

### 5. Orakel über Vorschläge und Fehlermeldungen: unkritisch, mit einer Ausnahme in den Logs (mittel)
- Vorschläge und die Meldung „PLZ passt nicht zum Kreis“ vergleichen nur die **eigene** Eingabe mit öffentlichen Referenzdaten. Über fremde Anzeigen verraten sie nichts. Es gibt keinen Unique-Index auf PLZ in `listing_places` und damit auch kein Konflikt-Orakel. In Ordnung.
- Die Meldung nennt nur Feldcodes (`place.postal_code.unknown`, `place.postal_code.region_mismatch`, `place.place_name`) und keine Werte. So landet die PLZ nicht in `hint`, Client-Logs oder Fehlertracking.
- **Logs:** Fragt der Client `GET /rest/v1/postal_codes?code=eq.80331` ab, steht die PLZ zusammen mit JWT bzw. IP im API-Log. Damit wird der Nutzer mit dem Revierort verknüpft. Planänderung: Die Abfrage läuft per POST-RPC `public.postal_code_lookup(p_country, p_code)`; der Body wird nicht protokolliert, das ist Teil der B7-Checkliste. Alternativ lädt der Client nach der Kreiswahl alle PLZ des Kreises über `region_id` (der Kreis ist ohnehin öffentlich) und prüft lokal. Die Server Actions im Web protokollieren die PLZ nicht. Der Punkt kommt in die Logging-Checkliste von ADR 006/012.
- **Admin-Ansichten (M4):** Die PLZ erscheint nur in der Moderations-Detailansicht. Nicht erscheinen darf sie in Listen, Exporten, `audit_log.details` (24 Monate Aufbewahrung), Meldungsbestätigungen an Meldende und Begründungen nach DSA an Dritte. Diese Vorgabe gehört in ADR 012 und als Auflage in den M4-Plan.
- **Admin und Verfremdung:** Ein Admin kennt PLZ und `display_location`. Daraus lernt er den Versatz `v` nicht (die PLZ-Fläche ist ähnlich groß wie der Ring), B1 bleibt also unberührt. Kein Handlungsbedarf, ein Satz im ADR genügt.
- **`listing_content_hints`:** Die RPC wertet `place_name` nicht aus, denn das Feld ist nicht öffentlich. Sie liefert PLZ und Ort auch nie zurück. Optional (niedrig): ein Hinweis, wenn Titel oder Beschreibung eine 4- oder 5-stellige Zahl bzw. den eingegebenen Ortsnamen enthalten („Gib im Text keine genaue Lage an“). Schreibt der Nutzer seine PLZ selbst in den Text, ist sie öffentlich. Das bleibt Restrisiko im ADR.

### 6. Was ist der „Ort“ bei einem Gesuch? (mittel, Frage an den Nutzer)
Beim Angebot ist der Ort die Lage des Reviers. Beim Gesuch ist unklar, ob das gesuchte Gebiet gemeint ist oder der Wohnort des Suchenden. Wäre es der Wohnort, ginge es um eine personenbezogene Adressangabe mit anderer Zweckbindung (Art. 5 DSGVO), und die Datenschutzerklärung müsste sie nennen.

Planänderung:
- Das Feld heißt in allen vier Sprachen „PLZ und Ort des Reviers bzw. des gesuchten Gebiets“ und ausdrücklich nicht „Ihre Adresse“. Die Begriffe kommen ins Glossar.
- Zweck und Empfänger (Besitzer, Moderation) kommen in die Platzhalter-Datenschutzerklärung (SPEC 7, Anwalt).
- Frage an den Nutzer: Ist beim Gesuch das Suchgebiet gemeint? Wenn ja: Reicht dort ein Kreis ohne PLZ, weil Gesuche oft mehrere Kreise abdecken? Bis zur Antwort gilt die Entscheidung „Pflicht für alle“.

### 7. Suche und SEO (mittel)
- `search_vector`: In Ordnung, siehe Punkt 2.
- M5 übernimmt als Auflage: Keine PLZ und kein Ortsname in `<title>`, Meta-Description, OG-Tags, JSON-LD (`address`/`postalCode`/`addressLocality` fehlen, höchstens `addressRegion` = Kreis und `addressCountry`), Sitemap, URL/Slug, Bild-Alt-Fallback und Canonical.
- Ein E2E-Test in M5 rendert eine freigegebene Anzeige mit bekannter PLZ und sucht die PLZ und den Ortsnamen im HTML, also auch in `<head>` und `application/ld+json`. Erwartet wird kein Treffer.
- Die Vorschau im Assistenten (M3) zeigt PLZ und Ort sichtbar als „nur für dich und die Moderation“, damit der Nutzer den Unterschied zur öffentlichen Ansicht versteht.

### 8. Löschen und Aufbewahrung (niedrig)
- Cascade über `listings` → `listing_places` ist richtig. Bei weichem Löschen des Kontos (`deleted_at`) muss der M9-Job auch `listing_places` entfernen. Das kommt in die Liste in ADR 008.
- Werden abgelehnte oder entfernte Anzeigen als Nachweis nach DSA aufbewahrt, wird die PLZ dort vorher entfernt bzw. die Frist in ADR 008 genannt.
- Die Auskunft nach Art. 15/20 DSGVO (M9) enthält `listing_places`.

### 9. iOS-Parität (mittel)
ADR 012 ist der Vertrag für I4:
- Formatregeln je Land
- `set_listing_location` und `postal_code_lookup`
- Fehlercodes bzw. `hint`-Feldcodes
- Reihenfolge (PLZ vor der Anlage des Entwurfs)
- die Sichtbarkeitsregel
- die Namensnennung in der App: Einstellungen bzw. „Über“ → „Datenquellen“ mit „© OpenStreetMap-Mitwirkende“ und „Datenquelle: Statistik Austria“

Die Fixtures aus Punkt 13 gelten auch für iOS. Im CHANGELOG steht die Lücke I4 mit Verweis auf ADR 012. Die String Catalogs bekommen dieselben Begriffe wie das Glossar.

---

## B. Daten und Lizenz

### 10. ODbL widerspricht ADR 007 und muss begründet und abgegrenzt werden (hoch)
ADR 007 verwirft OSM ausdrücklich: „Die ODbL verlangt Share-Alike für die abgeleitete Datenbank“. Ohne Begründung ist ADR 012 damit ein stiller Widerspruch.

Zur Sache: Für DE gibt es keine amtliche offene PLZ-Quelle. Die Gebiete gehören der Deutschen Post (Lizenz über Post Direkt, kostenpflichtig), und das BKG gibt sie nicht frei. OSM ist deshalb vertretbar, auch Dienste wie OpenPLZ beruhen darauf und stehen ebenfalls unter ODbL. Planänderung für ADR 012 und SOURCES.md:
- **Abgeleitete Datenbank:** `postal_codes` (und `postal_code_regions`, siehe Punkt 11) ist ein Derivative Database. Sie ist über die API öffentlich abrufbar (Public Use), und die Vorschläge sind ein Produced Work. Pflichten:
  - (a) Namensnennung „© OpenStreetMap-Mitwirkende, ODbL“ mit Link, sichtbar an der Stelle der Nutzung (unter dem PLZ-Feld in Web und iOS) **und** auf der Seite „Datenquellen“, die ADR 007 ohnehin verlangt. Nur im Impressum-Platzhalter reicht nicht, weil das Impressum ein Rechtstext ist und kein Quellennachweis.
  - (b) Die abgeleitete Datenbank wird unter ODbL angeboten. Am einfachsten liegt eine CSV-Datei zum Download auf der Seite „Datenquellen“, mit Stand und Hinweis auf das Skript. Nach ODbL 4.6 reicht alternativ das Erzeugungsverfahren. Das Repo ist aber nicht öffentlich, deshalb ist die Datei der sichere Weg.
- **Produktdatenbank ist ein Collective Database:** `postal_codes` bleibt eine eigene Tabelle, die nicht mit anderen Quellen vermischt wird (OSMF Collective Database Guideline). `listing_places` speichert die **Eingabe des Nutzers** (PLZ als Faktum, Ortsname als Text des Nutzers) und keine aus OSM kopierten Geometrien oder IDs. Damit unterliegen Anzeigen, Profile und übrige Tabellen nicht dem Share-Alike. Übernimmt der Vorschlag den OSM-Ortsnamen in `listing_places`, ist das je Zeile eine unwesentliche Übernahme (Substantial Guideline). Das kommt als Frage in SPEC 7 an den Anwalt: „ODbL-Share-Alike: Bleibt die Anzeigendatenbank außerhalb?“.
- **Mischung mit VG250 (dl-de/by-2-0):** Die Kreiszuordnung aus der Verschneidung mit VG250 kommt in die ODbL-Tabelle. dl-de/by erlaubt das mit Quellenvermerk; beide Vermerke stehen in SOURCES.md.
- **AT, Statistik Austria (CC BY 4.0):** verträglich. Der Vermerk „Datenquelle: Statistik Austria“ und der Hinweis auf Änderungen (CC BY 4.0, Abschnitt 3a: Zusammenführung und Kürzung) kommen auf die Seite „Datenquellen“.

### 11. DE: Abdeckung und Zuordnung zu den Kreisen (hoch)
- **Kreisgrenzen aus VG250, nicht aus OSM `admin_level=6`.** `regions.code` stammt aus VG250 (ADR 007). OSM-Kreise tragen `de:regionalschluessel` nicht flächendeckend und weichen geometrisch ab. Die Verschneidung läuft im selben Generator wie bei den Regionen gegen VG250 desselben Stands. Der Schlüssel ergibt sich aus dem AGS-Präfix (5 Stellen) und ist dann direkt `regions.code`.
- **Splitterflächen:** OSM-PLZ-Grenzen und VG250 liegen nie deckungsgleich. Eine reine `ST_Intersects`-Verschneidung ordnet fast jede Rand-PLZ zusätzlich dem Nachbarkreis zu (falsch positiv, die Prüfung wird wertlos). Schwelle: Der Kreis zählt, wenn der Anteil an der PLZ-Fläche ≥ 1 % oder ≥ 0,5 km² beträgt. Dazu kommt eine eingecheckte Override-Datei (`overrides.csv`, mit Begründung je Zeile) für gemeldete Fehler. Der Generator gibt eine Statistik aus: Anzahl PLZ, PLZ mit mehr als einem Kreis, PLZ ohne Kreis, Kreise ohne PLZ. Die Statistik steht im Commit bzw. in SOURCES.md.
- **Abdeckung:** Die Zustell-PLZ in DE sind in OSM nahezu vollständig (etwa 8 200 Gebiete). Postfach- und Großkunden-PLZ haben keine Fläche und fehlen. Für Reviere spielt das keine Rolle, im ADR festhalten. Akzeptanztest im Generator: Jeder `district` in DE hat mindestens eine PLZ, und die Gesamtzahl liegt in einem erwarteten Band. Sonst bricht der Import ab.
- **Ortsnamen:** `note` an `postal_code`-Relationen ist uneinheitlich, `place`-Knoten in der Fläche liefern mehrere Namen je PLZ. Datenmodell normalisieren: `postal_codes (country, code)` als Schlüssel, dazu `postal_code_regions (country, code, region_id)` und `postal_code_places (country, code, name)`. Die eine Tabelle `(country, code, place_name, region_id)` aus dem Plan vervielfacht sonst die Zeilen.
- **Ortsname bei der Anzeige:** Pflicht als **freier Text** (1–100 Zeichen nach `btrim`, keine Steuerzeichen) mit Vorschlägen aus dem Verzeichnis. Er wird nicht hart gegen die Liste geprüft. Gemarkungen, Ortsteile und Revier- bzw. Jagdbezirksnamen fehlen dort, und eine harte Prüfung würde echte Anzeigen blockieren.
- **Fehlerfall Daten:** Lehnt die Prüfung eine echte Kombination ab, hat der Nutzer keinen Ausweg, weil das Feld Pflicht ist. Die Fehlermeldung bietet deshalb „Kreis passt nicht? Melde uns die PLZ“ an (Kontakt bzw. Support, kein neues System). Die Override-Datei behebt den Fall in der nächsten Migration.

### 12. AT-Quelle prüfen, bevor sie festgeschrieben wird (mittel)
- Das Gemeindeverzeichnis von Statistik Austria enthält meines Wissens je Gemeinde nur die „PLZ des Gemeindeamts“, also eine PLZ je Gemeinde. Das ist **keine** vollständige n:m-Zuordnung. Viele Gemeinden haben mehrere PLZ, und viele PLZ reichen über Gemeinde- und Bezirksgrenzen. Vor Commit 7a ist zu prüfen, ob die gewählte Datei (Ortschaften- bzw. Ortschaftsverzeichnis mit PLZ) die vollständige Zuordnung PLZ ↔ Gemeinde liefert. Name, URL, Stand und Lizenz kommen in SOURCES.md. Reicht die Quelle nicht, gibt es zwei Alternativen: das PLZ-Verzeichnis der Österreichischen Post (Nutzungsbedingungen prüfen, nicht ohne Freigabe verwenden) oder OSM auch für AT (ODbL wie DE). Die Entscheidung fällt im ADR.
- Die Zuordnung zum Bezirk über die ersten 3 Stellen der Gemeindekennziffer passt zum Format `AT-901`. Der Stand muss zu den importierten Bezirken passen: Gemeindestrukturreform Steiermark 2015, Auflösung von Wien-Umgebung 2017, Statutarstädte. Der Generator prüft, dass jede Kennziffer auf einen vorhandenen `district` zeigt, sonst bricht er ab.
- Format AT: `^[1-9][0-9]{3}$`, DE: `^[0-9]{5}$`. Die PLZ gehört zum Land der Anzeige (`listings.country`); eine AT-PLZ an einer DE-Anzeige ergibt `region_mismatch`.

### 13. Reproduzierbarer Import nach ADR 007 (mittel)
Der Plan nennt `supabase/seed/tools/` und einen „Seed“. Das widerspricht ADR 007: Regionen werden **als Migration** geladen, weil `seed.sql` bei `db push` nicht läuft. Planänderung:
- Generator unter `supabase/data/postal_codes/generate.py` (wie `supabase/data/regions/`). Eingaben: Geofabrik-Extrakt Deutschland (`.osm.pbf`) mit Datum und SHA-256, VG250 desselben Stands wie bei den Regionen und die Statistik-Austria-Datei mit Datum und SHA-256. Werkzeug mit fester Version (z. B. `osmium`/`pyosmium` und `shapely`, nur im Generator, keine Abhängigkeit für Web oder iOS; Begründung im ADR).
- Ausgabe: eine **Migration** `…_postal_codes_data.sql`, deterministisch sortiert, mit Kopf aus Quelle, Stand, Hashes und Lizenz. Ins Repo kommen keine Polygone, höchstens ein gerundeter Centroid je PLZ für eine spätere Suche „ab PLZ“.
- Ein erneuter Lauf mit denselben Eingaben erzeugt eine byte-gleiche Datei; die CI prüft das nicht, das Skript dokumentiert es.
- Aktualisierung jährlich oder bei Bedarf per neuer Migration, die den Inhalt ersetzt (`truncate` + `insert` in einer Transaktion). Deshalb **kein FK** von `listing_places` auf `postal_codes`. Die Prüfung läuft beim Absenden und bei der Freigabe, damit bestehende Anzeigen ein Update der Daten überstehen.
- `postal_codes` und die beiden Untertabellen: RLS mit Select-Policy, keine Schreibrechte für API-Rollen, pgTAP wie `regions`. Lesen dürfen `anon` und `authenticated` (Referenzdaten). Im ADR festhalten, dass das eine ODbL-Verbreitung ist (Punkt 10).

### 14. Märkte CH, CZ und PL (mittel)
Die Pflicht gilt „für alle Anzeigen“, ein Verzeichnis gibt es aber nur für DE und AT. Heute sperrt der Regionen-Trigger andere Länder ohnehin (ADR 007). In ADR 012 unter Folgen festhalten:
- Die PLZ-Daten eines Landes kommen **gemeinsam** mit seinen Kreisen, sonst lässt sich dort keine Anzeige absenden.
- Formate CH 4-stellig, CZ `NNN NN` (mit Leerzeichen normalisieren), PL `NN-NNN`.
- Die Formatregel liegt je Land in einer Tabelle bzw. Funktion, nicht als fester Ausdruck im Guard.

---

## C. Ort der Prüfung, Fixtures, Commits

### 15. Ort der Prüfung (mittel, zusammengefasst)
- **Beim Schreiben:** Format-CHECK auf `listing_places.postal_code` (Land aus der Anzeige per Trigger) und Länge bzw. Steuerzeichen bei `place_name`.
- **Existenz und Kreis:** in `private.listing_ready_for_review` (Definer-Hilfsfunktion, nicht aufrufbar, Eintrag in die `private`-Allowlist). Aufgerufen wird sie im deferred Constraint-Trigger (Punkt 3) beim Absenden und bei der Admin-Freigabe (A1). Die Prüfung liegt nicht in einer RPC: Eine RPC allein lässt sich per direktem PATCH umgehen.
- **RPCs** nur für Bequemlichkeit und Atomarität (`set_listing_location`, `postal_code_lookup`), beide invoker bzw. ohne Sonderrechte. Sie sind nie der Ort der Sicherheitsprüfung.

### 16. Pflichtfeld-Fixtures (mittel)
Zod kann das Verzeichnis nicht prüfen. Der Vertrag „gleiches Ergebnis in Zod und DB“ (Auflage 11) gilt für PLZ-Fälle deshalb nicht wörtlich. Planänderung:
- Jede Fixture bekommt `expected: { zod: …, db: … }` mit Feldcodes. Zod prüft Format und Pflicht, die DB zusätzlich Existenz und Kreis.
- Fälle: gültig DE (eine PLZ, die nachweislich zum Kreis passt, z. B. aus dem Seed per Abfrage gewählt und nicht hart eingetragen), gültig AT, falsches Format DE/AT, unbekannte PLZ, PLZ eines anderen Kreises, AT-PLZ an DE-Anzeige, fehlender Ortsname, Gesuch ohne PLZ (Pflicht) und eine PLZ mit mehreren Kreisen, gültig für jeden davon.
- pgTAP wählt die mehrkreisige PLZ per `select … from postal_code_regions group by code having count(*) > 1 limit 1` aus den Daten, damit ein Datenupdate den Test nicht bricht.
- Die bestehenden Fixtures und E2E-Testdaten (`globalSetup`, `web/integration/context.ts`) bekommen gültige Orte, sonst werden die Absende-Tests aus Commit 6/8 rot.

### 17. Commit-Reihenfolge (mittel)
7a nach 6 bedeutet: Der Guard und die Bereitschaftsprüfung aus Commit 6 werden in 7a erneut umgeschrieben. Das ist genau die Drift, die Auflage 13/D4 vermeiden soll. Planänderung:
- **5a** (vor 6): ADR 012, Generator, Daten-Migration `postal_codes`/`postal_code_regions`/`postal_code_places`, RLS, pgTAP, Seite bzw. Abschnitt „Datenquellen“ als Platzhalter-Text in den vier Sprachen. Der Vermerk steht dort und nicht im Impressum.
- **5b** (vor 6): Tabelle `listing_places`, RLS, Spalten-GRANTs, Format-CHECK, Erweiterung des Children-Guards und pgTAP für Rechte und Cascade.
- **6**: Der Guard und die Bereitschaftsprüfung enthalten von Anfang an Existenz und Kreis der PLZ, den deferred Constraint-Trigger, den Hash mit Ort und die RPC `set_listing_location`. Die Fixtures aus Punkt 16 kommen im selben Commit.
- 7a entfällt. `postal_code_lookup` kommt mit 5a oder 6, das Assistenten-UI mit Commit 11.
- SPEC v0.5 (Commit 2) bekommt in 3.1 und 3.3 die Tabellen und die Sichtbarkeitsregel, in 7 die Anwaltsfrage zur ODbL.

---

## Freigabe PLZ-Teil: mit Auflagen

Die Umsetzung des PLZ-Teils beginnt erst, wenn die Auflagen 1–5 im Plan stehen. Ein erneutes Review ist danach nicht nötig. Die Frage zu Punkt 6 geht an den Nutzer, und bis zur Antwort gilt „Pflicht für alle“.

### Auflagen
1. **(Punkte 1, 4)** `listing_places`:
   - 1:1 mit Cascade, RLS für Besitzer und `is_admin()` (aal2), Spalten-GRANTs, kein DELETE für `authenticated`, keine Rechte für anon.
   - Der Children-Guard setzt bei Änderungen `pending_review` und wendet das Legal-Gate an.
   - Der Hash enthält den Ort und bleibt privat, mit Rechtetest.
   - Der C5-Meta-Test erfasst die Ortsspalten.
2. **(Punkte 3, 15)** Die Prüfung von Existenz und Kreis steht in der Bereitschaftsprüfung, als deferred Constraint-Trigger beim Absenden und bei der Freigabe. Für Kreis und PLZ gibt es die atomare RPC `set_listing_location` (invoker). Die PLZ wird im Assistenten vor der Anlage des Entwurfs abgefragt. Die Tests aus Punkt 3 sind Pflicht.
3. **(Punkte 2, 7)** In ADR 012 und SPEC 3.3 steht, dass weder Suche, Filter, Suchauftrag noch eine Ausgabe für SEO oder Meta-Daten `listing_places` nutzen. Ein Meta-Test mit Allowlist prüft das. Die Auflagen für M5 (JSON-LD, Meta-Tags, HTML-Test) stehen in ADR 012.
4. **(Punkte 10, 12, 13)** ADR 012 begründet die Abweichung von ADR 007 und hält fest:
   - Namensnennung am PLZ-Feld (Web und iOS) und auf der Seite „Datenquellen“
   - Download der ODbL-Tabelle
   - Abgrenzung als Collective Database
   - Anwaltsfrage in SPEC 7
   - Vor dem Commit ist geprüft, dass die AT-Quelle eine vollständige Zuordnung PLZ ↔ Gemeinde liefert.
   - Der Import ist eine **Migration** aus `supabase/data/postal_codes/` mit Quellen-Hashes, wie in ADR 007, kein Seed.
5. **(Punkte 11, 16, 17)**
   - Die Kreiszuordnung kommt aus der Verschneidung mit VG250, mit Flächenschwelle, Override-Datei und Statistik bzw. Abbruchprüfungen.
   - Die Tabellen werden normalisiert.
   - Der Ortsname ist Freitext mit Vorschlägen.
   - Die Fixtures haben getrennte Erwartungen für Zod und DB, die mehrkreisige PLZ kommt aus den Daten.
   - Die Commits 5a/5b liegen vor Commit 6, 7a entfällt.

Nicht blockierend, im Plan vermerken: Punkt 5 (Lookup per POST bzw. über die Region, Logging-Checkliste, Regeln für Admin-Ansichten in M4), Punkt 8 (ADR 008, Auskunft), Punkt 9 (Vertrag für I4, Namensnennung in iOS), Punkt 14 (CH/CZ/PL in den Folgen) und der optionale Hinweis auf PLZ im Freitext.

Frage an den Nutzer (Punkt 6): Ist der Ort beim Gesuch das gesuchte Gebiet? Und soll dort ein Kreis ohne PLZ genügen?
