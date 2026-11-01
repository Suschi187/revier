# Changelog

Pro Backlog-Schritt ein Eintrag: was geändert wurde, wie man es testet, bekannte Lücken.

## Nachtrag M5: QA-Funde F1–F11 – 2026-11-01

Bericht: `docs/QA-REPORT.md`, Abschnitt „M5 – Abnahme“.

### Geändert
- **F1 Relevanz-Paging:** `search_listings` läuft mit `extra_float_digits = 3`. Der Rang steht verlustfrei im Cursor, die nächste Seite wiederholt keine Treffer mehr.
- **F2 Suchtext:** Die Grenze von 32 Knoten gilt je Sprachfassung, nicht für den verknüpften tsquery. Sechs und mehr Wörter funktionieren. Ist der Text trotzdem zu lang, zeigt das Web „Suchbegriff zu lang“ statt „Filter ungültig“.
- **F3 Favoriten:**
  - Neue RPCs `my_favorites` (Karten und Zahl der nicht verfügbaren in einer Abfrage) und `remove_unavailable_favorites` (die DB bestimmt die Menge selbst).
  - Keine ID-Liste mehr in der URL (414 ab etwa 220 IDs) und kein N+1.
  - Schlägt das Laden fehl, gilt nichts als „nicht verfügbar“, und es wird nichts entfernt.
- **F4:** Die Policy `favorites_insert_own` lässt nur öffentliche, fremde Anzeigen zu. Vorhandene Favoriten auf eigene Anzeigen werden entfernt.
- **F5 360 px:** Listenkarten dürfen im Grid schrumpfen (`minmax(0,1fr)`, `min-w-0`). Lange Wörter in Titel, Anbieterzeile und Überschriften brechen um (`overflow-wrap: anywhere`, Silbentrennung per `lang`).
- **F6:** Leere Kategorie- und Regionsseiten sind `noindex` ohne Canonical und hreflang.
- **F7:** „Auf Anfrage“ hat nie eine Währung (Check `price_consistent` verschärft, Bestand bereinigt). Solche Anzeigen erscheinen nicht mehr im Währungsfilter.
- **F8:** Unterpfade statischer Seiten ohne Unterseiten (`LEAF_SECTIONS`) ergeben 404 aus dem Proxy, auch im Produktions-Build. Ein Vitest gleicht die Liste mit dem Dateisystem ab.
- **F9:** Der Rücksprung nach dem Merken behält den Suchtext (nur per POST). Login-Link und Umleitungen zu Login oder Onboarding enthalten ihn nie (mit N2).
- **F10:** `SITE_INDEXABLE` wirkt zur Laufzeit: Der Proxy setzt `X-Robots-Tag`, `robots.txt` wird zur Anfrage erzeugt. Ein Build gilt damit für Stage und Prod.
- **F11:** Der Cache-Zähler steht im Schlüssel der Sitemap. Entfernte Anzeigen und gelöschte Konten fallen sofort heraus, neue Anzeigen erscheinen nach bis zu 1 h.
- **Nachprüfung N1–N3** (QA-REPORT „M5 – Nachprüfung“):
  - **N1:** Der Proxy läuft auf allen Pfaden außer `_next/` und reicht Dateien, Sitemaps, `robots.txt` und APIs nur durch. Außerhalb von Prod trägt damit jede Antwort `X-Robots-Tag: noindex`, auch die 308 für den Schrägstrich am Ende (die entfernt der Proxy jetzt selbst).
  - **N2:** Leitet „Merken“ zu Login oder Onboarding um (Sitzung abgelaufen, Zustimmung fehlt), steht der Suchtext nicht in der URL.
  - **N3:** Gültige Unterpfade je statischem Bereich stehen in `STATIC_ROUTES` (Abgleich mit dem Dateisystem per Vitest). Unbekannte Pfade unter `account`, `admin` und `auth` ergeben auch im Produktions-Build 404.
- **Hinweis aus dem Bericht:** Fällt die Abfrage des Cache-Zählers aus, gilt ein fester Schlüssel statt eines neuen je Anfrage.
- **Proben:** Die TODO-Proben in pgTAP `28_qa_m5_abnahme` und die `test.fail` in `e2e/qa-m5.spec.ts` sind jetzt normale Tests. Neu ist pgTAP `29_qa_m5_fixes` (300 Favoriten, Entfernen nur der nicht verfügbaren, fremde Konten unberührt).

### Testen
- `supabase db reset && supabase test db` (713 mit den Proben der Nachprüfung), nach allen E2E-Läufen ohne Reset noch einmal grün, keine `@test.local`-Konten übrig
- `cd web && npm test` (396), `npm run test:integration` (160), `npm run test:e2e` (92, ohne `test.fail`)
- Produktions-Build:
  - `npm run build && npx next start -p 3456`, dann `QA_BASE_URL=http://localhost:3456 npx playwright test e2e/qa-m5-nachpruefung.spec.ts e2e/qa-m5.spec.ts e2e/qa-m4.spec.ts e2e/public.spec.ts` (67)
  - `curl -s -o /dev/null -w '%{http_code}' localhost:3456/de/imprint/x` und `/de/auth/x` geben 404, `curl -sI localhost:3456/sitemap/de.xml` trägt `X-Robots-Tag: noindex`
  - Mit `SITE_INDEXABLE=true npx next start` gestartet: `robots.txt` erlaubt alles, kein `X-Robots-Tag`

### Bekannte Lücken
- Review A12: „Weitere laden“ mit Fokus auf den ersten neuen Treffer gibt es nicht, die Listen blättern über Seitenlinks (ohne JavaScript bedienbar).
- Die übrigen Hinweise des Berichts bleiben offen, unter anderem die Übersetzungen aller Namespaces im RSC-Payload (Performance, M10) und die 410-Seite ohne Sprachumschalter.

## M5 Öffentliche Seiten, Suche, Detail (Web) – 2026-11-01

Plan `docs/plans/M5-plan.md` mit Architekt-Review (Abschnitte 10/11), ADR 015, SPEC v0.7.

### Geändert
- **Migrationen:**
  - `publication_fields`: `published_at` (erste Freigabe, nie zurückgesetzt) und `approved_at` (jede Freigabe), Trigger auf allen Pfaden, Check „aktiv nur mit published_at“, Backfill, nicht im Inhalts-Hash. Bundesland-Slugs global eindeutig, Kreis-Slugs je Bundesland. Favoriten höchstens 500 je Konto (Advisory-Lock, `23514`).
  - `search_listings`: eine Sichtbarkeitsdefinition `private.listing_is_public` für Policy, `public_profiles` und alle RPCs (Review B1). `search_listings` mit Filterformat v1, Fehler `22023` mit dem Schlüssel als `hint`, Keyset-Cursor an Filter und Sortierung gebunden, Gesamtzahl bis 1000. `listing_region_counts` für Regionslinks.
  - `public_page_state`: Zustand `public`, `gone` oder `null` (nie „entfernt“), `provider_listings`. Cache-Zähler `public_cache_epoch`, den Trigger bei Entfernen, Sperren und Konto-Löschung auf allen Pfaden erhöhen.
- **Web:**
  - Pfad-Parser `lib/public/paths.ts` mit URL-Wörtern je Sprache. Ihn nutzen Proxy, Seiten, Sprachumschalter, hreflang, Sitemap und `safeNextPath`. Regions-Slugs kommen aus `lib/public/reference-data.json` (`npm run gen:reference`, Abgleich per Integrationstest).
  - Proxy:
    - 308 auf die kanonische Form für alle Pfade, 404 für unbekannte Formen.
    - Für Detail und Anbieter ungecacht 404 bzw. 410, nur bei Dokumentanfragen, fail-open. Die 410-Seite liefert der Proxy selbst, weil Next den Status eines Rewrites sonst nicht übernimmt.
    - `X-Robots-Tag: noindex, follow` für Suche und Listen mit Query.
  - Seiten:
    - Startseite (Suchfeld, Kategorien, Länder, neueste Anzeigen)
    - Kategorie, Bundesland, Kreis und Suche mit allen Filtern aus SPEC 4.3 als GET-Formular
    - Anzeigen-Detail (Galerie, Eckdaten, Anbieterbadge, Kontakt nur nach Login)
    - Anbieterprofil (Privatpersonen `noindex`)
    - Favoriten (`/account/favorites`)
    - Alle ohne Suspense, damit sie ohne JavaScript vollständig im HTML stehen.
  - Öffentliche Daten nur über den Anon-Client mit festen Spalten (Test `public-boundary`). Cache-Profil `publicListings` (5 min), Tags in den Actions, Cache-Zähler in jedem Cache-Schlüssel.
  - Foto-Route `/api/photos/{id}/{thumb|full}`: Der Bucket bleibt privat, jeder Abruf prüft die Sichtbarkeit (`no-cache` + ETag, 304).
  - Merken nur per POST, ohne Login zum Login mit Rücksprung; nicht mehr verfügbare Favoriten lassen sich gesammelt entfernen.
  - SEO: Canonical und hreflang mit übersetzten Pfaden; JSON-LD `BreadcrumbList` und auf der Startseite `WebSite`, maskiert über `jsonLdString`. Sitemaps je Sprache unter `/sitemap/{locale}.xml`, zur Anfrage erzeugt. `robots.txt` und `X-Robots-Tag: noindex` außer Prod (`SITE_INDEXABLE=true`).
- **Neue Abhängigkeit (nur dev):** `@axe-core/playwright` 4.14.0, für die automatische WCAG-Prüfung laut Review A12.
- **Doku:** ADR 015, ADR 003 (Slugs, Matcher), SPEC v0.7 (`published_at`/`approved_at`, Sichtbarkeit, Anbieterprofil, zwei Rechtsfragen in 7.2), Glossar (URL-Wörter, Begriffe).
- **Tests:**
  - pgTAP `25_publication_fields`, `26_search_listings` (dieselbe Menge für anon, Besitzer, Admin, gesperrten Besitzer und `service_role`), `27_public_page_state`
  - Integration `search.test.ts` (Filter-Fixture gegen die RPC) und `reference-data.test.ts`
  - Vitest für Parser, Filter (gleiche Fixture wie die DB), `safeNextPath`, JSON-LD, robots und 410-Seite
  - E2E `public.spec.ts`

### Testen
- `supabase db reset && supabase test db` (641), danach E2E und ohne Reset noch einmal `supabase test db`: grün, keine `@test.local`-Konten übrig
- `cd web && npm test` (345), `npm run test:integration` (160), `npm run test:e2e` (52)
- Manuell:
  1. Eine Anzeige freigeben (M4). Danach erscheint sie unter `/de`, `/de/jagdpacht` und `/de/jagdpacht/bayern/…` und in der Suche.
  2. `curl -I /de/anzeige/<id>` gibt 200. Nach `update listings set status='paused'` gibt es 410. Ein Entwurf gibt 404.
  3. Sprachumschalter auf `/de/jagdpacht/bayern` führt zu `/en/hunting-lease/bayern`.
  4. `/sitemap/de.xml` und `/robots.txt` lesen (lokal `Disallow: /`).

### Messung (Review A2)
10.000 synthetische Anzeigen (200 Konten), als anon, lokal, Transaktion mit Rollback:

| Fall | Laufzeit `search_listings` |
|---|---|
| neueste | 39 ms |
| Art und Land | 140 ms |
| Bundesland | 38 ms |
| Volltext | 86 ms |
| Preis mit Währung | 47 ms |
| Wildart | 158 ms |

Die Hauptabfrage nutzt `listings_published_idx` (1–2 ms). Den Rest kosten die Gesamtzahl bis 1001 Zeilen (mit `is_active_user` je Zeile) und die Karten. Das liegt unter 1 s (SPEC 8). Bei mehr Daten zuerst die Zählung prüfen.

### Akzeptanz (SPEC 6 M5)
- [x] Filtern nach Land, Region, Art und Preis liefert korrekte Ergebnisse (pgTAP `26`, E2E „Akzeptanz a“)
- [x] Preise in Originalwährung mit passender Locale, ohne Umrechnung (E2E „Akzeptanz b“ gegen `Intl` derselben Laufzeit, de/en/cs/pl × EUR/CZK)
- [x] Nicht freigegebene Anzeigen sind weder abrufbar (404, auch für den eingeloggten Besitzer) noch indexierbar (`noindex`, nicht in Sitemap und Suche), E2E „Akzeptanz c“
- [x] Nutzer-Ergänzung: Entfernen, Sperren und Konto-Löschung wirken sofort in Listen, Detail und Fotos (E2E „Sofortige Wirkung“), normale Änderungen nach höchstens 5 Minuten

### Bekannte Lücken
- **iOS (I2):** nutzt `search_listings`, `provider_listings` und `public_page_state` unverändert und lädt Fotos über die Storage-API mit Anon-Key; noch nicht umgesetzt.
- Karte (M6), Kontakt per Chat (M7; der Button weist bis dahin darauf hin), Suchaufträge (M8, übernehmen Filter v1), Melden (M9), statische Seiten „Über uns“, „So funktioniert es“, FAQ, Richtlinien (M9/M10).
- Neue und bearbeitete Anzeigen erscheinen in gecachten Listen nach bis zu 5 Minuten (ADR 015). Auf mehreren Instanzen beschleunigen die Tags nur die eigene; die Garantie geben Cache-Dauer und Cache-Zähler.
- Pausierte Anzeigen antworten mit 410 und werden nach dem Fortsetzen langsamer neu indexiert (ADR 015).
- Volltext ohne Zerlegung von Komposita und ohne Diakritika-Faltung für cs/pl (ADR 015).
- URL-Wörter in cs/pl sind ungeprüft (Glossar). Rechtsfragen zu Anbieterangaben (DSA) und Begründung per E-Mail stehen in SPEC 7.2.
- Cloud-Checkliste (M10): Statement-Timeout für `anon`, Rate-Limit oder WAF für Suche und Foto-Route, `SITE_INDEXABLE=true` nur in Prod.

## Nachtrag M4: QA-Funde F1–F6 – 2026-10-30

Bericht: `docs/QA-REPORT.md`, Abschnitt „M4 – Abnahme“.

### Geändert
- **F1 Pfade und Status:** Der Proxy entscheidet über die kanonische Form des Pfads (`canonicalPath`: vollständig dekodiert, Schrägstriche normalisiert). Geschützte Pfade in anderer Schreibweise (`/de/%61dmin`, `/de//admin`, `/de%2Fadmin`) leiten per 308 auf die kanonische Form, ungültige Kodierung gibt 400. Damit gelten Rollenprüfung, 403, Login-Redirect, Nonce-CSP und `X-Robots-Tag` auf jedem Weg. **Korrektur:** `export const instant = false` macht das Rendern nicht blockierend, es nimmt die Seite nur aus der Instant-Navigation-Prüfung. Den Status setzt allein der Proxy, die Prüfung in der Seite autorisiert nur (ADR 014 mit Quelle, Kommentare in allen Seiten). Das gilt auch für den Eintrag zu M3 F1 unten: Entscheidend war dort das Entfernen der Suspense-Grenzen.
- **F2 TOTP:** Ein falscher Code bei der Ersteinrichtung behält Faktor, QR-Code und Schlüssel; die Meldung steht am Feld. Ohne JavaScript ist der Knopf gesperrt, `<noscript>` nennt den Grund (Secret gibt es nur einmal, Next rendert den Action-Zustand ohne JS nicht, Cookie/URL schließt Review B3 aus). Die Code-Eingabe für einen bestehenden Faktor geht weiter ohne JS.
- **F3 Ernennen:** `grant_admin` verlangt eine eigene Kontosuche per E-Mail für dasselbe Konto in der letzten Stunde (`42501`, Hint `lookup_required`); `?candidate=<id>` allein zeigt kein Formular mehr (Migration `grant_requires_lookup`).
- **F4 Prüfansicht:** Fremde Entwürfe ergeben 404, entschiedene Anzeigen zeigen nur Titel und Status. Version und Waffenbegriff-Hinweise gibt es für Admins nur bei `pending_review` (Migration `review_only_pending`).
- **F5 Kontosuchen:** `private.admin_lookups` mit Fremdschlüssel auf `auth.users` (Kaskade) und Bereinigung älter als 1 Stunde bei jeder Suche (Migration `admin_lookups_cleanup`).
- **F6 Oberfläche:** Übersicht zählt ohne eigene Anzeigen wie die Warteschlange; Karenz und Limits kommen aus `private.app_settings` (RPC `admin_role_rules`, Migration `admin_role_rules`); Audit-Details mit übersetzten Schlüsseln, Status, Grund-Vorlagen und Weg; Code-Felder zum Entziehen mit Namen im Label; Entscheidungsfehler per `aria-describedby` am Feld.
- **Aufräumen:** `e2e/auth.spec.ts` löscht seine Testkonten.

### Testen
- `supabase db reset && supabase test db` (553), danach `npm run test:e2e` und ohne Reset noch einmal `supabase test db`: grün, keine `@test.local`-Konten übrig
- `cd web && npm test` (178), `npm run test:integration` (117), `npm run test:e2e` (38, ohne `test.fail`)
- Produktions-Build: `npm run build && npx next start -p 3456`, dann `QA_BASE_URL=http://localhost:3456 npx playwright test e2e/admin.spec.ts e2e/qa-m4.spec.ts` (19)
- manuell: `curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' http://localhost:3456/de/%61dmin` → `308 …/de/admin`

### Bekannte Lücken
- TOTP-Einrichtung braucht JavaScript (siehe F2, ADR 014).
- Fällt die Rolle in den Millisekunden zwischen Proxy und Seite weg, sieht der Nutzer „Kein Zugriff“ mit `noindex`, aber Status 200 (keine Daten).

## M4 Admin-Bereich (Freigabe) – 2026-10-30

Plan `docs/plans/M4-plan.md` mit Architekt-Review (Abschnitte 10/11), ADR 014.

### Geändert
- **Migrationen:**
  - `moderation_fields`: `reject_code` (Grund-Vorlage) plus optionaler Freitext mit Constraints, `submitted_at` mit Index für die Warteschlange, Trigger für Grund und Zeitpunkt auf allen Pfaden, Inhalts-Hash ohne diese Spalten. Moderation nur noch über die RPC (Flag im Guard), Moderatoren ändern keine fremden Inhalte (außer Kartenpunkt entfernen), `is_admin` nur für aktive Konten.
  - `moderate_listing`: RPC (security invoker) für Freigeben, Bearbeitung anfordern, Ablehnen, mit Zeilensperre und Versionsvergleich (`RV003` bereits entschieden, `RV004` inzwischen geändert); `admin_listing_version`, `admin_review_queue`; Waffenbegriff-Hinweise auch für Admins.
  - `admin_roles`: `grant_admin`, `revoke_admin` mit Step-up (frischer TOTP-Code laut Claim `amr`, `RV005`), 3 je Admin und 10 insgesamt in 24 h, 7 Tage Karenz, letzter Admin geschützt; Audit per Trigger auf `private.user_roles`; `admin_find_user` (exakte E-Mail, Rate-Limit, Audit), `admin_list_admins`, `admin_access`.
- **Supabase:** TOTP-MFA lokal an (`config.toml`).
- **Web:**
  - Zugang: Proxy prüft `/admin` per RPC (403-Rewrite ohne Rolle) und setzt eine Nonce-CSP; jede Seite und Action prüft `requireAdmin()` mit `getUser()` und ruft sonst `forbidden()`. (Korrigiert nach QA M4 F1: Den Status setzt nur der Proxy, `instant = false` macht das Rendern nicht blockierend.)
  - `/admin/mfa`: TOTP einrichten nur per POST, Code-Eingabe ohne JS.
  - `/admin/listings`: Warteschlange; `/admin/listings/[id]`: Prüfansicht mit Fotos (signierte URLs, 10 min) und Entscheidung.
  - `/admin/audit`: Audit-Log mit Filter; `/admin/admins`: Admins ernennen und entziehen mit frischem Code.
  - „Meine Anzeigen“ und Assistent zeigen den Grund in der Sprache des Besitzers plus Freitext.
  - `ListingSummary` aus der Vorschau ausgelagert (Besitzer und Moderation sehen dasselbe).
- **Doku:** ADR 014; ADR 005 (Ernennung per UI, Runbooks erster und kompromittierter Admin), ADR 010 (Nonce-CSP für `/admin`), ADR 013 (Hash-Ausschlüsse, Moderation); SPEC v0.6; Glossar (Moderation, Grund-Vorlagen).
- **Tests:** pgTAP `21_moderation_fields`, `22_moderate_listing`, `23_admin_roles`; API-Tests `admin.test.ts` mit echtem aal2; E2E `admin.spec.ts` (auch gegen den Produktions-Build lauffähig); TOTP-Helfer `integration/totp.ts` ohne neue Abhängigkeit.

### Testen
- `supabase stop && supabase start` (TOTP in `config.toml`), dann `supabase db reset && supabase test db` (506)
- `cd web && npm test` (161), `npm run test:integration` (117), `npm run test:e2e` (25)
- Manuell:
  1. Konto anmelden, per Runbook (ADR 005) zum Admin machen: `supabase db query --local "insert into private.user_roles (user_id, role, created_at) select id, 'admin', now() - interval '7 days' from auth.users where email = '<deine Adresse>'"`
  2. `/de/admin` öffnen, Authenticator einrichten (QR-Code oder Schlüssel), Code eingeben.
  3. Mit einem zweiten Konto eine Anzeige absenden; als Admin unter „Zur Warteschlange“ freigeben, zurückgeben oder ablehnen; das zweite Konto sieht Status und Grund in „Meine Anzeigen“.
  4. Ein Konto ohne Rolle bekommt auf `/de/admin` die Seite „Kein Zugriff“ (HTTP 403).

### Akzeptanz (SPEC 6 M4)
- [x] Freigegebene Anzeige wird sichtbar: `active` mit Ablaufdatum, für anon lesbar (`admin.test.ts`, `22_moderate_listing`, E2E); öffentliche Seiten folgen in M5
- [x] Abgelehnte Anzeige zeigt den Grund im Dashboard („Meine Anzeigen“, in der Sprache des Besitzers; E2E auf Polnisch)
- [x] Nicht-Admins erhalten 403 (echter HTTP-Status auf allen Admin-Seiten, E2E auch gegen den Produktions-Build)

### Bekannte Lücken
- **iOS (I4):** Den Grund zeigt die App erst ab I4; die Grund-Codes gehören dann mit denselben Glossar-Begriffen in den String Catalog. Admin bleibt reines Web (SPEC 5).
- **Eigene Anzeigen von Admins:** Kein Admin moderiert die eigene Anzeige (Vier-Augen-Prinzip), die Warteschlange zeigt sie ihm nicht. Gibt es nur einen Admin, bleibt dessen eigene Anzeige liegen, bis ein zweiter ernannt ist.
- **Nicht im Umfang:** Verifizierungen, Meldungen, Nutzer sperren, Anzeigen entfernen (spätere Schritte); Benachrichtigung des Besitzers per Mail/Push (M8).
- **Tests:** Ein E2E-POST auf eine Admin-Server-Action als Nicht-Admin fehlt; dass jede Action `requireAdmin()` aufruft, sichert `guards.test.ts`. Gleichzeitiges Entziehen durch zwei Admins ist nur über die Sperre im Code abgesichert, nicht parallel getestet. Der letzte Admin ist per pgTAP geprüft, nicht per E2E. Ein eigener Commit „E2E“ entfiel, die Tests entstanden mit den Commits 6–10.
- **Rechtliches:** Begründung nach DSA Art. 17 (AGB-Bezug, Rechtsbehelf) klärt der Anwalt; Grund-Texte bleiben vorläufig, cs/pl ungeprüft.
- **Restrisiko:** TOTP-Codes lassen sich mit einer `aal1`-Session raten; Schutz sind die Supabase-Limits (ADR 014).

### Cloud-Checkliste (neu)
- TOTP enroll/verify aktiv und nach dem Deploy geprüft; `max_enrolled_factors`; Rate-Limits für Token- und MFA-Prüfungen
- Custom Access Token Hook aktiv (sonst kein Link „Admin“ im Kopf; Rechte hängen nicht daran)
- Session-Timeouts (`inactivity_timeout`, `timebox`) setzen, sonst gilt aal2 so lange wie das Refresh-Token
- Erster Admin per Runbook (ADR 005); beim Account löschen (M9) nachweisen, dass MFA-Faktoren und Rollen mitgelöscht werden

## Nachtrag M3: QA-Funde F1–F10 – 2026-10-30

Bericht: `docs/QA-REPORT.md`, Abschnitt „M3 – Abnahme“.

### Geändert
- **F1 Ohne JavaScript:** Konto, „Meine Anzeigen“, „Neu“ und „Bearbeiten“ rendern blockierend (`export const instant = false`, keine Suspense-Grenze um den Inhalt). Vorher kam der Inhalt gestreamt in `<div hidden>` und erschien nur mit JS. Die Fotoauswahl ist ohne JS gesperrt, `<noscript>` nennt den Grund. **Regel für M5:** Öffentliche Seiten dürfen ihren Hauptinhalt nicht hinter einer Suspense-Grenze streamen, die erst ein Skript einsetzt.
- **F2 Leerraum:** neue Funktion `private.trim_all` (dieselben Zeichen wie `String.prototype.trim`) für Titel, Alt-Text, Textattribute, PLZ/Ort und die Pflichtlänge der Beschreibung (Migration `listing_whitespace`). Zod zählt Längen in Codepoints wie `char_length`. Neue gemeinsame Fälle in `listing_rules.json`, ADR 013 mit Zeichenliste (auch für iOS).
- **F3 Preis:** Ohne gespeicherten Preis ist keine Option vorgewählt. Ein eingetragener Betrag ohne gewählte Option gilt als Betrag, bei „Keine Angabe“/„Auf Anfrage“ mit Betrag gibt es den Fehler `price_conflict`. Die Option heißt „Betrag angeben“.
- **F4 Aufräumen:** `e2e/cleanup.ts` löscht Testkonten samt Dateien (`listings.spec.ts`, `qa-m3.spec.ts`); `08_storage` zählt nur Dateien der eigenen Testnutzer.
- **F5 Art und Richtung:** In Prüfung, aktiv und pausiert stehen sie fest (gesperrt mit Hinweis). Für eine andere Art gibt man eine neue Anzeige auf.
- **F6 Entwurf löschen:** Fotodateien werden nur entfernt, wenn die Anzeige beim Lesen noch ein Entwurf ist.
- **F7 Barrierefreiheit/Fotos:** Hinweis auf übersprungene Fotos bleibt stehen; Ersatz-Alt-Text „Titel, Foto n von m“; Alt-Text-Felder nennen die Fotonummer; Originale über 40 MB oder 50 MP werden vor dem Dekodieren abgelehnt; kein `aria-invalid` auf `fieldset`.
- **F8 Doku:** SPEC v0.5 (3.1 Fotospalten, `listing_places`, `postal_prefix`, PLZ-Tabellen; 3.2 Attribute und Pflichtangaben, `species_targeted[]` entfällt; 3.3 Versatz nach ADR 006 v2), Glossar mit Attributen, Auswahlwerten und Preiseinheiten, ADR 011 (CORS `*` begründet, Aufräumen, Client-Grenzen).
- **F9 Wildart:** cs „Ostatní dravá zvěř“ ist laut Produkt korrekt und bleibt. Wildarten und Kreise sind im Web mit `cacheLife("days")` gecacht (siehe Cloud-Checkliste unten).
- **F10 Tests:** Fehlerzuordnung der DB in `lib/listing-errors.ts` mit Vitest; E2E für die Meldung „Tageslimit erreicht“; Integrationstests überspringen ohne Supabase, statt abzubrechen; ADR 013 warnt vor `seed.sql` auf Preview-Branches.

### Testen
- `supabase db reset && supabase test db` (424)
- `cd web && npm test` (153), `npm run test:integration` (111), `npm run test:e2e` (19)
- danach ohne Reset noch einmal `supabase test db`: bleibt grün (F4)
- manuell: Browser mit abgeschaltetem JavaScript, `/de/account/listings/new` → Assistent bis „Zur Prüfung absenden“

### Cloud-Checkliste (neu)
- Nach einer Migration mit Referenzdaten (Wildarten, Kreise, PLZ) den Web-Cache leeren bzw. neu deployen; sonst erscheinen Änderungen erst nach Tagen.
- Vor Supabase Branching den Seed für Preview-Branches abschalten (ADR 013, Rate-Limit).

### Bekannte Lücken
- Dieselbe Leerraum-Regel fehlt noch für Profilnamen, gespeicherte Suchen, Chatnachrichten und Moderationsgründe (`btrim`); sie folgt mit M6/M7/M4.
- `maxLength` im Browser zählt UTF-16-Einheiten: Titel aus vielen Emoji kürzt der Browser früher als die DB erlaubt (harmlos, strenger).
- `/account/profile`, `/welcome`, `/login` und `/auth/confirm` (M2) streamen ihren Inhalt weiter und sind ohne JavaScript leer. Sie gehören nicht zu M3; Umstellung wie bei F1, sobald sie angefasst werden.

## Nachtrag M3: Dev-Server und Wildart – 2026-10-30

### Geändert
- **Web:** `allowedDevOrigins: ["127.0.0.1"]` in `next.config.ts`; vorher blieb `next dev` unter `127.0.0.1` in einer HMR-Schleife („Compiling“)
- **Migration `species_other_predators`:** neue Wildart `other_predators` („Sonstiges Raubwild“, en/cs/pl im Glossar, cs/pl ungeprüft)

### Testen
- `supabase db reset && supabase test db` (Wildartenzahl jetzt 15)
- Dev-Server neu starten (Wildarten sind einige Tage gecacht), dann Assistent → „Details“: „Sonstiges Raubwild“ steht in der Liste
- `http://127.0.0.1:3000/de` lädt ohne Reload-Schleife

## M3 Anzeigen erstellen (Web) – 2026-10-30

### Geändert
- **Doku:** Plan `docs/plans/M3-plan.md` mit Architekt-Reviews; ADR 006 (Standortverfremdung v2), ADR 011 (Fotoverarbeitung), ADR 012 (Postleitzahlen), ADR 013 (Anzeigenregeln, Vertrag für Web und iOS); SPEC 3.3 und 7; Glossar (Arten, Richtungen, Status)
- **Migrationen:**
  - `listing_location_v2`: verfremdeter Punkt je Besitzer und Kreis (HMAC, Secret im Vault, Fingerprint)
  - `listing_photo_processing`, `photo_processing_function`: privater Eingang nur für JPEG, verarbeitete Bilder nur vom Server, Tageslimit, höchstens 3 Verarbeitungsversuche
  - `postal_codes`, `postal_codes_data`: PLZ DE (OpenStreetMap, VG250) und AT (Statistik Austria), Generator mit Prüfsummen unter `supabase/data/postal_codes/`
  - `listing_places`: PLZ und Ort je Anzeige, nie öffentlich; öffentlich nur `postal_prefix`; RPC `set_listing_location`
  - `listing_rules`: Attribute je Art, Preisgrenzen, Bereitschaftsprüfung am Ende der Transaktion, Legal-Gate `RV001`, Rate-Limit `RV002` (3 bzw. 10 in 24 h), Freigabe-Hash, Admin an der eigenen Anzeige = Besitzer
  - `listing_content_hints`: Hinweis auf Waffen- und Munitionsbegriffe in 4 Sprachen
  - `reorder_listing_photos`: Reihenfolge der Fotos in einem Schritt
- **Edge Function `process-listing-photo`:**
  - vendored JPEG-Codec aus imagescript 1.3.0
  - strenger Header-Parser, Grenzen 8 MP Baseline und 5 MP progressiv
  - entfernt alle Metadaten, `deno.lock`, CI-Job `functions`
- **Web:**
  - „Meine Anzeigen“ (`/account/listings`) mit Status, Ablehnungsgrund, Zurückziehen, Pausieren, Fortsetzen und Entwurf löschen
  - Assistent `/account/listings/new` und `/[id]/edit` mit 6 Schritten: Grunddaten, Ort, Details, Fotos, Preis und Zeitraum, Vorschau und Absenden
  - Fotos werden im Browser nach JPEG gewandelt und verkleinert; HEIC wird abgelehnt
  - Services `listings`, `regions`, `photos`; Zod-Regeln mit gemeinsamen Fixtures (`supabase/tests/fixtures/listing_rules.json`); Preisumrechnung ohne Gleitkomma
- `supabase/seed.sql` hebt das Anzeigen-Limit nur lokal an (API- und E2E-Tests)
- **Neue Abhängigkeiten,** nur in der Edge Function:
  - JPEG-Codec (WASM) aus imagescript 1.3.0, vendored, MIT
  - `@supabase/supabase-js` 2.117.3
  - Begründung in ADR 011
- Im Web keine neuen Abhängigkeiten.

### Wie testen
```sh
supabase stop && supabase start      # Neustart nötig: config.toml (Edge Function) geändert
supabase db reset && supabase test db   # 410 Tests
# Deno-Tests der Function (Deno aus Docker, keine Installation nötig)
docker run --rm -v "$PWD/supabase/functions:/fn" -w /fn/process-listing-photo denoland/deno:2.1.4 \
  sh -c "deno task check && deno lint && deno task test"   # 24 Tests
cd web
npm run lint && npm run typecheck && npm test   # 143 Vitest-Tests
npm run test:integration             # 104 API-Tests, u. a. Fotoverarbeitung, Regeln, Parität DB/Zod
npm run test:e2e                     # 10 Kernflows, davon 3 Inserieren
```
Manuell: `npm run dev`, anmelden, „Mein Konto“ → „Meine Anzeigen“ → „Anzeige aufgeben“. Freigeben kann nur die Moderation, ab M4 im Admin-Bereich. Bis dahin geht es lokal so: `update listings set status = 'active', expires_at = now() + interval '30 days' where id = '…'` in Studio.

### Akzeptanz
- [x] Assistent für alle 5 Arten (E2E: Pacht vollständig mit Foto, die anderen 4 über die Pflichtfeld-Prüfung)
- [x] Foto-Upload: Verkleinerung im Browser, höchstens 8 Fotos, Metadaten serverseitig entfernt (Deno-Tests, `photo-processing.test.ts`; über den ganzen Weg mit JPEG/GPS und WebP/EXIF in `qa-m3.spec.ts`, Spike-Auflage 5 damit erfüllt)
- [x] Preisfeld mit Währung, Umrechnung in `price_minor` ohne Gleitkomma (Vitest, Grenzen wie in der DB)
- [x] Entwurf wird nach jedem Schritt gespeichert; Absenden setzt `pending_review` (E2E, `listings.test.ts`)
- [x] Anzeige erscheint in „Meine Anzeigen“ mit Status, ohne Aktion zum Freischalten (E2E)
- [x] Pflichtfelder je Art werden validiert: in DB und Zod mit denselben Feldcodes (`17_listing_rules`, `listing-rules-parity.test.ts`, E2E)
- [x] Pflichtpunkte des Plans: Standort nicht herausmittelbar (`12_location`, `location.test.ts`); der Nutzer setzt nie selbst `active` (Statusmatrix in `17_listing_rules`, `listings.test.ts`)
- [x] Texte in 4 Sprachen. cs/pl sind ungeprüft (Glossar).

### Bekannte Lücken
- **iOS (I4):** Inserieren fehlt in der App. Der Vertrag steht in ADR 011, 012 und 013.
- **Freigabe:** Der Admin-Bereich folgt in M4. Dort kommen auch die Moderations-Detailansicht mit PLZ und die Markierung über die Waffenbegriffe.
- **Fotoverarbeitung in der Cloud:** Die Messung in eu-central-1 steht noch aus (Spike-Auflage 3). Sie ist Blocker für den Go-live.
- **Aufräumjob (M9):**
  - verwaiste Eingangsdateien nach Abbrüchen
  - Dateien ohne Zeile
  - Entwürfe nach 12 Monaten Inaktivität, mit Hinweis vorab (SPEC 7.3)
- **Seite „Datenquellen“** mit ODbL-Download der PLZ-Tabelle folgt mit M5/M9. Die Namensnennung steht bereits am PLZ-Feld.
- **Karte:** M3 nutzt nur den Kreis. Die Verfremdung des Punkts ist gebaut und getestet, eine Kartenauswahl gibt es noch nicht (SPEC 7.10).
- **Märkte CH, CZ, PL:** Dort gibt es noch keine Kreise und PLZ, deshalb ist das Inserieren nur in DE und AT möglich.
- **Ohne JavaScript:** Fotos lassen sich nur mit JavaScript hochladen. Alle anderen Schritte gehen ohne (seit dem QA-Nachtrag tatsächlich, siehe dort F1).
- **Pflichtangaben je Art:** Der Anwalt prüft sie noch (SPEC 7.2).

## M2 Auth und Profil (Web) – 2026-10-29

### Geändert
- SPEC v0.4, ADR 010 (Anmeldung, Session, AGB-Zustimmung, CSP), ADR 002 (Cloud verschoben), Glossar „Konto und Anmeldung“
- Migration `legal_acceptances`:
  - RPCs `accept_legal` und `legal_status`
  - DB-Gate `private.has_accepted_current_legal()`
  - Versionen in `app_settings`
- `supabase/config.toml`:
  - Bestätigung aktiv, OTP 10 Minuten
  - Redirect-URLs nur für `/*/auth/confirm` und `/*/auth/callback`
- Mailvorlagen `confirmation` und `magic_link` in 4 Sprachen (Link und Code)
- Web:
  - Session-Refresh im Proxy, geschützte Pfade, geprüfte Rücksprungziele
  - Login per Code und Link: Code anfordern und prüfen im Browser, Link bestätigt erst per Button
  - Logout
  - Onboarding `/welcome` mit Profil und AGB-Häkchen
  - `/account`, `/account/profile`
  - Sign in with Apple hinter `NEXT_PUBLIC_AUTH_APPLE_ENABLED`
  - Platzhalterseiten Nutzungsbedingungen und Datenschutz (`noindex`)
  - feste CSP
- Service-Schicht `web/lib/services/{auth,profile,legal,gate}.ts`, Zod-Schemas in `web/lib/validation/`
- Neue devDependency `@playwright/test` 1.64.1, CI-Job `e2e` in `web.yml`

### Wie testen
```sh
supabase stop && supabase start      # Neustart nötig: config.toml und Mailvorlagen wurden geändert
supabase db reset && supabase test db   # 240 Tests
cd web
npm run lint && npm run typecheck && npm test   # 68 Vitest-Tests
npm run test:integration             # 40 API-Tests gegen die lokale Supabase (Storage, PostgREST, Auth, Mails)
npx playwright install chromium      # einmalig
npm run test:e2e                     # 7 Kernflows; nutzt einen laufenden Dev-Server oder startet einen
```
Manuell: `npm run dev`, dann http://localhost:3000/de/account öffnen. Die Seite leitet auf den Login um. Die Mail kommt in Mailpit unter http://127.0.0.1:54324 an.

### Akzeptanz
- [x] Registrieren (per Link und per Code), ausloggen, wieder einloggen (per Code und per Link): `e2e/auth.spec.ts`
- [x] Profil bearbeiten, inklusive gewerblich mit Firmenname und Wechsel zurück auf privat (E2E, Vitest, `02_profiles`)
- [x] Geschützte Seiten leiten auf den Login um und kehren danach zum Ziel zurück, fremde Ziele werden ignoriert (E2E, Vitest)
- [x] AGB-Zustimmung ist Pflicht und je Version gespeichert, eine neue Version verlangt erneute Zustimmung (`10_legal`, API-Tests; im UI von der QA manuell geprüft, kein E2E)
- [x] Session-Handling mit `@supabase/ssr`: Refresh im Proxy, `getClaims` per JWKS (ES256)
- [x] Texte in 4 Sprachen. cs/pl sind ungeprüft (Glossar).

### Bekannte Lücken
- **Sign in with Apple** ist eingebaut, aber aus. Es fehlt ein Apple-Developer-Account (SPEC 7.1), deshalb ist es nicht E2E-getestet.
- **Account löschen**, E-Mail ändern, Datenexport und Benachrichtigungen folgen in M9. Bis dahin ist die UGC-Pflicht „Account löschen“ im Web offen.
- **Captcha** fehlt noch, bis dahin schützen nur die Rate-Limits von Supabase. Die Captcha ist harter Punkt der Release-Checkliste vor dem Go-live.
- **Cloud-Projekt** noch nicht verbunden (ADR 002). Checklisten in ADR 005 und 010.
  - Lokal gilt ein Mail-Abstand von 5 s, in der Cloud 60 s.
  - Die Cloud braucht eigenes SMTP über einen EU-Anbieter (SPEC 7.11).
- **iOS (I1):** Login per Code, `accept_legal(…, 'ios')` und Onboarding fehlen noch und werden in I1 nachgezogen.
- `script-src 'unsafe-inline'` bis zur Nonce-CSP in M4 (`/admin`) bzw. M10.
- Rechtstexte sind Platzhalter, bis der Anwalt liefert.
- Die Sprache in Kopfzeile und Formularen folgt der URL. Die Profilsprache steuert nur die Mails (Cookie für die Locale: QA M0 F7, M9).

### Nachtrag nach QA und Architekten-Review (2026-10-29)
Berichte: `docs/QA-REPORT.md` (M2) und `docs/reviews/M2-architekt.md`.
- **Keine Passwörter (QA F1, hoch):** Supabase Auth nahm trotz passwortloser App Passwörter an, mit Folge Kontoübernahme vor der Registrierung. Der Trigger `discard_password` leert jetzt jeden Passwort-Hash in `auth.users`.
- **Mailvorlagen (Architekt 1):** Die Sprache im Link ist je Zweig fest. Ein API-Test prüft über Mailpit die Kodierung.
- **Anmeldeprüfung (Architekt 2):** Ein Vitest erzwingt sie in jeder geschützten Seite und Server Action.
- **Session-Erneuerung (Architekt 3):** Ein E2E prüft das abgelaufene Access-Token und die rotierten Cookies auf dem Redirect.
- **XSS-Hygiene (Architekt 4):** ADR 010 nennt jetzt, dass das Refresh-Token per JS lesbar ist. ESLint verbietet `dangerouslySetInnerHTML`.
- **Fehlercode `RV001` (Architekt 9):** Er meldet die fehlende Zustimmung (`private.require_current_legal()`), damit Web und iOS ihn ab M3 auswerten können.
- **Footer (QA F3, Architekt 11):** Impressum (Platzhalter), Datenschutz und Nutzungsbedingungen sind auf jeder Seite verlinkt, beim Login steht ein Datenschutz-Hinweis.
- **API-Tests (Auflage M1, QA F6):** `web/integration/` läuft in der CI im Job `e2e`. Die pgTAP-Zählungen sind unabhängig von E2E-Resten.
- **Gesperrte Konten (QA F4):** Sie ändern ihr Profil nicht mehr und sehen einen klaren Hinweis.
- **Metadaten (Architekt 7):** Kein Anzeigename aus `user_metadata` mehr, ADR 008 sieht einen Löschjob für nie bestätigte Konten vor (M9).
- **Konten-Aufzählung (QA F2):** Die Aufzählung über die Auth-API bleibt als Restrisiko bis zur Captcha in ADR 010 dokumentiert.

Noch offen (vor dem ersten Deploy bzw. später):
- Captcha mit ADR, Cloud-Checkliste vervollständigen (Architekt 5), Link-Bestätigung und IP-Limit in Staging prüfen (QA F5)
- Mail-Sprache per DB-Trigger statt Client-Aufruf (Architekt 10)
- `otp_length` vor I1 (Architekt 6)
- Apple-Token-Widerruf bei Löschung vor M9/I6 (Architekt 8)
- CI-Traces und Rate-Limits der E2E-Suite (Architekt 14)
- Kleinigkeiten aus Architekt 15 und 16

## M1 Datenbank und Sicherheit – 2026-10-29

### Geändert
- SPEC v0.3 mit den Entscheidungen zu Startregion (7.4), Retention (7.3) und Pausieren/Fortsetzen (3.4); ADRs 005–009
- 9 Migrationen unter `supabase/migrations/`:
  - Fundament: Enums, Schema `private`, Admin-Rolle mit 2FA, Access Token Hook, `app_settings`
  - `profiles` mit `public_profiles`
  - Regionen DE/AT (16 + 401, 9 + 94) und 14 Wildarten
  - Anzeigen mit Statuslogik, Standortverfremdung, Fotos und Wildarten
  - Favoriten und Suchaufträge
  - Chat und Blockieren
  - Meldungen, Verifizierungen, Bewertungen (gesperrt), Geräte, Audit-Log
  - Storage-Buckets mit Policies
- `supabase/data/regions/`: Generator, Quellen und Lizenzen
- pgTAP-Tests unter `supabase/tests/` (nach Review 205), dazu ein Meta-Test: jede Tabelle hat RLS und eine Policy, `private` ist gesperrt
- CI `supabase.yml`: `db reset`, `test db`, Prüfung der generierten Typen, `db lint`
- `web/lib/supabase/database.types.ts` (`npm run gen:types`), Server-Client typisiert

### Wie testen
```sh
supabase stop && supabase start      # Neustart nötig: config.toml (Hook, auto_expose) wurde geändert
supabase db reset                    # alle Migrationen inkl. Regionendaten
supabase test db                     # 205 Tests
supabase db lint -s public,private --level warning
cd web && npm run gen:types && git diff --exit-code lib/supabase/database.types.ts
```

### Akzeptanz
- [x] Nutzer A liest keine Nachrichten von B (`06_chat_blocks`)
- [x] Nutzer A liest keine Verifizierungsdokumente von B, weder in der Tabelle (`07_trust_audit`) noch im Bucket (`08_storage`, zusätzlich über die Storage-API geprüft)
- [x] Nutzer A liest keine Entwürfe von B (`04_listings`)
- [x] Migrationen für alle Tabellen aus SPEC 3, Enums, Indizes, Regionen DE/AT und Wildarten
- [x] RLS-Policies mit automatisierten Tests

### Nach Review (Architekt und QA, docs/QA-REPORT.md)
- `service_role` hat CRUD-Rechte (Server-Pfade). API-Rollen haben kein TRUNCATE/REFERENCES/TRIGGER mehr.
- Profile:
  - Fallback-Name ist „Nutzer“.
  - Öffentlich erscheinen nur Anbieter mit öffentlicher Anzeige, dazu sehen Chatpartner einander.
  - Öffentlich sichtbar ist nur „verifiziert“.
- Fotos:
  - `storage_path` ist an Besitzer und Anzeige gebunden.
  - Upload erst nach Registrierung, das Limit von 8 gilt damit auch im Bucket.
  - Verwaiste Dateien sind nicht lesbar.
- Gerätetoken nur noch per RPC `register_device`.
- Kein GraphQL. Fremde Sperren sind nicht abfragbar.
- Chats bleiben beim Löschen einer Anzeige erhalten.
- Gesperrte Nutzer löschen keine Anzeigen, Admins entfernen per `removed`.
- Moderatoren-IDs sind für Nutzer unsichtbar.
- Admins geben keine eigenen Anzeigen frei.
- 205 pgTAP-Tests.

### Bekannte Lücken
- **Für Web-Code (M2):** `reports` und `verifications` haben Spalten-GRANTs. `select=*` schlägt dort fehl, Spalten müssen ausdrücklich genannt werden.
- **Cloud-Checkliste für M2:** steht in ADR 005.
- **Performance:** `is_active_user()` läuft in der öffentlichen Anzeigen-Policy pro Zeile. Vor M5 messen und bei Bedarf denormalisieren.
- **Standort:** Über mehrere Anzeigen desselben Reviers lässt sich der Originalpunkt herausmitteln. Bis M3 offen, siehe ADR 006.
- Rechtlich zu prüfen: Retention-Fristen und Löschregeln sind Platzhalter (ADR 008, SPEC 7.2/7.3).
- Die Lösch- und Retention-Jobs fehlen noch (M9). Gelöschte Datensätze hinterlassen bis dahin Dateien in Storage.
- `attributes` wird in M1 nur auf seine Form geprüft. Pflichtfelder je Anzeigenart folgen in M3.
- Für TOTP-2FA braucht es in M4 noch `enroll`/`verify`. In M1 wird `aal2` nur in Tests simuliert.
- Rate-Limits und Spam-Erkennung für Nachrichten fehlen noch (M7). Meldungen sind auf 20 pro 24 h begrenzt.
- cs/pl-Namen (Wildarten, Länder) sind ungeprüft (SPEC 7.6).
- Die Seite „Datenquellen“ mit den Pflichtvermerken BKG und Statistik Austria fehlt noch (M5/M9).
- In der Cloud müssen Hook, `auto_expose_new_tables = false` und die Buckets in M2 ebenso eingerichtet werden.
- Die CI ist noch nicht gelaufen, weil das GitHub-Remote fehlt.

## M0 Fundament – abgeschlossen 2026-10-29

### Geändert
- `.gitignore` um Build-, Test- und Secret-Muster ergänzt
- Doku-Gerüst: `CHANGELOG.md`, `GLOSSARY.md`, ADRs 001–004
- Web-Grundgerüst: Next.js 16.4.1, TypeScript strict, Tailwind 4, ESLint, Vitest, Node 24 LTS
- i18n mit next-intl 4.14.9:
  - `/` leitet auf `/de` um, bei passendem `Accept-Language` auf die erkannte Sprache
  - lokalisierte Startseite und 404
  - `hreflang`, Canonical, Sprachumschalter
  - Test prüft gleiche Keys in allen Sprachen
- Env-Validierung mit Zod (`web/lib/env.ts`), `web/.env.example`, Supabase-Server-Client (nur anon-Key, `server-only`)
- Security-Header: nosniff, Referrer-Policy, X-Frame-Options, Permissions-Policy, HSTS nur in prod
- Lokales Supabase (`supabase/config.toml`, leere `seed.sql`), Verbindungs-Check `npm run check:supabase`
- CI (`.github/workflows/web.yml`): Lint, Typecheck, Test, Build, Secret-Guard

### Wie testen
Voraussetzungen: Node 24 (`web/.nvmrc`), Docker läuft, Supabase-CLI installiert.

```sh
supabase start                       # im Repo-Root
cp web/.env.example web/.env.local   # NEXT_PUBLIC_SUPABASE_ANON_KEY = "Publishable key" aus `supabase status`
cd web && npm ci
npm run dev                          # http://localhost:3000 → /de; /en, /cs, /pl prüfen
npm run lint && npm run typecheck && npm test
npm run check:supabase               # zwei ✓
```

### Akzeptanz
- [x] `npm run dev` zeigt die lokalisierte Startseite in allen 4 Sprachen
- [x] Lint, Typecheck und Beispieltests (12) grün; `npm run build` ohne Warnungen
- [x] Supabase-Verbindung funktioniert (`check:supabase`: Auth-Health 200, anon-Key akzeptiert; falscher Key → Fehler)

### Nach QA (docs/QA-REPORT.md, F1–F9)
- 404: statische, mehrsprachige `global-not-found` (serverseitig, `noindex`, ohne Canonical); `/foo.png` und `/api` enden in der 404
- hreflang nur noch aus dem HTML, kein `Link`-Header der Middleware
- Secret- und service_role-Keys in `NEXT_PUBLIC_SUPABASE_ANON_KEY` werden abgelehnt (Build und `check:supabase`)
- CI: erweiterter Secret-Guard, Build-Cache
- Testen zusätzlich: `curl -I http://localhost:3000/de/gibtsnicht` → 404; Build mit `sb_secret_…` als anon-Key bricht ab

### Bekannte Lücken
- cs/pl-Texte sind von Muttersprachlern ungeprüft (SPEC 7.6).
- Kein iOS-Gerüst: Das Xcode-Projekt wird in I1 direkt in Xcode angelegt (Planänderung, ADR 001).
- Keine CSP: Sie folgt mit Auth und Drittanbietern (M2/M10).
- Kein Cloud-Projekt: Supabase läuft nur lokal und wird ab M2 verbunden (ADR 002).
- Die CI ist noch nicht gelaufen, weil das GitHub-Remote fehlt.
- Die 404 für unbekannte Pfade ist mehrsprachig statt in der angefragten Sprache. Explizite `notFound()`-Aufrufe in Seiten nutzen die lokalisierte `[locale]/not-found.tsx`.
- QA F4 (Glossar cs/pl) und F7 (Locale-Cookie vor Consent, M9) sind offen.
