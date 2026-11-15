# Changelog

Pro Backlog-Schritt ein Eintrag: was geändert wurde, wie man es testet, bekannte Lücken.

## M10 Web-Release: Plan und Checkliste – 2026-11-15

### Geändert (nur Dokumentation)
- Neu `docs/plans/M10-plan.md`: Entscheidungen E1–E9 (Inhaber, Domain, Hosting, Kartendatei, Mail-Anbieter, Supabase-Plan, Monitoring, Stage, Testnutzer) mit Vorschlag und Arbeitspakete 1–16.
- Neu `docs/WEB-RELEASE.md`: Release-Checkliste (Akzeptanz M10) mit allen Cloud- und M10-Auflagen aus ADR 002, 005, 006, 010, 011, 014–022.

## Name Huntery in internen Texten – 2026-11-15

### Geändert (nur Dokumentation und Kommentare)
- Überschrift von `CLAUDE.md` und `docs/SPEC.md`: „Huntery (vorher Arbeitstitel Revier)“.
- Agentenbeschreibungen unter `.claude/agents/` und Kommentare in `supabase/config.toml` nennen „Huntery“.
- Bewusst unverändert: bereits angewandte Migrationen, Repo- und Ordnername `revier`, Container-Namen (`supabase_db_revier`), Paketname `revier-web`; frühere Changelog-, QA- und Review-Einträge.

## Name Huntery in E-Mails – 2026-11-15

### Behoben
- E-Mails nannten die Plattform noch „Revier“. Jetzt „Huntery“ in: Absendername (`_shared/mail/mailer.ts`), Betreff der Anmelde-Mails (`supabase/config.toml`), Vorlagen `confirmation.html` und `magic_link.html`, allen Betreffzeilen und Texten von `send-search-notifications` (Suchaufträge, Moderation, Verifizierung, Konto) und `send-chat-notifications`, in 4 Sprachen.
- Name des TOTP-Faktors in der Authenticator-App (Admin-MFA): „Huntery …“ statt „Revier …“.
- Erwartungen in `web/integration/*` und `e2e/auth.spec.ts` angepasst. „Revier“ als Fachwort (Jagdrevier) und in Testdaten bleibt.

### Wie testen
- Lokale Supabase neu starten (`supabase stop && supabase start`), damit Betreff und Vorlagen greifen; Mails in Mailpit ansehen.
- Deno per Docker wie in der CI: `send-chat-notifications` 4 grün, `send-search-notifications` mit `_shared/mail` 33 grün.
- `npm run test:integration`: 282 grün; `integration/storage.test.ts` war im Gesamtlauf direkt nach dem Neustart einmal rot und einzeln 15/15 grün. `e2e/auth.spec.ts` 7 grün.

## Name Huntery statt Huntroy – 2026-11-15

Entscheidung des Menschen: Der Name lautet *Huntery*. Unterzeilen je Sprache, Claim und Logo bleiben.

### Geändert
- Alle Texte in de/en/cs/pl (Wortmarke, Seitentitel, „Mein Huntery“, Cookie-Banner, Vorschaubild-Alt-Text …), DeepL-Overrides und -Kontext, globale 404-Seite, E2E-Test, `DESIGN.md`, `SPEC.md`. Frühere Changelog-Einträge bleiben, wie sie waren.

### Offen
- Markenrecherche und Domain für *Huntery* (SPEC 7.1, Mensch).
- E-Mail-Texte nennen noch „Revier“ (siehe Eintrag „Namensreste“).

### Wie testen
- Kopf, Fußzeile und Tab-Titel auf `/de`, `/cs`, `/pl` ansehen; `m10a-text.spec.ts` (360 px, keine Überbreite) grün.

## Namensreste „Revier“ im Web – 2026-11-15

### Behoben
- Der alte Arbeitstitel stand noch als Produktname in 7 bis 8 Texten je Sprache: Willkommensseite, Waffen-Hinweis beim Inserieren, Meta-Beschreibungen von Liste und Anbieter, Cookie-Tabelle, Datenquellen; dazu der Titel der globalen 404-Seite. Jetzt überall „Huntroy“. cs: Anbieter-Beschreibung ohne die Fehlübersetzung „s obrázky“ (auch in den DeepL-Overrides).

### Offen
- Backend-Texte nennen noch „Revier“: Betreff und Vorlagen der Anmelde-Mails (`supabase/config.toml`, `supabase/templates/*.html`), Mail-Texte der Edge Functions (`send-search-notifications`, `send-chat-notifications`, `_shared/mail`). Eigener Schritt mit Deno-Tests.

### Wie testen
- `/de/welcome`, `/de/cookies`, `/de/datenquellen` ansehen; `m10a-text.spec.ts` und `cookie-inventory.spec.ts` grün.

## Eigene Illustrationen statt KI-Fotos – 2026-11-15

Entscheidung des Menschen: Bilder selbst zeichnen; Jäger mit Büchse und Trophäen dürfen gezeigt werden (Abweichung von SPEC M10a Schritt 1, `DESIGN.md` 8).

### Geändert
- Neu `web/scripts/illustrations.mjs`: erzeugt 6 SVG-Illustrationen und das Vorschaubild unter `web/public/static/brand/` (Silhouetten in Markenfarben: Hochsitz, Jäger mit Büchse, Hund, Rothirsch, Jagdhütte mit Geweih, Gesellschaft in Signalwesten).
- Startseite: Banner mit Illustration statt Höhenlinien-Muster; ab `sm` als Hintergrund mit waldgrünem Verlauf, mobil als Bildstreifen unter dem Text.
- Kategorieseiten (`/de/jagdpacht` …): eigenes Kopfbild je Anzeigenart unter der H1.
- `og:image` für alle Seiten ohne eigenes Foto, auch für Anzeigen ohne Foto; Alt-Text `Metadata.ogImageAlt` in 4 Sprachen (cs/pl auch in den DeepL-Overrides).
- `/static/brand/*` ein Jahr unveränderlich gecacht (Dateinamen mit `.v1`).
- `docs/BILDVORGABEN.md` entfällt; Doku in `DESIGN.md` 11, Lizenzzeile in `DESIGN.md` 7.

### Wie testen
- `/de`, `/de/trophaeenjagd`, `/de/begehungsschein` bei 360 und 1280 px ansehen.
- `npx playwright test e2e/illustrations.spec.ts` (Bilder geladen, dekorativ, mobil unter dem Text, Kopfbild je Art, og:image inkl. Anzeige ohne Foto, Cache-Header).
- Lighthouse mobil: Start 93, Kategorie 93, Suche 94.

## Bildvorgaben für KI-Markenfotos – 2026-11-15

### Geändert (nur Dokumentation)
- Neu `docs/BILDVORGABEN.md`: Regeln für alle Bilder (Inhalt, Look, Rechte, Lieferung, Negativ-Prompt) und 8 Bilder mit Größe, Dateiname, Prompt und Alt-Text: Startseiten-Banner (breit und Handy), je ein Bild für die 5 Anzeigenarten, Platzhalter für Anzeigen ohne Foto, Vorschaubild für soziale Netzwerke.
- `DESIGN.md`: offener Punkt Markenfotos und Lizenzzeile auf KI-Fotos umgestellt (Entscheidung 2026-11-15).

### Offen
- Bilder erzeugen (Mensch), danach Einbau (Claude, Ablauf am Ende von `BILDVORGABEN.md`).

## VoiceOver-Vorprüfung (Web) – 2026-11-15

Automatisch geprüft, was ein Screenreader vorliest (axe mit WCAG 2.2 AA und Best Practice, Landmarks, Überschriften). Der Durchgang mit VoiceOver selbst bleibt beim Menschen (Checkliste `docs/DESIGN.md` Abschnitt 10).

### Behoben
- **Grüne Leiste außerhalb jeder Landmark** (Claim, Shop-Link): Leiste und Kopf stehen jetzt in einem `<header>` (Banner).
- **H2 vor der H1** auf der Startseite: Die Kategorien-Navigation heißt per `aria-label` statt über eine versteckte H2.
- **Karte dreimal als „Karte der Anzeigen“ benannt** (äußerer Bereich, Container, Zeichenfläche): nur die fokussierbare Zeichenfläche trägt Rolle und Namen.
- **Sprachlinks zu klein** (20 px, WCAG 2.5.8 verlangt 24 px): jetzt 32 px wie der Shop-Link.
- **Neu: „Zum Inhalt springen“** als erstes Tab-Ziel (unsichtbar bis zum Fokus), jede Seite hat `<main id="main">`. Text in 4 Sprachen (`Header.skipToContent`, cs/pl auch in den DeepL-Overrides).

### Tests
- Neu `web/e2e/voiceover.spec.ts`: Sprunglink (de, pl), je eine Landmark Banner/Main/Contentinfo, H1 als erste und einzige H1, axe mit Best Practice auf 7 Kernseiten inkl. Kartenansicht, Karte genau einmal benannt.
- `m10a-text.spec.ts` prüft axe jetzt auch mit WCAG 2.1/2.2 AA und Best Practice (alle öffentlichen Seiten, Konto, Inserieren, Nachrichten, 4 Sprachen).
- `qa-m6-nachpruefung.spec.ts` findet die Karte über `[data-listings-map]` statt über das entfernte `aria-label`.
- Komplette E2E-Suite: 270 grün; der eine rote Test (`qa-m7.spec.ts` F2) war auch auf älteren Ständen rot und ist im eigenen Commit robuster gemacht, die Datei danach 19/19 grün.

### iOS
- Noch keine App. Dort gilt dasselbe: VoiceOver-Labels für alle Buttons und Bilder, Überschriften als `.isHeader`, Karte einmal benannt.

## Name Huntroy und Unterzeile je Sprache – 2026-11-15

### Geändert
- **Name:** *Huntroy* statt *Reviro* (Reviro ist vergeben, Entscheidung 2026-11-15). Wortmarke HUNTROY, Seitentitel, „Mein Huntroy“, Startseiten-Label, Cookie-Banner, 404 ohne Sprache, DeepL-Kontext und Glossarname, `DESIGN.md`, `SPEC.md`.
- **Unterzeile** (`Brand.tagline`, Eyebrow über der Startseiten-Überschrift): de „Dein Marktplatz für Jagdgelegenheiten“, en „Hunting Opportunities & Classifieds“, cs „Lovecké nabídky a inzerce“, pl „Ogłoszenia i oferty łowieckie“. Von Hand je Sprache, DeepL überspringt den Schlüssel.
- Ältere Changelog-Einträge nennen weiter Reviro (Stand damals).

### Testen
- `cd web && npx playwright test e2e/m10a-text.spec.ts e2e/qa-m7-nachpruefung.spec.ts e2e/public.spec.ts` (43 grün, 360 px ohne Überbreite in 4 Sprachen)

### Offen (Mensch)
- Markenrecherche und Domain für *Huntroy* (SPEC 7.1), cs/pl-Unterzeile von Muttersprachlern prüfen.

## ADR 022 K7: Sprachwechsel mit geprüfter Filter-Query – 2026-11-15

### Geändert
- Beim Sprachwechsel (Sprachwahl im Kopf und `/api/locale` ohne JavaScript) wird die Query nicht mehr roh übernommen, sondern aus den geprüften Filtern neu gebaut: `utm_*`, ungültige Werte und die Blätter-Position (`cursor`) fallen weg; Filter, die der Pfad festlegt (Art, Region), stehen nicht doppelt in der Query. Suchtext und Kartenansicht bleiben.

### Testen
- `cd web && npx vitest run lib/public/locale-switch.test.ts` (9)
- `cd web && npx playwright test e2e/qa-m5.spec.ts e2e/cookie-inventory.spec.ts e2e/public.spec.ts e2e/map.spec.ts` (54 grün)
- Von Hand: `/de/suche?q=Bock&utm_source=x&view=map` öffnen, auf „English“ wechseln → `/en/search?q=Bock&view=map`.

## ADR 022 K6: COOP und browsing-topics – 2026-11-15

### Geändert
- Neuer Header `Cross-Origin-Opener-Policy: same-origin`; `Permissions-Policy` zusätzlich mit `browsing-topics=()`. Gilt überall, wo die Basis-Header gelten (auch Admin, Abbestellen, Foto-Links des Exports, Verifizierungsdokument).
- Nicht umgesetzt (M10): CSP-Berichte an eine eigene Route, HSTS-`preload`.

### Testen
- `curl -sI localhost:3000/de/login | grep -i -E "opener|permissions"`
- `cd web && npx playwright test e2e/auth.spec.ts e2e/qa-m8-nachpruefung.spec.ts e2e/qa-m9a-nachpruefung.spec.ts e2e/map.spec.ts e2e/admin.spec.ts` (37 grün)

## M10a Nacharbeit: Listenseite ≥ 90 – Übersetzungen nur noch in Teilen an den Browser – 2026-11-15

### Ursache
Das Layout gab mit `NextIntlClientProvider` alle Übersetzungen (rund 70 KB) an den Browser, durch Partial Prerendering sogar zweimal im HTML. Die Listenseite war dadurch 299 KB groß (69 KB komprimiert), und das erste Vorschaubild (LCP) wurde entsprechend später geladen.

### Geändert
- **Layout** gibt nur noch `LocaleSwitcher` weiter (`LAYOUT_CLIENT_NAMESPACES` in `web/lib/i18n/pick.ts`).
- **`ClientMessages`** (`web/components/i18n/ClientMessages.tsx`): Server-Komponenten legen diese Grenze mit den Namensräumen ihrer Client-Komponenten darum, an 15 Stellen (Suche speichern, Karten, Fotos und Punkt im Assistenten, Login, Bestätigen, Admin-2FA, Willkommen, Profil, Verifizierung, Konto löschen, Chat). Eine innere Grenze ersetzt die äußere, deshalb nennt sie alle Namensräume ihres Teilbaums.
- `DeletedNotice` auf der Startseite bekommt seinen Satz als Eigenschaft und braucht keine Übersetzungen im Browser.
- **Prüftest** `web/lib/i18n/client-messages.test.ts`: liest den Code und verlangt für jede Server-Datei, die eine übersetzte Client-Komponente einbindet (auch indirekt), dass deren Namensräume in ihrer Grenze bzw. im Layout stehen und existieren. `pickMessages` wirft bei unbekanntem Pfad (`pick.test.ts`).

### Messung (Lighthouse 12.8.2, Handy, `next start`, 6 Demo-Anzeigen mit je 3 Fotos wie in Schritt 7)
| Seite | Performance vorher → nachher | LCP | Gewicht |
|---|---|---|---|
| Liste `/de/jagdhelfer` (Median aus 5) | 89–90 → 91 | 3,7 → 3,6 s | 567 → 455 KB |
| Start `/de` | 93 → 94 | 3,1 s | 558 → 449 KB |
| Detail | 87 → 86 | 4,2 s | 625 → 558 KB |
| Start `/cs` | 87 → 90 | 3,6 s | 714 → 603 KB |

HTML der Liste: 299 → 145 KB (komprimiert 69 → 23 KB). Damit sind alle Ziele aus Schritt 7 erreicht (Start und Liste ≥ 90, Detail ≥ 85). Detail liegt im Rahmen der Messschwankung gleich. LCP bleibt über 2,5 s; das ist der Richtwert für Prod mit CDN und wird in M10 gemessen.

### Testen
- `cd web && npx vitest run lib/i18n`
- Komplette E2E-Suite (274 grün, inkl. rohe Schlüssel in 4 Sprachen in `m10a-text.spec.ts` und `saved-searches.spec.ts`)
- Messung: `npm run build && npx next start -p 3100`, dann `npx --yes lighthouse@12.8.2 http://localhost:3100/de/jagdhelfer --only-categories=performance`. Die Demo-Anzeigen (Konto `demo-perf@test.local`) liegen wieder lokal.

### Hinweis für neue Client-Komponenten
Wer `useTranslations` in einer Client-Komponente nutzt, muss den Namensraum an der Einbindestelle in `ClientMessages` nennen. Sonst schlägt der Prüftest fehl.

## M10a Nacharbeit: Claim in der Leiste oben (QA F2) – 2026-11-15

### Geändert
- **Claim** „Klare Linien. Wilde Freiheit.“ statt „Jagdgelegenheiten in DE · AT · CH · CZ · PL“ (Entscheidung 2026-11-15, Kandidat aus SPEC 4.1). en „Clear lines. Wild freedom.“, cs „Jasné linie. Divoká svoboda.“, pl „Wyraźne linie. Dzika wolność.“; cs/pl auch in `web/scripts/i18n-overrides.json`, damit ein DeepL-Lauf sie nicht überschreibt.
- Der Claim steht jetzt auch unter 640 px; bei 360 px rücken Shop-Link und Sprachwahl in eine zweite Zeile.

### Testen
- `npx playwright test e2e/m10a-text.spec.ts -g "öffentliche Seiten"`: je Sprache 14 Seiten bei 360 px ohne Überbreite, axe grün, Claim sichtbar.

### Offen
- cs/pl-Fassung von Muttersprachlern prüfen lassen (wie alle cs/pl-Texte).

## M10a Nacharbeit: DESIGN.md vollständig, Tokens für iOS übernehmbar (QA F11) – 2026-11-14

### Geändert (nur Dokumentation)
- **Typografie-Skala** mit Web-Klasse, Größe und Zeilenhöhe, Schrift und Gewicht, Verwendung und passender Dynamic-Type-Stufe für iOS.
- **Abstände, Schatten, Icons, Tippflächen, Fokus und Bewegung:** 4-px-Raster mit den üblichen Stufen, Seitenbreite und Rand, Schatten nur für schwebende Elemente, Icon-Raster und -Größen je Familie, 44 px für Bedienelemente (Chips und Checkbox-Zeilen 36 px, WCAG 2.5.8), Fokusregel, `prefers-reduced-motion`.
- **Abweichungen von der SPEC** (Abschnitt 8): keine Kategorie-Navigation im Kopf, Filter mobil aufklappbar (beide Entscheidung 2026-11-13, QA F1).
- **Zuordnung für iOS** (Abschnitt 9): Farbnamen für den Asset-Katalog, Schriften als variable TTF mit vollem Zeichensatz und `relativeTo:` für Dynamic Type, Umrechnung der Laufweite von em in pt, Radien und Abstände in pt, Icons als Template-SVG, Tippflächen, Reduce Motion.
- Veraltete Stand-Zeile ersetzt; Schatten-Tokens und Inter-Gewichte ergänzt.
- **Offen (Mensch):** Claim in der Leiste oben (QA F2) als Punkt 4 unter „Offene Punkte“; ob der Filter auf iOS als Blatt von unten kommt, entscheidet sich in I2.

### Testen
- `docs/DESIGN.md` gegen `web/app/globals.css` (`@theme`) und `web/components/ui/styles.ts` lesen; Styleguide `/de/styleguide` zeigt die Stufen.

## M10a Nacharbeit: eine Quelle für die Ablehnungsgründe (ADR 022 S3) – 2026-11-14

### Geändert
- **Domain `public.listing_reject_code`** mit den 9 Codes. `listings.reject_code` und die Kopie in `private.moderation_notifications` nutzen sie; der doppelte Check an der Tabelle entfällt. Ein neuer Code ändert künftig nur die Domain (neue Migration mit `alter domain`) und `REJECT_CODES` in `web/lib/moderation.ts`.
- **`resolve_reports`** vollständig in `20261114100000_listing_reject_code_domain.sql` (vorher verteilt auf zwei Migrationen), prüft gegen die Domain statt gegen eine eigene Liste. Fehlermeldung unverändert („Grund fehlt“, Feld `code`), Web und iOS brauchen keine Anpassung. Generierte Typen unverändert.
- **Tests:** neu `60_listing_reject_code_domain.test.sql` (10 Prüfungen: Spaltentypen, keine zweite Liste, Codes der Domain, unbekannter und fehlender Code, gültiger Code). `58` prüft die Domain statt des alten Checks. `moderation.test.ts` liest die jüngste Domain-Definition aus allen Migrationen. Die Testhilfe setzt für ältere Kartenpunkt-Tests den gültigen Code `other` statt `test`.
- **Test 55** zählt nur noch Dateien in den Ordnern der eigenen Testnutzer (eine verwaiste Datei aus einem E2E-Lauf machte ihn rot), wie zuvor bei `08`.

### Testen
- `supabase migration up`, dann `supabase test db` (alle 61 Dateien grün)
- `cd web && npx vitest run lib/moderation.test.ts`
- `cd web && npx playwright test e2e/admin-moderation.spec.ts e2e/reports.spec.ts e2e/qa-m9b.spec.ts e2e/qa-m9b-nachpruefung.spec.ts`

## Nacharbeit: polnische Mails duzen, Demo-Anzeigen entfernt – 2026-11-14

### Geändert
- **Polnische Mails** beginnen mit „Cześć,“ statt „Dzień dobry,“ (Entscheidung 2026-11-14, passend zum Du). Die übrigen Texte duzen bereits („masz“, „Twój“, „możesz“). Betrifft `send-chat-notifications/texts.ts`, `send-search-notifications/texts.ts` (2×) und `account_texts.ts`.
- **Demo-Anzeigen** (nur lokal, Konto `demo-perf@test.local`): zuerst an ihre Titel angepasst (vorher alle „Helfer, Gesuch“ ohne Preis und Wildarten, daher bei jedem Filter weg), danach auf Wunsch samt 54 Fotos gelöscht (Entscheidung 2026-11-14). Damit sind `02`, `04`, `26`, `31`, `32` lokal wieder grün. Für neue Lighthouse-Messungen müssen Demo-Daten neu angelegt werden.

### Testen
- Per Docker wie in der CI: `deno task check && deno lint && deno task test` in `send-chat-notifications` und `send-search-notifications`
- `supabase test db` mit `02`, `04`, `26`, `31`, `32` (lokal grün ohne Demo-Daten)

## M10a Nacharbeit: Filterleiste mit entfernbaren Chips – 2026-11-13

### Geändert
- **Filterleiste** über der Trefferliste (Suche, Kategorie, Region; Liste und Karte): je aktivem Filter ein Chip mit ×; der Chip ist ein Link auf dieselbe Suche ohne diesen Filter, also ohne JavaScript bedienbar. Preis (Währung, Betrag, Einheit), Fläche und Zeitraum fallen je als Gruppe weg, Wildarten einzeln. Danach wird neu geprüft, sodass eine Preis- oder Relevanz-Sortierung ohne Voraussetzung mit wegfällt. Ab zwei Chips „Alle entfernen“ (Angebot/Gesuch und Ansicht bleiben). Werte aus dem Pfad, Angebot/Gesuch (stehen in den Reitern) und die Sortierung bekommen keinen Chip.
- **Zähler am Filter-Knopf** (`ui.countBadge`, für Screenreader „3 Filter aktiv“).
- Der Hinweis „Gefiltert nach Kartenbereich. Bereich entfernen“ ist jetzt der Chip „Kartenausschnitt“; die Texte `Map.areaActive`/`areaRemove` sind entfernt.
- Logik in `lib/search/chips.ts`, Beschriftungen aus den Texten der Suchaufträge (`priceText`, `areaText`, `periodText` aus `describeFilters` herausgelöst). Komponente `components/public/FilterChips.tsx`, im Styleguide unter „Filterleiste“. Neue Texte in 4 Sprachen (`Public.filters.active/remove/clearAll/activeCount`, `Styleguide.filterBar`).
- Tests: `lib/search/chips.test.ts` (9), E2E „Filterleiste ohne JavaScript“ in `public.spec.ts`; `map.spec.ts` und `qa-m6.spec.ts` prüfen den Chip statt des alten Hinweises.

### Nicht umgesetzt
- **iOS:** noch keine App; dort soll der Filter-Bildschirm dieselben Gruppen als Chips zeigen.

### Testen
- `cd web && npx vitest run lib/search`
- `cd web && npx playwright test e2e/public.spec.ts e2e/map.spec.ts e2e/qa-m6.spec.ts`
- Von Hand: `/de/suche?q=Bock&region=DE-BY&species=roe_deer,wild_boar&cur=EUR&pmax=800&unit=per_year&sort=price_asc` öffnen, Chip „Preis“ entfernen (Sortierung fällt mit weg), dann „Alle entfernen“.

## M10a Nacharbeit: mittlere Bildgröße – 2026-11-13

### Geändert
- **Dritte Bildgröße** (1024 px lange Seite, JPEG Qualität 80): `process-listing-photo` schreibt jetzt Bild (2048), mittlere Größe und Thumbnail; das Thumbnail entsteht aus der mittleren Größe. Migration `20261113140000_listing_photo_medium.sql`: Spalte `medium_path` (vom Pfad-Trigger gesetzt, nur Server änderbar), `claim_photo_processing` liefert den Pfad, Storage-Lesefreigabe und Aufräumjob kennen die Datei.
- **Web:** `/api/photos/<id>/medium` (gleiche Sichtbarkeitsprüfung je Abruf); fehlt die Datei noch, liefert die Route das große Bild. Detailseite lädt das erste Foto als `medium` mit `srcset` (1024w/2048w). Löschen von Foto und Entwurf entfernt auch die mittlere Größe. `og:image` bleibt das große Bild.
- **Nachberechnen** für Fotos von vorher: `supabase/functions/process-listing-photo/backfill_medium.ts` (wiederholbar, überspringt vorhandene Dateien; Aufruf im Dateikopf). Lokal 18 Dateien erzeugt, zweiter Lauf 0. **Vor dem nächsten Deploy auf Staging/Prod einmal ausführen.**
- Tests: `59_photo_medium.test.sql` (Pfad, Spaltenrecht, Claim, Lesen nur verarbeitet, fremdes Löschen, Aufräumen), Pipeline-Tests für 1024 px und das Nachberechnen, E2E Detailseite (`src`/`srcset`) und sofortiges Verschwinden auch der mittleren Größe.

### Messung (wie Schritt 7: Lighthouse 12.8.2, Handy, `next start`, Median aus 3)
| Seite | Performance | LCP | Gewicht |
|---|---|---|---|
| Detail | 79 → 87 | 5,6 → 4,1 s | 905 → 625 KB |
| Liste | 89 → 89 | 3,8 s | 567 KB |

Detail erreicht das Ziel (≥ 85). Das erste Foto wiegt 126 statt 410 KB.

### Nicht umgesetzt
- **WebP:** Der vendorte Codec kann nur JPEG. WebP bräuchte einen zusätzlichen WASM-Encoder in der Edge Function (neue Abhängigkeit, mehr CPU-Zeit je Upload) oder die kostenpflichtige Bildtransformation von Supabase. Nach dem Messwert oben nicht nötig; Entscheidung offen.
- **iOS:** noch keine App; sie soll für Detailbilder ebenfalls `medium` laden.
- Liste bleibt bei 89 (Ziel 90), nicht Teil dieses Schritts.

### Testen
- `supabase migration up`, dann `supabase test db supabase/tests/59_photo_medium.test.sql`
- Edge Function per Docker: `deno task check && deno lint && deno task test` in `process-listing-photo`
- `cd web && npx playwright test e2e/public.spec.ts`

## M10a Nacharbeiten – 2026-11-13

### Geändert
- **Tschechische Mails duzen** (Anrede Du laut Entscheidung 2026-11-13): Gruß „Ahoj,“ statt „Dobrý den,“, „tvůj/tvoje/tvém“ statt „váš/vaše/vašem“, Verben in der 2. Person Singular. Betrifft `send-chat-notifications/texts.ts`, `send-search-notifications/texts.ts` und `account_texts.ts`. Das gemeinsame Label `Decisions.actions.report_handled` ist im Web, im Fixture `supabase/tests/fixtures/mail_labels.json` und als Override angepasst.

- **Wackelige Datenbank-Tests:** `08_storage` zählt jetzt in allen Buckets nur Dateien in den Ordnern der eigenen Testnutzer (vorher scheiterte er an Resten aus E2E- oder Messläufen). `57_qa_m9b_nachpruefung` Test 4 sortiert über die Meldungs-IDs statt über `created_at`, weil alle Meldungen in einer Transaktion denselben Zeitstempel haben.
- Bekannt: `02`, `04`, `26`, `31`, `32` setzen eine Datenbank ohne fremde öffentliche Anzeigen voraus und werden rot, solange z. B. die Demo-Anzeigen aus Schritt 7 lokal liegen. In der CI (frische Datenbank) grün.
- **Tokens statt fester Werte** (QA F3): Schriftgrößen (`text-micro`, `text-meta`, `text-compact`, `text-price`, `text-title`, `text-logo-sub`), Laufweiten, Seitenverhältnisse (`aspect-photo`, `aspect-hero`), Radien der Chat-Blase, Schatten und Farbe der Kartenmarker, Kartengrund und Rahmen der Suchleiste als Tokens in `globals.css`; 73-mal `rounded` durch `rounded-btn` ersetzt (gleicher Wert). Pixelgleich (Kopfzeile vor/nach verglichen). Verbleibende Klammerwerte sind Layout und in `DESIGN.md` („Tokens“) begründet.
- **Styleguide vervollständigt** (QA F5, F6; Vorschlag freigegeben 2026-11-13): neue Bausteine `ConfirmPanel`, `TabLinks`/`SegmentLinks`, `Pager`, `ChatBubble`/`ChatNotice`, `SkeletonCard`, `OfflineNotice`, `ui.countBadge` und 13 eigene Wildarten-Icons (`SpeciesIcon`, Rehwild Variante C). Eingesetzt in Suche (Reiter Angebot/Gesuch, Umschalter Liste/Karte, Blättern), Chat, Löschen von Suchaufträgen, Assistent (Balken je Schritt), Kopf (Zähler), Filter und Detailseite (Wildarten mit Icon), Kartenpopup; Offline-Band im Layout. Styleguide zeigt Wildarten, Rückfrage, Navigation, Assistent, Chat, Kartenpopup sowie Laden, Fehler, Offline, 410 und 404. Neue Texte in 4 Sprachen (`Styleguide.*`, `Offline.*`). Übersicht in `DESIGN.md` („Bausteine“).
- Offen aus dem Vorschlag: Filterleiste mit entfernbaren Chips der aktiven Filter (erledigt, siehe oben).

### Entscheidungen
- **Keine Kategorie-Navigation im Kopf** (QA F1, Entscheidung 2026-11-13): bewusste Abweichung von der SPEC. Filter mobil bleibt ein aufklappbarer Bereich, kein Blatt von unten (Entscheidung 2026-11-13).

### Testen
- Per Docker wie in der CI: `deno task check && deno lint && deno task test` in `send-chat-notifications` und `send-search-notifications`
- `cd web && npx vitest run`
- `cd web && npx playwright test e2e/m10a-text.spec.ts`
- `supabase test db supabase/tests/08_storage.test.sql supabase/tests/57_qa_m9b_nachpruefung.test.sql` (mehrfach, auch mit Demo-Daten)

## M10a GUI/UX-Design (Web), Schritt 8: Prüfung – 2026-11-13

Berichte: `docs/QA-REPORT.md` Abschnitt „M10a – Abnahme (Akzeptanz)“ (qa), `docs/adr/022-schriften-drittanfragen-header.md` (architect). Beide ohne blockierenden Befund.

### Geändert
- **Prüftest** `e2e/m10a-text.spec.ts`: 27 Kernseiten in de/en/cs/pl mit axe (WCAG 2 A/AA), Überbreite, abgeschnittenem Text und rohen Schlüsseln; läuft in der CI mit. `M10A_SCREENS=1` erzeugt Bildschirmfotos in 360/768/1280 px unter `web/test-results/m10a-screens/` (mit `index.html` zum Durchsehen; nicht im Repo).
- **Restliche Sie-Formen im Tschechischen** (Zkuste, Vyberte, Zvolte, Přihlaste) und Kopfzeile mit Länderkürzeln; als Override gesichert.
- **Schriften** (ADR 022 S1, K1): versionierte Dateinamen `*.v1.woff2`, ein Jahr `immutable` gecacht; Teilmenge Č č Š š vorgeladen und mit vollständigen Namensangaben neu geschnitten.
- **Tests** (ADR 022 S2, K5): `58_killed_game.test.sql` führt `resolve_reports` aus und prüft Rechte und `search_path`; `/api/locale` in der Cookie-Inventur; Impressum im Prüftest.
- **DESIGN.md:** Lizenzen ergänzt (Teilmenge mit Befehl, App-Icon, Noto Sans, MapLibre, Kartendaten, `design/`).

### Testen
- `cd web && npx playwright test e2e/m10a-text.spec.ts` (mit `M10A_SCREENS=1` für Bildschirmfotos)
- `supabase test db supabase/tests/58_killed_game.test.sql`

### Offen (aus den Berichten, nicht in diesem Schritt)
- **Mensch:** Vergleich mit dem Webshop, Ähnlichkeitsprüfung gegen fremde Portale, VoiceOver-Durchgang, cs/pl durch Muttersprachler.
- **Gestaltung (QA F1, F2):** Hauptnavigation der Kategorien in Großbuchstaben im Kopf fehlt; Filter mobil als aufklappbarer Bereich statt Blatt von unten; Claim in der Leiste. Abweichung begründen oder umsetzen.
- **Bibliothek (QA F3–F6):** 32 Einzelwerte ohne Token (u. a. `text-[0.8125rem]`), zusammengesetzte Überschriften, Chat-Blase und Badges als Einzelbauten; im Styleguide fehlen Filterleiste, Dialoge, Tabs, Paginierung, Assistenten-Fortschritt, Chat-Blasen, Kartenpopup, Fehler-/Offline-Zustände und Wildarten-Icons.
- **DESIGN.md (QA F11):** Typografie-Skala, Radien, Abstände, Icon-Größen, Tippflächen und Zuordnung für iOS fehlen.
- **Performance:** Liste 89 (Ziel 90), Detail 79 (Ziel 85) bis zur mittleren Bildgröße (Schritt 7).
- **ADR 022:** S3 eine Quelle für die Grund-Codes, K6 Header (COOP, `browsing-topics`, HSTS-preload), K7.

## M10a GUI/UX-Design (Web), Schritt 7: Performance – 2026-11-13

Messung: Lighthouse 12.8 (einmalig per `npx`, keine Projekt-Abhängigkeit), Handy-Profil mit simuliertem 4G, Produktions-Build lokal (`next start`), je Seite Median aus 3 Läufen. Demo-Daten: 6 Anzeigen mit je 3 Fotos in Pipeline-Größe (voll 2048 px, ca. 410 KB; Vorschau 480 px, ca. 15 KB), Konto `demo-perf@test.local`, nur lokal.

| Seite | Performance vorher → nachher | LCP | CLS | Gewicht |
|---|---|---|---|---|
| Start `/de` | 81 → 93 | 4,6 → 3,2 s | 0 → 0 | 638 → 558 KB |
| Liste `/de/jagdhelfer` | 87 → 89 | 4,0 → 3,7 s | 0,001 → 0 | 641 → 561 KB |
| Detail `/de/anzeige/…` | 75 → 79 | 6,2 → 5,6 s | 0,002 → 0 | 985 → 905 KB |
| Start `/cs` (nachher) | 87 | 4,1 s | 0 | 714 KB |

Accessibility und Best Practices 100 auf allen drei Seiten; SEO lokal 69 nur wegen `noindex` außerhalb von Prod (`is-crawlable`).

**Zielwerte (Handy, Lighthouse):** Performance ≥ 90 auf Start und Liste, ≥ 85 auf Detail; LCP ≤ 2,5 s als Richtwert für Prod mit CDN; CLS ≤ 0,1. Erreicht: Start, CLS. Offen: Liste knapp, Detail (siehe Lücken).

### Geändert
- **Schriften vorladen** (`react-dom` `preload` im Layout): Montserrat und Inter Latin, auf cs/pl auch Latin Extended.
- **Teilmenge `inter-czech-wght-normal.woff2`** (2 KB, Č č Š š): „Čeština“ in der Sprachwahl lud auf jeder Seite die 84 KB große Latin-Extended-Datei von Inter; de/en-Seiten laden sie jetzt nicht mehr.
- **Listen:** die obersten 3 Treffer laden ihr Foto sofort, der erste mit `fetchpriority="high"` (war `loading="lazy"` und das LCP-Element).
- **Detail:** erstes Foto mit `fetchpriority="high"`.
- Kein `next/image` für Anzeigenfotos: Die Foto-Route prüft die Sichtbarkeit bei jedem Abruf (`no-cache`, ADR 015), der Bild-Optimierer würde Kopien stundenlang zwischenspeichern und ein entferntes Foto weiter ausliefern.

### Testen
- `npm run build && npx next start -p 3100`, dann `npx --yes lighthouse@12.8.2 http://localhost:3100/de --only-categories=performance`
- E2E `public.spec.ts`, `m10a-text.spec.ts`, `cookie-inventory.spec.ts`, `qa-m5.spec.ts`

### Lücken
- **Detail-LCP:** Das erste Foto ist auch auf dem Handy die 2048-px-Fassung (410 KB). Lösung: dritte, mittlere Größe (ca. 1024 px) und WebP in `process-listing-photo`, dazu `srcset`. Berührt Edge Function, 6 Migrationen (Löschjobs, Karte, Suche), Storage-Regeln und die Neuverarbeitung bestehender Fotos; als eigener Schritt mit `backend`/`database` vor M10.
- Messung lokal ohne CDN und HTTP/2; die Prod-Messung gehört in `docs/WEB-RELEASE.md` (M10).

## M10a GUI/UX-Design (Web), Schritt 6: Sensible Inhalte – 2026-11-13

Entscheidung des Nutzers: keine Fotos von erlegtem Wild; solche Anzeigen lehnt der Admin ab (SPEC M10a Schritt 6, Nachtrag ADR 014).

### Geändert
- **Neuer Ablehnungsgrund `killed_game`** („Foto zeigt erlegtes Wild“): Migration `20261113100000_reject_code_killed_game.sql` (Check auf `listings.reject_code`, Code-Liste in `resolve_reports` gezielt ersetzt), `lib/moderation.ts`, Moderations-Mails (`send-search-notifications/texts.ts`, Fixture `mail_labels.json`), Glossar.
- **Foto-Schritt:** Hinweis „Keine Fotos von erlegtem Wild. Anzeigen mit solchen Fotos werden abgelehnt.“, per `aria-describedby` am Datei-Feld.
- **Admin-Prüfung:** Hinweis zur Fotoprüfung, sobald die Anzeige Fotos hat.
- **Richtlinien:** neuer Punkt unter „Verbotene Inhalte“ (Platzhalter-Rechtstext).
- Melden an jeder Anzeige und jeder Nachricht war schon vorhanden (Detailseite, Anbieterseite, Chat-Menü).
- Neue Texte in de/en/cs/pl von Hand (cs/pl als Override, damit ein DeepL-Lauf sie nicht überschreibt).

### Testen
- `supabase test db` (neu: `58_killed_game.test.sql`), `cd web && npm test`
- Edge Function per Docker wie in der CI: `send-search-notifications` (33 Tests)
- `npx playwright test e2e/admin.spec.ts e2e/qa-m3.spec.ts` (Grund in der Auswahl, Hinweis im Foto-Schritt)

### Lücken
- Eine automatische Bilderkennung gibt es nicht; die Prüfung bleibt beim Admin.
- iOS übernimmt Grund und Hinweis ab I3/I4.
- Bekannt, nicht aus diesem Schritt: `08_storage.test.sql` Test 11 zählt alle Dokumente im Bucket und schlägt nach E2E-Läufen lokal fehl (Testdaten bleiben liegen); `57_qa_m9b_nachpruefung.test.sql` Test 4 sortiert nach gleichem `created_at` und ist dadurch gelegentlich rot.

## M10a GUI/UX-Design (Web), Schritt 5: Texte und Mehrsprachigkeit – 2026-11-13

### Geändert
- **cs und pl per DeepL neu übersetzt** (`npm run i18n:deepl`, `web/scripts/translate-deepl.mjs`, ohne neue Abhängigkeit; Schlüssel `DEEPL_API_KEY` nur in `web/.env.local`). Anrede **Du** in beiden Sprachen (Entscheidung 2026-11-13). DeepL kann für Tschechisch keine Anrede wählen, deshalb cs aus dem deutschen Du-Text, pl aus en mit `formality: prefer_less`.
- **Glossar** aus `docs/GLOSSARY.md` als DeepL-Glossar (ohne URL-Wörter), ergänzt um Anzeige, Meldung und Beschwerde; Glossar-Begriffe klein, damit sie mitten im Satz nicht groß stehen.
- **Handkorrekturen** in `web/scripts/i18n-overrides.json` (cs 176, pl 168): Restliche Sie-Formen, falsche Wörter bei kurzen Labels (z. B. pl „Podsumowanie“ statt „Wznów“, cs „Nahlásit“ statt „Zobrazit inzerát“), „Meldung“ als cs „nahlášení“ und pl „zgłoszenie“, Anzeige als pl „ogłoszenie“, Lizenzkennung `dl-de/by-2-0`, Markenname „Die Jagdbrüder“. Das Skript wendet sie nach jedem Lauf an.
- **Nicht übersetzt:** 20 Texte mit Pluralformen (cs/pl brauchen eigene Formen, geprüft), Markennamen, Sprachnamen, OSM-Vermerk und die Labels, die auch in Mails stehen (`supabase/tests/fixtures/mail_labels.json`).
- **Namenszusatz je Sprache** (`Brand.tagline`, ≤ 30 Zeichen): Hunting leases & permits / Jagdpacht & Begehungsscheine / Honitby & povolenky k lovu / Dzierżawa obwodów i polowania.
- **Formate** geprüft: Preise, Zahlen und Datum über `Intl` je Sprache (EUR, CHF, CZK, PLN).
- **Tests:** neuer E2E `m10a-text.spec.ts` (alle 4 Sprachen, 360 px, 26 Seiten je Sprache: keine Überbreite, nichts ragt aus dem Bild, keine rohen Schlüssel); E2E lesen cs/pl-Texte jetzt über `e2e/messages.ts` statt fest eingetragener Sätze.

### Testen
- `cd web && npm test && npx playwright test e2e/m10a-text.spec.ts`
- Neu übersetzen: `npm run i18n:deepl`, danach `git diff messages/` prüfen

### Lücken
- cs/pl bleiben **ungeprüft**, bis Muttersprachler sie freigeben (SPEC 7.6). Längere Sätze habe ich nur stichprobenartig gelesen.
- Mails (Edge Functions) siezen auf Tschechisch noch („vašem“); ebenso das gemeinsame Label `Decisions.actions.report_handled`. Umstellen zusammen mit den Mail-Texten.
- Der Kartentest „Entprellung“ (`qa-m6-nachpruefung.spec.ts:59`) war einmal rot (4 statt höchstens 2 Abrufe), in der Wiederholung grün; zeitabhängig.

## M10a GUI/UX-Design (Web), Teil 1: Marke, Tokens, Kopf, Start, Suche, Detail – 2026-11-12

Grundlage: `docs/DESIGN.md`, Entwurf auf der Zeichenfläche (freigegeben). Reviro ist eine eigene Marke „by Die Jagdbrüder“; Bedienung wie ein Kleinanzeigen-Portal, Aussehen aus dem Designsystem der Marke.

### Geändert
- **Tokens und Schriften:** Farben (Orange `#FF914D`, Waldgrün, Oliv, Sand, Offwhite) und Status als `@theme` in `globals.css`; Montserrat und Inter selbst gehostet unter `/static/fonts` (SIL OFL, Lizenztexte daneben, keine Anfragen an Dritte); sichtbarer Fokus, `prefers-reduced-motion`; kein Dunkelmodus.
- **Komponenten:** `components/ui/styles.ts` (Buttons, Felder, Karten, Chips, Überschriften), `components/ui/Icon.tsx`, `components/brand/` (Logo L1 Geweih-Pin, Kategorie-Icons), App-Icon `app/icon.svg` (ersetzt `favicon.ico`).
- **Kopf und Fuß:** dunkelgrüne Leiste mit Sprachwahl und Shop-Link, Wortmarke, Suche „Was?/Wo?“ (GET, ohne JavaScript), Konto-Links mit Icons, Hauptaktion „Anzeige aufgeben“; Fuß mit Logo und Rechtslinks. Seitentitel „Reviro“.
- **Startseite:** Kategorie-Kacheln, Markenbanner „FINDE DEIN REVIER.“, neueste Anzeigen als Raster, Länder, Vertrauensbox.
- **Suche und Listen:** Filter als Seitenleiste (mobil aufklappbar), Angebote/Gesuche und Liste/Karte als Links, Regionen als Chips, Trefferzeilen mit Foto links und Preis rechts.
- **Detail:** großes erstes Foto und Vorschaubilder, Eckdaten, Beschreibung, Lage; Kontaktbox mit Anbieter, Verifizierung, Merken, Sicherheitshinweisen und Melden; mobil Kontakt fest unten.
- **Texte:** neue Namensräume `Brand` und `Header`, neue Schlüssel in `Public.home`, `Public.card`, `Public.detail` in de/en/cs/pl (cs/pl ungeprüft); `Auth.nav` und die alte Startseiten-Suche entfernt.
- **Alle übrigen Seiten:** alte Farbklassen per Durchgang auf Tokens umgestellt (383 Stellen in 64 Dateien), Überschriften im Markenstil, Radio und Checkbox in Waldgrün, 410- und Abbestell-Seite in Markenfarben.
- **Inserieren-Assistent:** Fortschrittsbalken, Schritte als Chips, Felder und Hauptaktion aus der Bibliothek.
- **Konto-Übersicht:** Profilkarte, Kacheln für Anzeigen, Nachrichten, Favoriten, Suchaufträge, Liste für Verifizierung bis Konto löschen.
- **Chat und Nachrichten (Schritt 4.7):** Konversationsliste und Unterhaltung im Kartenstil, Kopf mit Initialen-Avatar und Anzeigenlink, Chat-Blasen (eigene Waldgrün rechts, fremde hell links), Eingabefeld und Senden-Button aus der Bibliothek, Blockieren und Melden als Buttons mit 44 px Tippfläche; Funktionen unverändert.
- **Anmeldung, Profil, Verifizierung (Schritt 4.8):** Anmelden, Bestätigen und Willkommen als Karte mit Logo, Felder und Hauptaktion aus der Bibliothek, Code-Feld groß und gesperrt; Profil und Benachrichtigungen als Karten; Verifizierung mit Statuskarte (Schild-Symbol, grün wenn verifiziert), Antrag als Karte mit gestaltetem Datei-Button, Verlauf als Liste. Keine neuen Texte, Funktionen unverändert.
- **Admin-Bereich (Schritt 4.10):** Übersicht als Kacheln für Warteschlange, Verifizierungen, Meldungen und Beschwerden (orange umrandet, wenn etwas wartet), darunter Konto suchen, Audit-Log und Admins als Liste. Alle Admin-Seiten auf Felder, Karten und Buttons der Bibliothek umgestellt; neue Bausteine `ui.btnDanger` und `ui.btnDangerOutline` (Fehlerrot) für Sperren, Ablehnen und Rolle entziehen. Audit-Tabelle mit Kopfzeile in Sand. Keine neuen Texte.
- **Rechtsseiten und Fehlerseiten (Schritt 4.9):** Impressum, Datenschutz, Nutzungsbedingungen, Richtlinien, Cookie-Einstellungen und Datenquellen mit Platzhalter-Hinweis (Waage-Symbol), Gliederung als Karten, Cookie-Tabelle mit Kopfzeile in Sand und Kategorie als Chip. 404, 403 und die globale 404 über `components/ui/ErrorState.tsx`: Logo, Statuscode groß, Wege zur Startseite und zur Suche.
- **Cookie-Banner als Vorlage (Schritt 3, ADR 021):** `components/consent/ConsentBanner.tsx` im Styleguide, nicht eingebunden (nur notwendige Cookies). Ablehnen und Zustimmen gleichrangig und gleich gestaltet, Link zu den Cookie-Einstellungen. Neue Texte `Cookies.banner` und `Styleguide.consent` in de/en/cs/pl (cs/pl ungeprüft). Logik (Cookie `revier_consent`, Widerruf) folgt mit dem ersten optionalen Eintrag; der Guard-Test verlangt dann die Einbindung im Layout.
- **Sprachwahl und Konto ohne JavaScript (behoben, `qa-m5.spec.ts:483`):** Ist eine Seite schneller fertig als die Suspense-Grenzen im Kopf (z. B. `/de/jagdpacht/bayern?cur=EUR`), kamen Sprachwahl und Konto-Links nur gestreamt und blieben ohne JavaScript verborgen. Beide Grenzen haben jetzt Platzhalter im ersten HTML: Die Sprachlinks zeigen auf `/api/locale?to=…` (303 auf die passende Seite aus dem Referer, nur Pfad und Query, immer eigener Pfad, `noindex`, `no-store`; ohne Referer zur Startseite), der Konto-Platzhalter auf „Mein Reviro“. Ziel-Logik gemeinsam in `lib/public/locale-switch.ts`. Die E2E-Probe prüft das Ziel statt des `href`; `qa-m3.spec.ts:282` sucht den Absenden-Button nur noch im Hauptbereich (sonst traf `.last()` bei gestreamten Konto-Links „Abmelden“).
- **Tests:** E2E an Kopf-Suche, doppelten Link „Anzeige aufgeben“, „Mein Reviro“ und das große Detailfoto angepasst.

### Testen
- `cd web && npm run lint && npm run typecheck && npm test`
- `npx playwright test` (Kernseiten mit axe und 360 px)
- Sichtprüfung: `/de`, `/de/suche`, eine Anzeige, je in 360 und 1280 px; Netzwerk-Tab ohne Drittanfragen

### Lücken
- Eine Hilfe-Seite gibt es noch nicht (braucht Inhalte); ebenso keine eigene Seite für Serverfehler (500, `error.tsx`, braucht neue Texte).
- `qa-m7.spec.ts:221` (Realtime nach Verbindungsabbruch) ist zeitabhängig und schlug einmal fehl (Nachricht schon während der Trennung da); zwei Wiederholungen der Datei grün.
- Mails und die Willkommensseite („Willkommen bei Revier“) nennen die Plattform noch „Revier“; Umbenennung zusammen mit der Namensfreigabe (SPEC 7.1).
- Teilen-Button auf der Detailseite fehlt noch (braucht JavaScript oder einen Link-Fallback).
- Keine Markenfotos: Banner und Platzhalter sind gezeichnet.
- iOS übernimmt die Tokens ab I1.

## Nachtrag M9b: QA-Nachprüfung N1–N4 und H1 – 2026-11-12

Bericht: `docs/QA-REPORT.md`, Abschnitt „M9b – Nachprüfung“. Migration `20261112170000_qa_m9b_recheck.sql`, ADR 020 „Nachträge QA M9b Nachprüfung“.

### Geändert
- **N1:** Admins entfernen den Kartenpunkt nur noch über die Meldungs-Entscheidung mit Grund und Begründung; ein direktes UPDATE ergibt `42501`.
- **N2:** Die Dokument-Route behält `no-referrer` und die Sandbox-CSP der Function (ausgenommen aus der allgemeinen Header-Regel).
- **N3:** Die Admin-Ansicht zeigt nach dem erkannten Typ (Bild eingebettet, PDF als Download) und markiert abweichende Dateien eindeutig; ein Abruf und ein Audit je Ansicht.
- **H1:** Die Dokument-Route lehnt Abrufe von fremden Seiten ab (`Sec-Fetch-Site`).
- **N4:** ADR 020 und CHANGELOG nachgezogen; `verification_doc_link_seconds` entfernt.
- **Tests:** Der Test-Helfer setzt `revier.point_code` für die älteren Tests mit Roh-UPDATE (wie `revier.moderation`); TODO N1 in pgTAP 57 und `test.fail` N2 in `qa-m9b-nachpruefung.spec.ts` sind normale Tests.

### Testen
- `supabase test db`; `cd web && npm test && npx playwright test e2e/verification.spec.ts e2e/qa-m9b.spec.ts e2e/qa-m9b-nachpruefung.spec.ts`

## Nachtrag M9b: QA-Funde F1–F6 – 2026-11-12

Bericht: `docs/QA-REPORT.md`, Abschnitt „M9b – Abnahme“. Migration `20261112160000_qa_m9b_fixes.sql`, ADR 020 „Nachträge QA M9b“.

### Geändert
- **F1 (mittel):** Eine Beschwerde von Meldenden öffnet nur die Meldungen der angefochtenen Bearbeitung wieder (`reports.resolution_id`); vorher scheiterte die Rücknahme nach zwei Meldezyklen an `reports_one_open_idx`.
- **F3 (mittel):** Kartenpunkt entfernen verlangt Grund und Begründung, beides steht im Audit und in „Entscheidungen“, der Besitzer bekommt eine Mail (4 Sprachen).
- **F2:** Die Ausweichregel zählt den Beschwerdeführer nicht mehr als „anderen Admin“.
- **F4:** Nach Wiedereröffnung und neuer Entscheidung bekommen Meldende eine neue Ergebnis-Mail.
- **F5:** Getrennte Auswahl für Anzeigen- und Konto-Gründe, Prüfung je Maßnahme im Web und in der DB.
- **F6:** Verifizierungsdokumente nur noch über die Edge Function `verification-document` (Audit je Abruf, erste Bytes, `no-store`); kein Lesen und Signieren über die Storage-API mehr, auch nicht für Admins.
- **CI:** Deno-Job für `verification-document`.
- **Proben:** Die TODOs F1–F4 in pgTAP 56, `test.fail` F5 in `qa-m9b.spec.ts` und `it.fails` F6 in `qa-m9b.test.ts` sind normale Tests.

### Testen
- `supabase test db`; Deno per Docker in `supabase/functions/verification-document` und `send-search-notifications`
- `cd web && npm test && INTEGRATION_REQUIRED=1 npm run test:integration && npx playwright test e2e/verification.spec.ts e2e/qa-m9b.spec.ts e2e/admin-moderation.spec.ts`
- Lokal: Die neue Function bedient die Edge Runtime erst nach `supabase stop && supabase start`.

## M9b Vertrauen und Moderation (Web) – 2026-11-12

Plan `docs/plans/M9-plan.md` (Architekt-Review Abschnitt 10, Freigabe Abschnitt 11), ADR 020 mit den Abschnitten „Umsetzung“ je Commit, SPEC v0.11. Mit M9b ist M9 vollständig.

### Geändert
- **Verifizierung (ADR 020, Review A6, B3):** Antrag „Zeile zuerst“ (`begin_verification` → Upload genau auf den Serverpfad → `submit_verification`), Zurückziehen, Limit 3 in 30 Tagen in eigenen Zählerzeilen (`RV002`), kein HEIC. Entscheiden und Widerrufen nur per RPC mit aal2, nie über das eigene Konto. Admins sehen ein Dokument nur nach „Dokument anzeigen“ (Audit `verification.document_viewed`) und nur, wenn die ersten Bytes zu JPEG, PNG oder PDF passen; seit dem Nachtrag F6 nur über die Edge Function `verification-document`, nie über die Storage-API. Profilstatus aus den Anträgen abgeleitet, der Cache-Zähler steigt beim Badge-Wechsel. Web: `/account/verification`, `/admin/verifications`, `/admin/verifications/:id`.
- **Melden (Review A9):** Anzeigen und Anbieter über statische Links auf `/account/report/listing/:id` bzw. `/profile/:id` (Ziel im Pfad, damit der Login-Rücksprung es behält), Zusicherung „in gutem Glauben“ als Platzhalter, höchstens eine offene Meldung je Ziel, Eingangsbestätigung in „Meine Meldungen“ (`/account/reports`) mit Stand und Ergebnis. Im Chat zeigt eine zweite Meldung „bereits gemeldet“.
- **Meldungen im Admin:** Warteschlange je Ziel, Zielansicht mit Maßnahmen (keine, Anzeige entfernen, Kartenpunkt entfernen, Konto verwarnen, Konto sperren; `target_gone` automatisch), gemeldete Chat-Nachricht nur nach Klick und auditiert. `moderate_listing` kennt `remove` (Version nur über `admin_report_target`). Eine entfernte Anzeige verlässt `removed` nur nach einer erfolgreichen Beschwerde (Flag `revier.appeal`), auch nicht auf Server-Pfaden.
- **Konten im Admin:** Suche per POST (exakte E-Mail oder ID, gemeinsames Limit, Audit ohne Adresse), Sperren, Entsperren, Verwarnen mit Codes und Begründung; nie das eigene Konto, nie Konten mit Rolle.
- **Entscheidungen und Beschwerden (DSA Art. 17, 20; Platzhalter):** `/account/decisions` mit Grund, Begründung und Frist (183 Tage), Beschwerde unter `/account/decisions/:id/appeal`, auch gesperrt und ohne aktuelle Zustimmung. Admins entscheiden unter `/admin/appeals`; nicht der Admin der ursprünglichen Entscheidung, außer es gibt keinen anderen mit bestätigtem TOTP (markiert). `reversed` nimmt die Maßnahme zurück (Anzeige vorne in die Prüfung, Sperre aufheben, Verifizierung ohne Anrechnung aufs Limit, Meldungen wieder offen).
- **Dienstmails (Review A11):** Warteschlange `private.account_notifications` im selben Lauf wie die Moderations-Mails, Texte in 4 Sprachen für Verifizierung, Sperre, Entsperrung, Verwarnung, Meldungsergebnis (nur Zieltyp und Ergebnis), Beschwerde und verlassene Entwürfe. Die Moderations-Mails aus M8 nennen statt des Kontakt-Platzhalters die Frist zum Anfechten mit Link; Rechtsbehelfe bleiben ein markierter Platzhalter.
- **Server-Pfade (Review A7, Lücke M8):** Audit und Moderations-Mails auch ohne Admin-JWT, wenn das Flag `revier.moderation` bzw. `revier.appeal` gesetzt ist.
- **Aufräumjobs:** Dokumente 30 Tage nach der Entscheidung, Anträge ohne Einreichung und Dateien ohne Antrag nach 24 h, verlassene Entwürfe nach 12 Monaten ohne Bearbeitung mit Hinweis 30 Tage vorher (`listings.edited_at`, `draft_notice_at`), Warteschlange und Zähler nach 30 Tagen, Beschwerden nach 24 Monaten.
- **Export:** `version` 4 mit Verifizierungsspalten, `reports[].outcome`, `decisions` und `appeals`.
- **Doku:** ADR 008 (FK-Tabelle), ADR 019 (Export), ADR 020 (Umsetzung je Commit, Abweichungen), SPEC 3.4, Glossar (Dokumenttypen, Widerruf, Anfechten).

### Testen
- `supabase test db` (53 Verifizierung, 54 Meldungen und Beschwerden, 55 Aufräumjobs; 00, 07, 08, 17, 45, 49, 52 angepasst)
- Edge Functions wie in der CI per Docker: `send-search-notifications` (Dienstmails, Moderations-Mail) und `account-maintenance`
- `cd web && npm test && INTEGRATION_REQUIRED=1 npm run test:integration && npm run test:e2e`
- Integration `verification.test.ts` (Pfadbindung, Review B3 gegen die echte Storage-API), `trust-mails.test.ts` (Mails zu Akzeptanz 2 und 3 über die echte Function in Mailpit)
- E2E `verification.spec.ts`, `reports.spec.ts`, `admin-moderation.spec.ts`; `cookie-inventory.spec.ts` und `admin.spec.ts` decken die neuen Seiten ab (Review A10)

### Akzeptanz (SPEC 6 M9b)
- Upload eines Dokuments → Entscheidung im Admin → Badge „verifiziert“ öffentlich sichtbar, nach Widerruf wieder weg: erfüllt (E2E `verification.spec.ts`).
- Meldung einer Anzeige → Entfernen im Admin → Mail an den Besitzer mit Begründung und an die Meldenden mit dem Ergebnis: erfüllt (E2E `admin-moderation.spec.ts` für den Weg im Admin, Integration `trust-mails.test.ts` für die Mails).
- Sperre eines Kontos → Beschwerde des Betroffenen → Entsperrung durch einen anderen Admin: erfüllt (E2E `admin-moderation.spec.ts`, Mails in `trust-mails.test.ts`; pgTAP 54 für Ausweichregel und Rücknahmen).
- Ein Verifizierungsdokument ist ohne frischen Audit-Eintrag `verification.document_viewed` nicht lesbar, auch nicht für Admins über die Storage-API: erfüllt; seit Nachtrag F6 strenger: kein Lesen über die Storage-API, jeder Abruf über `verification-document` auditiert (Integration `verification.test.ts`, `qa-m9b-nachpruefung.test.ts`, pgTAP 08, 53, 56).

### Bekannte Lücken
- **iOS (I6):** Verifizierung per Kamera (JPEG statt HEIC), Melden, „Meine Meldungen“, Entscheidungen und Beschwerde folgen auf denselben RPCs.
- **Rechtlich zu prüfen (SPEC 7.2, Anwalt):** Wortlaut von Begründung, Rechtsbehelf und Streitbeilegung (Art. 17, 21), Zusicherung „in gutem Glauben“ (Art. 16), Melden ohne Konto (Art. 16; heute Kontaktweg im Impressum), befristete Sperren (Art. 23, Spalte `blocked_until` erst dann), Ausnahme nach Art. 19 und Ausweichregel (Art. 20 Abs. 6), Transparenzbericht (Art. 15/24, Zählwerte vor den Fristjobs sichern), Meldepflicht (Art. 18), Kontaktstellen (Art. 11/12), Fristen (30 Tage Dokumente, 183 Tage Anfechten, 12/24 Monate), Zusage des Badges, EXIF in Fotos von Dokumenten (H1), Codes für Maßnahmen.
- **Hinweis zu verlassenen Entwürfen** nur per Mail; „Meine Anzeigen“ zeigt das Löschdatum noch nicht.
- **Sperrumgehung** durch Löschen und Neuregistrieren (H8) bleibt offen.

## Nachtrag M9a: QA-Funde F1–F7 – 2026-11-11

Bericht: `docs/QA-REPORT.md`, Abschnitt „M9a – Abnahme“.

### Geändert
- **F1 (mittel):** `account_deletion_finalize` vergleicht Nutzer-ID und Adresse nur als vollständigen JSON-Wert. Vorher löschte die Löschung von `anna@…` auch Auth-Audit-Einträge von `johanna@…` (Migration `20261111130000_qa_m9a_fixes`).
- **F2:** Der Export nennt Titel gemerkter Anzeigen nur, wenn sie öffentlich sind (wie `my_favorites`); Export-`version` 2.
- **F3:** `account_deletion_prepare` entfernt Realtime-Ereignisse zu Unterhaltungen des Kontos (`unread.changed` beim Gegenüber). Die Allowlist in ADR 019 nennt bei Kopien gemeldeter Nachrichten jetzt auch `message_id` und `conversation_id`.
- **F4:** `/api/account/photos/:id` ist von der allgemeinen Header-Regel in `next.config.ts` ausgenommen und behält `Referrer-Policy: no-referrer`.
- **F5:** Der waagerecht scrollende Container der Tabelle auf `/cookies` ist per Tastatur erreichbar (`tabIndex`, `role="region"`, Label).
- **F6:** `/account/data` nennt auch Rollen, Bewertungen und Geräte (4 Sprachen).
- **F7:** ADR 019 (Messung großer Konten, Fixture, Einstellungen, `Sec-Fetch-Site`) und ADR 008 (Job für nie bestätigte Konten) nachgezogen; Fixture in `account-deletion.test.ts` um Blockierung und Gerät ergänzt.
- **Proben:** Die TODOs in pgTAP 51 und die erwarteten Fehlschläge F3–F5 in `qa-m9a.test.ts` und `qa-m9a.spec.ts` sind normale Tests. pgTAP 48 prüft, dass Ereignisse des Gegenübers zu anderen Unterhaltungen bleiben.

### Testen
- `supabase test db` (52), `cd web && npm run test:integration && npx playwright test e2e/qa-m9a.spec.ts e2e/account-delete-export.spec.ts e2e/cookie-inventory.spec.ts`

## M9a Konto und Datenschutz (Web) – 2026-11-11

Plan `docs/plans/M9-plan.md` mit Architekt-Review (Abschnitte 10/11), ADR 019 (Löschung, Export, Aufräumjobs), ADR 021 (Cookies und Einwilligung), SPEC v0.11. M9 ist geteilt; M9b „Vertrauen und Moderation“ (ADR 020) folgt, M9 gilt erst danach als abgeschlossen.

### Geändert
- **Cookies und Einwilligung (ADR 021):**
  - Kein Sprach-Cookie mehr (`localeCookie: false`, QA M0 F7). `/` wählt nach `Accept-Language` mit `Vary` und `Cache-Control: private`.
  - Inventar `web/lib/consent/inventory.ts` als eine Quelle für die Seite `/cookies` und die Tests: Session, PKCE-Verifier und die Karte als eigener Dienst ohne Speicher.
  - Gefunden im E2E: auth-js 2.117 legt einen PKCE-Verifier je Anmeldevorgang und einen Index an. Nach einem Login per Code bleiben sie bis zum Abmelden liegen; das Inventar und die Seite nennen das, `signOut` räumt alle ab.
  - Kein Banner, solange nur Notwendiges läuft; ein Guard-Test schlägt fehl, sobald ein Eintrag optional ist und kein Banner existiert.
- **Rechtstexte (Platzhalter, noindex):** Datenschutz und Nutzungsbedingungen mit einer Gliederung der tatsächlichen Verarbeitungen, neue Seite `/guidelines` (verbotene Inhalte). Neue Seite `/sources` (indexierbar) mit allen Pflichtvermerken und dem ODbL-Download der PLZ-Tabelle unter `/api/sources/postal-codes` (ADR 012). Footer mit sechs Links.
- **Account-Löschung (ADR 019):**
  - `request_account_deletion`: frische Anmeldung (höchstens 10 Minuten, `RV007`), bei TOTP-Faktor zusätzlich aal2 (`RV005`), Konten mit Rolle `42501` `admin_role`. Ohne Legal-Gate, auch für gesperrte Konten.
  - `amr` gemessen: Code, Link und Erstbestätigung schreiben `otp`, ein Refresh behält den Zeitstempel.
  - Fester Ablauf in der Edge Function `delete-account`: Storage 1 → prepare → deleteUser → finalize (Auth-Audit, `flow_state`, Realtime) → Storage 2 → complete. Lease je Zeile, Backoff 1 min verdoppelt bis 1 h, die Wiederholung bricht nie ab. Auslöser per pg_net nach dem Antrag und per Cron jede Minute.
  - Es bleiben nur: Audit pseudonymisiert, Meldungen gegen das Konto und Kopien gemeldeter Nachrichten.
  - Web `/account/delete`: erklärt Gelöschtes und Reste, erneute Anmeldung per Code an die Adresse der Session (bei Faktor mit TOTP), Bestätigung per Server Action (auch ohne JS), danach abgemeldet und Hinweis „wird gelöscht“. Die Sperrfrist von GoTrue zwischen zwei Mails wird angezeigt.
- **Datenexport:** `export_my_data` mit Allowlist je Abschnitt, Daten anderer nur als Anzeigename, 3 je 24 h (`RV002`). Web `/account/data` mit `POST /api/account/export` (Origin-Prüfung, Download als JSON) und Foto-Links `GET /api/account/photos/{id}` (Login und Eigentum, 60-s-URL). Im Plan fehlte `reviews`; der Abschnitt ist ergänzt.
- **Erreichbarkeit:** Löschen und Export auch ohne aktuelle Zustimmung (Links auf der Willkommensseite); `guards.test.ts` hält das fest.
- **Aufräumjobs:** nie bestätigte Konten nach 7 Tagen über denselben Löschweg, erledigte Meldungen samt Kopien nach 12 Monaten, Audit nach 24 Monaten, Export-Zähler nach 7 Tagen, Function `account-maintenance` für Foto-Eingang und Fotos ohne Zeile nach 24 h. Admin-Übersicht mit der Anzahl hängender Löschungen.
- **Wächter:** `00_meta` prüft, dass jeder Bucket in der Löschliste steht und jede Spalte mit Nutzerbezug in ADR 008 eingeordnet ist; pgTAP 49, dass jede Tabelle mit Nutzerbezug im Export oder in der Ausschlussliste steht.
- **Doku:** ADR 008 nachgezogen, ADR 014 mit `RV007`, ADR 005 mit dem Runbook „Admin will sein Konto löschen“ (Review A15), Glossar.

### Testen
- `supabase test db` (pgTAP 48 Löschung mit Rest-Inventar, 49 Export, 50 Aufräumjobs; 00, 12 und 15 erweitert)
- Edge Functions wie in der CI per Docker: `deno task check && deno lint && deno task test` in `delete-account` und `account-maintenance`
- `cd web && npm test && INTEGRATION_REQUIRED=1 npm run test:integration && npm run test:e2e`
- Integration `account-deletion.test.ts`: Normalfall, drei Abbrüche, Auslöseweg über pg_net; Gegenprobe über die Storage-API und Inventar über alle Nicht-System-Schemas. `account-maintenance.test.ts`: echte Function und Storage-API.
- E2E `cookie-inventory.spec.ts` (anonym, angemeldet, Admin, Abmelden, Selbsttest; gegen Stage/Prod: `QA_BASE_URL=… QA_SUPABASE_URL=…`), `account-delete-export.spec.ts` (Export mit Foto-Links und Limit, Löschen über die Oberfläche bis zum gelöschten Konto, Admin-Rolle).
- Lokal: Neue Functions bedient die Edge Runtime erst nach `supabase stop && supabase start`.

### Akzeptanz (SPEC 6 M9a)
- a) Ein gelöschter Account verschwindet aus allen Tabellen und Buckets bis auf die Allowlist: erfüllt (Integration `account-deletion.test.ts` gegen GoTrue und die Storage-API, mit Abbrüchen und Auslöseweg; pgTAP 48 als frühe Warnung).
- b) Ohne Einwilligung laufen keine nicht notwendigen Cookies: erfüllt für CI und lokal (E2E `cookie-inventory.spec.ts` mit Selbsttest). Gegen Stage und Produktion steht der Lauf aus (Hosting- und CDN-Cookies, M10).

### Bekannte Lücken
- **iOS (I6):** Löschen, Export, frische Anmeldung (`RV007`/`RV005`) und der `download_url`-Vertrag folgen auf denselben RPCs. Bis dahin hat die iOS-App keinen Lösch- und Exportweg aus M9a (App-Store-Pflicht vor dem Release).
- **Apple:** Der Token-Widerruf bei der Löschung (Apple-Vorgabe) fehlt; Vorbedingung für `NEXT_PUBLIC_AUTH_APPLE_ENABLED`. `amr` für Apple ist lokal nicht gemessen.
- **E-Mail-Adresse ändern** fehlt weiter (seit M2), Vorschlag M10.
- **M9b:** Verifizierung, Melden von Anzeigen und Profilen, Meldungs-Warteschlange, Sperren, Beschwerden, Moderations-Mails für Server-Pfade, verlassene Entwürfe; dazu die Fristen für Verifizierungsdokumente.
- Die Rechtstexte sind Platzhalter (SPEC 7.2), die Texte auf cs und pl ungeprüft (SPEC 7.6).
- Der Hinweis „wird gelöscht“ auf der Startseite braucht JavaScript (die Seite bleibt statisch gecacht).
- `docs/WEB-RELEASE.md` fehlt noch (M10); Pflichtpunkt dort: das Cookie-Inventar gegen Stage und Produktion.

### Anwaltsfragen (SPEC 7.2, neu oder präzisiert)
- Reste nach der Löschung und ihre Aufbewahrung (Art. 17 Abs. 3 DSGVO), auch der Zustimmungsnachweis (`legal_acceptances`).
- Einordnung der Session- und PKCE-Cookies als unbedingt erforderlich (TDDDG und die Umsetzungen in AT, CZ, PL).
- Backups und Logs bei Hoster und Mail-Anbieter (Datenschutzerklärung, M10).
- Für M9b: Kontaktstellen nach Art. 11/12, Ausnahme nach Art. 19, Transparenzbericht (Art. 15/24), Meldepflicht (Art. 18), Melden ohne Konto, Sperrdauer (Art. 23), EXIF in Verifizierungsfotos.

### Cloud-Checkliste (neu, Review A13)
- **Vault:** `account_deletion_url` auf `https://<projekt>.supabase.co/functions/v1/delete-account` und `account_maintenance_url` auf `…/functions/v1/account-maintenance`. Die Secrets legen die Migrationen an. Ohne URL bleiben Löschanträge liegen.
- **Rechte:** Prüfen, ob die Migrationsrolle in der Cloud auf `auth.audit_log_entries`, `auth.flow_state` und `realtime.messages` löschen darf. Sonst das Schreiben des Auth-Audits in die Projektdatenbank abschalten; dann gilt die Frist des Log-Dienstes und gehört in die Datenschutzerklärung.
- **Nach dem Deploy:** Kaskade von MFA-Faktoren und Rollen nachweisen; `amr`-Allowlist mit einem echten Login gegenprüfen; das Cookie-Inventar gegen die Produktions-URL laufen lassen.
- **Cron-Jobs:** `account-deletions` jede Minute, `account-maintenance` stündlich, `unconfirmed-accounts`, `reports-retention`, `audit-retention` und `data-exports-cleanup` täglich.

### Lokal von Hand
- Löschung einschalten: `supabase db query "select vault.create_secret('http://kong:8000/functions/v1/delete-account', 'account_deletion_url')"`
- Storage-Aufräumen: `supabase db query "select vault.create_secret('http://kong:8000/functions/v1/account-maintenance', 'account_maintenance_url')"`

## Nachtrag M8: QA-Funde F1–F3 – 2026-11-07

Bericht: `docs/QA-REPORT.md`, Abschnitt „M8 – Abnahme“.

### Geändert
- **F1:** `claim_search_notifications` bestimmt erst nach der Entdopplung, ob eine Mail tägliche Treffer enthält. Eine Mail nur mit doppelten täglichen Treffern verbraucht den Kalendertag nicht mehr (Migration `20261109100000_qa_m8_fixes`).
- **F2:** `next.config.ts` nimmt `/api/unsubscribe` von der allgemeinen Header-Regel aus. Die Route behält `Referrer-Policy: no-referrer` und ihre eigene CSP.
- **F3:** ADR 018 nennt die Fehlercodes (für I6) und den Datenexport in M9. Die erledigte Lücke zum Cache-Header ist entfernt, die Cloud-Checkliste nennt den Rückstau der Moderations-Mails.
- **Proben:** Der TODO in pgTAP 46 und `test.fail` „F2“ in `qa-m8.spec.ts` sind jetzt normale Tests.
- **Nachprüfung N1:** Auch `/api/unsubscribe/` (mit Schrägstrich) behält die eigene CSP der Route.
- **Nachprüfung N2:** ADR 018 nennt `23514` ohne `hint` (Name, Filtergröße) und weitere `42501`-Fälle; ADR 008 nennt den Datenexport der Suchaufträge.
- **Proben der Nachprüfung:** pgTAP 47, `qa-m8-nachpruefung.spec.ts` (gegen Prod mit `QA_BASE_URL=… QA_PROD=1`).

### Testen
- `supabase test db` (46), `cd web && npx playwright test e2e/qa-m8.spec.ts`

## M8 Suchaufträge (Web) – 2026-11-06

Plan `docs/plans/M8-plan.md` mit Architekt-Review (Abschnitte 10/11), ADR 018, SPEC v0.10. Abgenommen durch den Nutzer am 2026-11-08 (QA-Abnahme und Nachprüfung in `docs/QA-REPORT.md`).

### Geändert
- **Suchauftrag:**
  - Takt „sofort“ oder „täglich“, Laufzeit 6 Wochen.
  - Pausieren, Fortsetzen und Verlängern per RPC; Verlängern nur in den letzten 14 Tagen oder nach dem Ablauf, sonst `RV006` mit `extend_from`. Pausieren hält die Laufzeit nicht an.
  - Die Filter sind nach dem Anlegen fest. Ein Trigger prüft sie wie die Suche (auch einen zu langen Suchbegriff) und entfernt `sort`.
  - Höchstens 25 je Konto mit Lock, abgelaufene zählen mit. Abgelaufene werden 30 Tage nach dem Ablauf gelöscht.
- **Abgleich bei der ersten Freigabe:**
  - Ein AFTER-Trigger reiht die Anzeige ein, wenn `published_at` erstmals gesetzt wird.
  - Der Abgleich läuft über die bestehende `search_conditions`, je gleichem Filter einmal, mit Vorfilter. Ein fehlerhafter Auftrag wird übersprungen und gezählt.
  - Kein Treffer bei eigener Anzeige oder Sperre, bei pausiertem oder abgelaufenem Auftrag, bei abgeschalteter E-Mail, oder wenn der Auftrag erst nach der Freigabe angelegt wurde.
- **Genau eine Mail:**
  - Entdoppelt wird je Empfänger und Anzeige; „sofort“ gewinnt vor „täglich“.
  - Bei „sofort“ geht die Mail 2 Minuten nach der Freigabe, höchstens alle 10 Minuten. „Täglich“ geht ab 07:00 Uhr Europe/Berlin.
  - Buchführung über `claim_id` (höchstens einmal, 3 Versuche). Beim Claim werden alle Bedingungen erneut geprüft.
  - Mailinhalt nur über eine Liste erlaubter Felder (Titel, Kreis/Bundesland, Preis, Link), nie Koordinaten.
- **Moderations-Mails:**
  - Bei Freigabe, Änderungswunsch, Ablehnung und Entfernung durch einen Admin.
  - Mit Grund, ohne Identität des Admins, als Dienstmail ohne Abbestellen. Der Hinweis auf den Kontaktweg ist als Platzhalter markiert.
- **Abbestellen per Klick (RFC 8058)** für Suchauftrags- und Chat-Mails:
  - Token aus 32 zufälligen Bytes, gespeichert nur als SHA-256, gültig 90 Tage.
  - Header `List-Unsubscribe` auf `POST /api/unsubscribe` (ohne Cookies, immer 200) und `List-Unsubscribe-Post`.
  - Der Link im Text führt auf die Bestätigungsseite `/{lang}/unsubscribe` (noindex, no-referrer, beim Aufruf kein DB-Zugriff).
- **Edge Function** `send-search-notifications` mit Suchauftrags- und Moderations-Mails in getrennten Schritten. Der Mailer liegt jetzt unter `functions/_shared/mail/`, `SITE_URL` wird geprüft. URL-Wörter und Preisformat prüfen gemeinsame Fixtures in Deno und Vitest.
- **Web:**
  - „Suche speichern“ auf der Suchseite (Liste und Karte, mit Kartenausschnitt).
  - Konto-Seite „Suchaufträge“: Takt, E-Mail, Pausieren und Fortsetzen, Verlängern, Umbenennen, Löschen in zwei Schritten, „Ergebnisse ansehen“.
  - Funktioniert auch ohne JavaScript. Texte in 4 Sprachen.
- **Nebenbei behoben:**
  - Die M7-Probe „falsches Geheimnis“ schlug in etwa jedem 16. Lauf fehl.
  - Die Chat-E2E-Tests sehen nach einem Seitenwechsel die versteckt gehaltene vorige Seite nicht mehr.

### Testen
- `supabase test db` (pgTAP 43 Suchauftrag, 44 Abgleich, 45 Moderations-Mails und Abbestellen; 05 angepasst)
- Edge Functions wie in der CI per Docker: `deno task check && deno lint && deno task test` in `send-search-notifications` (dazu `deno lint ../_shared/mail`) und `send-chat-notifications`
- `cd web && npm test && INTEGRATION_REQUIRED=1 npm run test:integration && npm run test:e2e`
- Integration `saved-searches.test.ts`: Freigabe mit zweitem Admin, Function, Mailpit, genau eine Mail, erneute Prüfung, zwei Aufträge, täglicher Takt, parallele Läufe, Release, Pause, One-Click, Chat- und Moderations-Mails.
- E2E `saved-searches.spec.ts`: Speichern (Liste, Karte, ohne JS), Konto-Seite, Verlängern, Limit, Abbestellseite, One-Click-POST ohne Cookies an die Header-URL, axe, 360 px in 4 Sprachen.
- Lokal neu: Die neue Function bedient der Edge Runtime erst nach `supabase stop && supabase start`.

### Akzeptanz (SPEC 6 M8)
- Neue passende Anzeige löst genau eine E-Mail aus: erfüllt (Integration `saved-searches.test.ts`: genau eine Mail, keine weitere bei späteren Läufen, erneuter Prüfung und erneuter Freigabe, bei zwei Aufträgen desselben Nutzers und bei parallelen Läufen; pgTAP 44). Technisch höchstens eine, im Normalfall genau eine: Bricht der Versand nach dem Claim ab, geht die Mail verloren (ADR 018).

### Messung (Review A4)
- Lokal, 25 000 Aufträge (1000 Konten × 25) und 50 Anzeigen: 801 verschiedene Filter, rund 120 000 Treffer.
- Abgleich 3,4–7,7 s, ohne Gruppierung waren es 14,6 s.
- Claim für 50 Empfänger 1,4–1,9 s.
- Beides liegt unter dem pg_net-Timeout von 20 s.

### Bekannte Lücken
- **iOS:** Suchaufträge und Push folgen in I6, auf denselben RPCs (`pause/resume/extend_saved_search`), mit demselben Takt und derselben Entdopplung. `notify_push` bleibt bis dahin ungenutzt.
- Moderations-Mails entstehen nur bei Entscheidungen mit Admin-JWT. Ein späterer Pfad als service_role (zum Beispiel M9) braucht einen eigenen Auslöser.
- Der Widerspruchs- und Beschwerdeweg (DSA Art. 20) fehlt noch, der Hinweis in der Mail ist ein Platzhalter (SPEC 7.2, M9).
- Die Suchauftrags-Mail nennt Art und Richtung der Anzeige nicht, nur Titel, Region und Preis.
- Der Sprachumschalter auf der Abbestellseite verliert den Token; die Seite bittet dann, den Link aus der Mail erneut zu öffnen.
- Der Request-Logger von `next dev` schreibt Pfade samt Query, also auch Token. Das betrifft nur den Dev-Modus; die Logs des Hosters klärt M10.
- Die Texte auf cs und pl, auch die Mailtexte, sind ungeprüft (SPEC 7.6).
- Der Test zum täglichen Takt kann rund um Mitternacht (Europe/Berlin) am Tageswechsel wackeln.
- In der CI läuft während der Integrationstests kein Web-Server; den One-Click-POST deckt dort das E2E ab.
- Die Datenschutzerklärung (Platzhalter) nennt Suchaufträge, Benachrichtigungen und Abbestell-Token noch nicht (M9).

### Cloud-Checkliste (neu)
- **Deploy-Reihenfolge:** erst die Migrationen, dann die Functions. Die Chat-Function erwartet den `unsubscribe_token`.
- **Vault:** `search_notifications_url` auf `https://<projekt>.supabase.co/functions/v1/send-search-notifications` setzen. Ohne URL ruft der Job nichts auf. `search_notifications_secret` legt die Migration an.
- **Function-Secrets:** `SITE_URL` (`https://…`, ohne Pfad), sonst antworten beide Mail-Functions mit 503. Dazu `MAIL_FROM`.
- **DKIM** muss `List-Unsubscribe` und `List-Unsubscribe-Post` signieren (Bulk-Sender-Regeln). Die Access-Logs des Hosters höchstens 7 Tage aufbewahren (Token in der Query).
- **Cron-Jobs:** `search-notifications` jede Minute, `search-notifications-retention` und `saved-searches-retention` täglich.
- Wird `search_notifications_url` erst später gesetzt, gehen im ersten Lauf alle offenen Moderations-Mails der letzten 30 Tage auf einmal hinaus (QA M8 H4). Vor dem Setzen prüfen oder alte Einträge erledigen.

### Lokal von Hand: Suchauftrags-Mails
- Einmalig: `supabase db query "select vault.create_secret('http://kong:8000/functions/v1/send-search-notifications', 'search_notifications_url')"`
- Dann eine Suche speichern und mit einem zweiten Admin-Konto eine passende Anzeige freigeben. Etwa 2 Minuten später liegt die Mail in Mailpit (http://127.0.0.1:54324). Die Moderations-Mail an den Besitzer kommt im selben Lauf.
- Wieder aus: `supabase db query "delete from vault.secrets where name = 'search_notifications_url'"`

## Nachtrag M7: QA-Funde F1–F5 – 2026-11-05

Bericht: `docs/QA-REPORT.md`, Abschnitte „M7 – Abnahme“ und „M7 – Nachprüfung“.

### Geändert
- **F1:** Unterhaltungsliste und Chat-Ansicht verlangen nur die Anmeldung, nicht die aktuelle Zustimmung. Ohne Zustimmung zeigt die Chat-Ansicht statt der Eingabe den Weg zur Zustimmung; Lesen, Blockieren und Melden bleiben möglich, auch für gesperrte Konten. Schreiben verhindert weiter die DB (`RV001`).
- **F2:** Der Zähler in der Navigation wird beim Zurückkehren in den Tab neu gelesen (erste Rückkehr sofort, dann höchstens alle 30 Sekunden; nicht im Chat, nicht abgemeldet).
- **F3:** Verlässt die Seite den Chat, schließt sie ohne weitere Kanäle die WebSocket.
- **F4:** `confirm_chat_notifications` setzt nach einem erfolgreichen Versand die Versuche auf 0; die Function meldet Erfolge zurück.
- **F5, N2:** ADR 017, SPEC 3.1 (Ausnahme vom Onboarding für Chat-Seiten) und die Lücken hier ergänzt.
- **N1:** Die Function loggt Fehler beim Zurückmelden (`release`/`confirm`) als Zahl.
- **Proben:** `test.fail`/TODO der Abnahme sind normale Tests; neu `42_qa_m7_nachpruefung`, `qa-m7-nachpruefung` (Integration und E2E).

### Testen
- `supabase test db`, `cd web && npm test && INTEGRATION_REQUIRED=1 npm run test:integration && npm run test:e2e`
- Von Hand: Konto mit Unterhaltung, Zustimmung entfernen (`delete from legal_acceptances where user_id = …`), Chat öffnen → Hinweis statt Eingabe, „Aktionen“ → Blockieren geht.

### Cloud-Checkliste (neu)
- Migrationen vor den Edge Functions ausrollen (sonst fehlt `confirm_chat_notifications`; die Function loggt das als `bookkeepingErrors`).

## M7 Chat (Web) – 2026-11-05

Plan `docs/plans/M7-plan.md` mit Architekt-Review (Abschnitte 10/11), ADR 017, SPEC v0.9.

### Geändert
- **Schreibwege nur per RPC:** `start_conversation`, `send_message`, `mark_conversation_read` (Definer, feste Prüfreihenfolge: angemeldet, aktiv, `RV001`, `22023 body`, `RV002`, dann `42501`). Keine Unterhaltung ohne Nachricht. `recipient_id` vom Server, `read_at` nur `null → now()`.
- **Textregeln:** getrimmt, CRLF → LF, keine Steuer- und Bidi-Zeichen, 1–2000 Zeichen; Zod gleich der DB (Fixture `chat_rules.json`).
- **Rate-Limits (`RV002` mit `scope`):** 10 neue Unterhaltungen je 24 h (neue Konten 3), 30 Nachrichten je 10 min (15), 5 ohne Antwort.
- **Lesen per RPC:** Liste mit Keyset, Kopf, Nachrichten vor und nach einer Grenze, Ungelesen-Zähler; Gegenüber mit Rückfall, wenn gesperrt oder gelöscht.
- **Realtime:** privater Broadcast-Kanal `user:<uuid>` ohne Inhalte; nur unter `/account/messages`. Die Seite lädt bei Ereignissen ihren Serverstand neu (keine Lücke), im verborgenen Tab erst beim Sichtbarwerden.
- **Web:** „Nachricht schreiben“ aus dem Detail (Login-Rücksprung mit der Anzeigen-ID im Pfad), Unterhaltungsliste, Chat-Ansicht, Zähler in der Navigation, Senden mit und ohne JavaScript, Nonce-CSP für die Chat-Routen, Sicherheitshinweise.
- **Blockieren und Melden:** aus der Unterhaltung, auch ohne Zustimmung und für gesperrte Konten; Liste blockierter Personen; Melden fremder Nachrichten und des Profils, mit privater Kopie gemeldeter Nachrichten.
- **Hinweise vor dem Senden (SPEC 7.8):** Kontaktdaten für alle, genaue Lage nur für den Besitzer; Senden bleibt möglich.
- **E-Mail-Benachrichtigung:** pg_cron und Edge Function `send-chat-notifications`, nur Nachrichten seit der letzten Mail, je Empfänger höchstens alle 15 Minuten, kein Nachrichtentext, Sprache des Empfängers, Abmeldung im Profil.

### Testen
- `supabase db reset && supabase test db` (pgTAP 06, 36–40 für den Chat)
- `cd web && npm test` (Textregeln, Kontakthinweise), `INTEGRATION_REQUIRED=1 npm run test:integration` (RPCs, Realtime mit zwei Clients, Textregeln gegen die RPC, Mail über Mailpit)
- `npm run test:e2e` (`chat.spec.ts`, `chat-realtime.spec.ts` = Akzeptanz a, `chat-block.spec.ts` = Akzeptanz b, `chat-a11y.spec.ts`)
- Edge Function: `deno task check && deno lint && deno task test` in `supabase/functions/send-chat-notifications` (wie in der CI per Docker)
- Von Hand: zwei Browser (einer privat), zwei Konten. Konto A öffnet eine Anzeige von B und schreibt; B sieht die Nachricht ohne Neuladen, der Zähler steigt. B blockiert A im Menü „Aktionen“; A kann nicht mehr schreiben.

### Akzeptanz (SPEC 6 M7)
- a) Zwei Browser-Sitzungen tauschen Nachrichten in Echtzeit: erfüllt (`chat-realtime.spec.ts`, in beide Richtungen, mit „Gelesen“).
- b) Ein blockierter Nutzer kann nicht mehr schreiben: erfüllt (`chat-block.spec.ts`, in beide Richtungen, auch per API; pgTAP 06/36).

### Bekannte Lücken
- **iOS:** Chat und Push folgen in I5, auf denselben RPCs, Kanälen und Fixtures (ADR 017).
- Meldungs-Warteschlange und Einsicht gesicherter Nachrichten im Admin: M9.
- Abmelden per Klick aus der Mail (RFC 8058): M8–M10. Bis dahin in den Profileinstellungen.
- Mail-Anbieter für die Cloud (HTTP-API, EU): M10. Lokal und in der CI über Mailpit.
- Spam-Erkennung über gleiche Texte: M9/M10.
- Ohne JavaScript geht beim Senden ein Entwurf verloren, wenn die Nachricht ungültig ist oder ein Limit greift (Fehlercode in der URL, nie der Text; Next.js 16.4, ADR 017).
- Profilseite ohne JavaScript: Ihre Abschnitte (auch die neue Einstellung „E-Mail bei neuen Nachrichten“) erscheinen nur mit JavaScript, weil die Seite seit M2 per Suspense streamt. Für M10 (Barrierefreiheit) vorgemerkt.

### Cloud-Checkliste (neu)
- Realtime: „nur private Kanäle“ (öffentlichen Zugriff aus); Grenze gleichzeitiger Verbindungen prüfen (ADR 017).
- Chat-Mails: Vault-Secret `chat_notifications_url` auf `https://<projekt>.supabase.co/functions/v1/send-chat-notifications` setzen (ohne URL ruft der Job nichts auf). `chat_notifications_secret` legt die Migration an. Function-Secrets `MAIL_FROM` und `SITE_URL`; Versand ab M10 über den HTTP-Adapter eines EU-Anbieters (SMTP aus Edge Functions in der Cloud nicht möglich), Öffnungs- und Klick-Tracking aus.
- pg_cron und pg_net aktiv (Migration `chat_notifications`); Job `chat-notifications` jede Minute.

### Lokal von Hand: Chat-Mails
- Ohne Weiteres verschickt lokal nichts automatisch (keine URL im Vault). Zum Ausprobieren einmalig:
  `supabase db query "select vault.create_secret('http://kong:8000/functions/v1/send-chat-notifications', 'chat_notifications_url')"`
  Danach kommt etwa 2 Minuten nach einer ungelesenen Nachricht eine Mail in Mailpit (http://127.0.0.1:54324).
- Wieder aus: `supabase db query "delete from vault.secrets where name = 'chat_notifications_url'"`

## Werkzeuge: Supabase-CLI v3 – 2026-11-05

### Geändert
- Supabase-CLI 2.122.0 → 3.0.0, lokal (Homebrew) und in beiden CI-Workflows gepinnt.
- v3 zielt ohne `--remote` immer auf den lokalen Stack. `--local` ist überflüssig (Warnung, fällt in v4 weg) und wurde aus `admin:local`, den Integrationstests, `gen:types` und der CI entfernt. `admin:local` bricht mit einer CLI unter v3 ab.
- `config.toml`: `[auth.email] enabled = true` und `[auth.sms] enabled = false` statt des veralteten `enable_signup` (gleiche Wirkung). `[local_smtp]` und `project_id` waren schon gesetzt, die lokale Datenbank bleibt beim Wechsel erhalten.
- Die JSON-Ausgaben von `db query` und `status` sind kompatibel; `status` nennt nur noch `MAILPIT_URL`.

### Testen
- `supabase stop && brew upgrade supabase && supabase start`, danach `supabase test db` und `supabase db lint -s public,private --level warning --fail-on warning`
- `cd web && npm run gen:types` erzeugt keine Änderung; `npm run admin:local -- <e-mail>` wie bisher

## Nachtrag M6: QA-Funde F1–F7 – 2026-11-04

Bericht: `docs/QA-REPORT.md`, Abschnitt „M6 – Abnahme“.

### Geändert
- **F1 Nachladen:** Die Karte lädt die Punkte nach jedem Verschieben und Zoomen neu (300 ms entprellt) und bei neuen Filtern. Ältere Abrufe werden abgebrochen. Liste und Karte zeigen nach „In diesem Bereich suchen“ dieselbe Menge.
- **F2 Bereich über 30°:** `viewBbox` rundet erst nach außen und kappt dann auf dem 4-Stellen-Raster auf 30° um die Mitte. Dabei aufgefallen: Zod verwarf gültige Bereiche, deren Differenz in Gleitkomma knapp über 30 lag (89.403 − 59.403). Die Grenze hat jetzt eine Toleranz von 1e-9 wie die exakte Rechnung der DB; der Fall steht in der gemeinsamen Fixture.
- **F3 Steuerelemente:** Zoom-Buttons, Attribution, Marker und Popup von MapLibre sind in de/en/cs/pl beschriftet (`Map.controls`).
- **F4 Genauigkeit:** `map_listings`, `my_favorites` und `provider_listings` laufen mit `extra_float_digits = 3`. Punkte kommen bitgenau wie gespeichert (wichtig für iOS).
- **F5:** `set_listing_location(…, 'set')` ohne `p_lat` oder `p_lng` ergibt `22023 point`, statt den Punkt still zu entfernen.
- **F6:** Beträge in `bbox`, die float8 nicht darstellt (`1e-400`), ergeben `22023 bbox` statt `22003`; `/api/map` antwortet 400 statt 502.
- **F7:** Entfernt ein Moderator den Punkt einer fremden Anzeige, bleibt der Status (aktiv bleibt aktiv, mit Kreismittelpunkt). Audit-Eintrag `listing.point_removed`. Admin-Aktion und Benachrichtigung kommen mit M9.
- **Hinweise aus dem Bericht:** Kein Marker-Layer mehr ohne Hinweis ab 300 Elementen („Bitte hineinzoomen“). `416` der Kachel-Route mit `no-store` statt `immutable`. ADR 016 ergänzt: Dichte im Ring, Lage im Chat geteilt (Hinweis für M7), gleicher Punkt, Hint-Format der Regel für kleine Kreise.
- **Proben:** TODOs in pgTAP `34_qa_m6_abnahme` und `test.fail`/`it.fails` in `e2e/qa-m6.spec.ts` und `lib/qa-m6.test.ts` sind normale Tests; `/api/map` wird bitgenau verglichen. Neu: F7 (Status, Audit, kein Eintrag beim Besitzer), Zufallstest für `viewBbox`.

- **Nachprüfung N1–N4** (QA-REPORT „M6 – Nachprüfung“):
  - **N1:** Zod prüft die 30°-Grenze exakt dezimal wie die DB (statt Toleranz 1e-9). Zwei neue Fälle in der gemeinsamen Fixture (knapp über 30°, Exponentschreibweise).
  - **N2:** Entfernt die Moderation den Punkt einer aktiven oder pausierten Anzeige, gilt die Freigabe ohne Punkt weiter. Fortsetzen nach einer Pause führt nicht mehr in die Prüfung.
  - **N3:** `listing.point_removed` ist im Admin-Audit-Log filterbar und in vier Sprachen benannt, der Status im Detail übersetzt.
  - **N4:** Verschwindet beim Neuzeichnen ein fokussierter Marker oder Cluster (zum Beispiel nach Enter auf einem Cluster), geht der Fokus an den nächstgelegenen neuen Marker, ohne Marker an die Kartenfläche.

### Testen
- `supabase db reset && supabase test db` (828 mit der Nachprüfung)
- `npm test`, `npm run test:integration`, `npm run test:e2e` (Karte: `e2e/map*.spec.ts`, `e2e/qa-m6.spec.ts`)
- Von Hand: `/de/suche?view=map`, verschieben und zoomen → Zahl der Anzeigen auf der Karte ändert sich; weit herauszoomen, „In diesem Bereich suchen“ → „Gefiltert nach Kartenbereich.“

### Offen (nicht in diesem Nachtrag)
- Schriften unter `/static/map/fonts/` ohne Version im Pfad (bei einem Wechsel der Glyphen mitziehen).
- Ausschnitt der Karte mit `bbox` in der URL ist wegen des Rands größer als der Filter.
- `regionGeo()` cacht bei einem DB-Fehler ein leeres Ergebnis.
- Kachel-Route ohne `Range` streamt die ganze Datei (M10, mit WAF und Bandbreite).
- Wortwahl „Lage im Landkreis“ für österreichische Bezirke und kreisfreie Städte mit dem Glossar abstimmen.

## M6 Karte (Web) – 2026-11-02

Plan `docs/plans/M6-plan.md` mit Architekt-Review (Abschnitte 10/11), ADR 016, SPEC v0.8.

### Geändert
- **Migrationen:**
  - `regions_area`, `regions_area_data` (generiert mit `generate.py --areas-out`): Fläche je Region aus VG250 und Statistik Austria, ohne Polygone.
  - `map_point`: Kartenpunkt `map_point` (verfremdeter Punkt oder Kreismittelpunkt), gesetzt vom letzten BEFORE-Trigger nach der Verfremdung, mit Teil-Index. `bbox` im Filterformat v1. Gemeinsame Bedingungsfunktion `private.search_conditions` für Suche und Karte.
  - `map_listings`: Karten-RPC (höchstens 2000 Punkte, ohne `owner_id`, PLZ und Präfix), `point` und `approx` in den Trefferkarten, Cache-Zähler beim Entfernen eines Punkts.
  - `set_listing_location_point`: Punkt über `set_listing_location` mit `p_point` (`keep | set | clear`), kein Punkt in Kreisen unter 400 km². Fehler als Feldcodes (`place.point.small_district`, `place.point.too_far`), nie mit Koordinaten.
  - `region_geo`: Mittelpunkt und Fläche je Region für den Startausschnitt.
- **Web:**
  - Kartengrund: MapLibre mit selbst gehosteten Kacheln (PMTiles von der eigenen Origin, `/tiles/<name>`), Stil je Sprache ohne fremde URLs und ohne Sprites. Schriften (Noto, OFL) und Worker als eigene Datei, CSP mit `worker-src 'self'`. Attribution immer sichtbar.
  - Listen: Umschalter Liste/Karte (`view=map`) und „In diesem Bereich suchen“ (`bbox=`). Cluster und Einzelpunkte sind Buttons, gleiche Koordinaten öffnen eine Kurzkarte mit allen Anzeigen dort. `GET /api/map` liefert GeoJSON, ohne Cache und ohne CORS.
  - Detail: Abschnitt „Lage“ mit Hinweis zur Verfremdung, kleine Karte erst auf Klick.
  - Assistent, Schritt „Ort“: optionale Punktwahl per Klick oder Fadenkreuz und Button (Tastatur). Der gespeicherte Punkt erscheint nur als „So erscheint die Lage öffentlich“, nie als Eingabe. Hinweise bei weiteren Punkten im Kreis und zum Kreiswechsel. In Kreisen unter 400 km² keine Punktwahl.
  - Skripte: `map:download` (Kartenausschnitt mit pmtiles-CLI, fester Version und SHA-256), `map:style`, `map:worker` (vor `dev` und `build`).
- **Neue Abhängigkeiten**, alle BSD-3-Clause mit fester Version:
  - `maplibre-gl` 6.15.0: Karte, wie die SPEC verlangt.
  - `pmtiles` 4.5.0: Kacheln aus einer Datei per Range-Request.
  - `@protomaps/basemaps` 5.7.2: nur devDependency, erzeugt den Stil.

  Transitive Lizenzen der drei Pakete (28 insgesamt): BSD-3-Clause 5, ISC 8, BSD-2-Clause 2, MIT 13. Nichts außer MIT, BSD und ISC.
- **Doku:** ADR 016 mit Bedrohungsmodell und Zahlen, ADR 006 (Nachtrag), ADR 003, SPEC v0.8 (7.10 entschieden, Karte in M9, ODbL in 7.2), Glossar „Karte“, `web/scripts/MAP-SOURCES.md`, `supabase/data/regions/SOURCES.md` (Flächen).
- **Tests:**
  - pgTAP `31_map_point`, `32_map_listings`, `33_set_location_point`, Meta-Test zur Trigger-Reihenfolge.
  - Integration: Karte und Suche liefern für jede gültige Fixture dieselben Anzeigen; kleiner Kreis über die API.
  - Vitest: Range, Bereich, Punkt aus dem Formular, keine Koordinaten in Logs und URLs, Stil, Schriften, Worker, CSP.
  - E2E `map-smoke`, `map` und `map-picker`.

### Testen
- Einmalig `cd web && npm run map:download -- --fixture` (7 MB) und für die Entwicklung `npm run map:download` (1,2 GB). Der Dev-Server findet die Dateien in `web/.cache/map/` selbst.
- `supabase db reset && supabase test db` (767), `cd web && npm test` (442), `npm run test:integration` (176), `npm run test:e2e`
- Manuell:
  1. `/de/jagdpacht?view=map` öffnen, Cluster anklicken, Punkt anklicken, zum Detail.
  2. Ausschnitt verschieben, „In diesem Bereich suchen“ wählen.
  3. Im Assistenten (Schritt „Ort“, Kreis über 400 km²) einen Punkt setzen und speichern. Der öffentliche Marker liegt 3–5 km daneben.

### Messung
- `map_listings` mit 10.000 synthetischen Anzeigen, als anon, lokal, Transaktion mit Rollback:

  | Fall | Laufzeit |
  |---|---|
  | DE+AT (2000, gekappt) | 472 ms |
  | Bayern | 114 ms |
  | kleiner Ausschnitt (40 Punkte) | 218 ms |
  | mit Volltext | 288 ms |

  Die Bereichsabfrage selbst nutzt `listings_map_point_idx` (0,04 ms). Den Rest kostet die Sichtbarkeitsprüfung je Zeile (`listing_is_public`). Das liegt unter 1 s, bei mehr Daten zuerst diese Prüfung angehen (z. B. mit einem Join statt Funktionsaufruf je Zeile).
- **Bundle:** Die Karte lädt nur, wenn sie geöffnet wird. Start, Liste ohne Karte und Detail vor dem Klick laden kein MapLibre (E2E). Mit Karte, gzip:

  | Teil | Größe |
  |---|---|
  | MapLibre | 293 KB |
  | pmtiles und Kartenkomponenten | etwa 38 KB |
  | CSS | 10 KB |
  | Worker | 147 KB |
  | Stil | 3 KB |

  LCP und INP auf einem Mittelklasse-Telefon misst M10.
- **Cache Storage:** Über das pmtiles-Protokoll legt MapLibre keine Kacheln im Cache Storage des Browsers ab (E2E prüft `caches.keys()`). Die Datenschutzerklärung (M9) nennt die Karte, aber keinen Browser-Speicher.

### Akzeptanz (SPEC 6 M6)
- [x] Die Karte zeigt nur verfremdete Positionen: Kartendaten gleich `display_location` bzw. Kreismittelpunkt, der Eingabepunkt in keiner Antwort (pgTAP `31`, E2E „Akzeptanz a“)
- [x] Klick öffnet das Detail, auch bei gestapelten Anzeigen (E2E „Akzeptanz b“)

### Bekannte Lücken
- **iOS (I3, I4):** nutzt `map_listings` und `set_listing_location` mit `p_point` unverändert (MapKit, keine Kacheln von uns); noch nicht umgesetzt.
- **Produktions-Hosting** der Kartendatei (M10):
  - EU-Objektspeicher oder CDN mit Range und stabilem ETag
  - AVV
  - Logs ohne IP oder höchstens 7 Tage
  - Rate-Limit bzw. WAF für `/tiles/` und `/api/map`
  - `MAP_TILES_FILE` setzen
- Über 2000 Anzeigen im Ausschnitt: Hinweis „hineinzoomen“ statt Zählung je Rasterzelle (Review H1, spätestens bei 1000 Anzeigen nachziehen).
- Startausschnitt aus Mittelpunkt und Fläche, nicht aus den echten Grenzen (Review H3).
- In der CI laufen alle Kartentests gegen den Produktions-Build mit Software-WebGL, aber ohne Kartendatei (neutraler Grund). Nur der Test der Kachel-Route wird dort übersprungen; er läuft lokal mit der Fixture.

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
