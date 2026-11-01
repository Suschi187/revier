# QA-Bericht

## M0 – 2026-10-29

Geprüfter Stand: `679fe80` (main, Arbeitsbaum sauber). Umgebung: macOS, Node 24.22.1, npm 11.19.1, lokales Supabase (CLI), Google Chrome headless.
Planänderungen des Nutzers werden nicht als Fehler gewertet: kein iOS-Gerüst in M0 (erst I1), Supabase nur lokal (Cloud ab M2).

### Ergebnis je Akzeptanzkriterium

| # | Kriterium | Ergebnis | Nachweis |
|---|-----------|----------|----------|
| a | `npm run dev` zeigt die lokalisierte Startseite in allen 4 Sprachen | **erfüllt** | Dev-Server (`next dev`, Port 3000, war schon gestartet; auf 3456 verweigert Next einen zweiten Dev-Server im selben Verzeichnis): `/de`, `/en`, `/cs`, `/pl` liefern 200, `<html lang>` passt, `<h1>`, Titel und Description sind übersetzt. Dasselbe gilt für `next start -p 3456`. |
| b | Lint, Typecheck und ein Beispieltest laufen grün | **erfüllt** | `npm run lint`, `npm run typecheck` und `npm test` (2 Dateien, 12 Tests) laufen grün. `npm run build` läuft ohne Warnungen. |
| c | Supabase-Verbindung funktioniert | **erfüllt** | `npm run check:supabase`: Auth-Health 200, Storage 200. Gegenproben: falscher Key gibt Storage HTTP 400 und Exit 1, falsche URL gibt ECONNREFUSED und Exit 1, fehlende Env gibt eine Meldung und Exit 1. Einschränkung siehe F3: Auch der secret- bzw. service_role-Key besteht den Check. |

### Definition of Done (CLAUDE.md)

| Punkt | Ergebnis |
|-------|----------|
| Build ohne Warnungen, Lint und Typecheck grün | erfüllt |
| Tests grün | erfüllt (12/12) |
| Neue Texte in 4 Sprachen, en als Quelle | erfüllt, alle Keys gleich und nicht leer (per Test abgesichert). Abstimmung mit dem Glossar ist unvollständig, siehe F4. |
| Nichts hartcodiert | erfüllt. In `app/` und `components/` stehen keine sichtbaren Strings im JSX, alle Texte kommen über `getTranslations`/`useTranslations`. |
| Lücken Web/iOS im CHANGELOG vermerkt | erfüllt (iOS ab I1) |
| RLS für neue Tabellen | nicht zutreffend (keine Migrationen, `seed.sql` leer) |
| CHANGELOG-Eintrag mit Testanleitung | erfüllt. Die Testanleitung wurde nachvollzogen und funktioniert. |

### Web-Pflichten (M0-relevant)

| Prüfung | Ergebnis |
|---------|----------|
| Kein service_role- oder secret-Key in `.next/static` | erfüllt. Weder `sb_secret_`, `service_role` noch die lokalen Key-Werte kommen vor. Auch der publishable Key ist nicht im Client-Bundle, weil er nur serverseitig genutzt wird. |
| `.env.example` versioniert, `.env.local` ignoriert | erfüllt (`web/.gitignore:34`, Root-`.gitignore` mit `.env.*` und `!.env.example`) |
| `git ls-files` und Git-Historie ohne Secrets | erfüllt (Suche nach `sb_secret_`, `sb_publishable_…` und `eyJhbGciOi` in allen Commits ohne Treffer) |
| Security-Header | erfüllt: nosniff, Referrer-Policy, X-Frame-Options DENY, Permissions-Policy, kein `X-Powered-By`; HSTS nur bei `next start` (prod), nicht in dev. Eine CSP fehlt bewusst (CHANGELOG). |
| `<html lang>` | erfüllt auf allen Startseiten. Die serverseitig ausgelieferte 404 im Prod-Build hat kein `lang`, siehe F2. |
| hreflang und Canonical absolut | im HTML erfüllt (`metadataBase` aus `NEXT_PUBLIC_SITE_URL`, x-default → `/de`). Zusätzlich setzt die Middleware einen widersprüchlichen `Link`-Header, siehe F1. |
| Lokalisierte 404 für unbekannte Pfade | teilweise: Status 404, `noindex`, der Text ist lokalisiert (de/pl geprüft). Im Prod-Build kommt der Inhalt aber nur clientseitig (F2). Für Pfade mit Punkt und `/api/*` erscheint die englische Next-Standardseite (F6). |
| Lokalisierte 404 für unbekannte Locale | erfüllt: `/xx` und `/fr` leiten per 307 auf `/de/xx` bzw. `/de/fr` um, danach kommt die deutsche 404. |
| Redirect `/` → `/de` und per Accept-Language | erfüllt: Ohne Header geht es auf `/de`, mit `en-US` auf `/en`, mit `cs-CZ` auf `/cs`, mit `pl` auf `/pl`, mit `fr-FR` auf `/de` (Fallback) und mit `de-AT` auf `/de`. |
| Cookie-Consent, Impressum, Datenschutz, noindex Admin | nicht zutreffend für M0 (M9/M4) |

### Lokalisierung

- Keys sind vollständig und nicht leer, in allen 4 Sprachen per Test abgesichert.
- Keine hartcodierten Strings in Komponenten.
- Die Sprachnamen im Umschalter sind Endonyme mit `lang`-Attribut. Das ist korrekt.
- Abweichungen vom Glossar: siehe F4. cs/pl sind laut CHANGELOG muttersprachlich ungeprüft (bekannte Lücke, SPEC 7.6).
- Abgeschnittene Texte: Bei 500 px Breite gibt es keine Abschneidungen, pl ist die längste Sprache. 360 px ist mit Chrome headless **nicht prüfbar**, weil das Fenster mindestens etwa 500 px breit ist. Empfehlung: Playwright mit Mobile-Viewport.

### Accessibility (Startseite)

- Sprachumschalter: `<nav aria-label>` ist lokalisiert („Sprache“, „Language“, „Jazyk“, „Język“), `aria-current="page"` steht auf der aktiven Sprache, `hrefLang` und `lang` sind je Link gesetzt. Erfüllt.
- Tastatur: Es sind native `<a href>`-Links in sinnvoller DOM-Reihenfolge. Tailwind-Preflight entfernt den Fokus-Rahmen nicht. Grob erfüllt. Ein interaktiver Tab-Durchlauf wurde nicht ausgeführt, das bleibt Aufgabe eines Playwright-Tests.
- Kontrast: hell #171717 auf #ffffff ≈ 17,9:1, dunkel #ededed auf #0a0a0a ≈ 16,8:1. Erfüllt (WCAG AA).
- Überschriften: genau eine `<h1>` pro Seite, `<main>` ist vorhanden.

### CI (`.github/workflows/web.yml`)

Die CI wurde lokal simuliert. Dazu wurde ein sauberer Export (`git archive HEAD`) im Scratchpad angelegt, damit dort kein `.env.local` liegt, und die Env wurde wie im Workflow gesetzt (`CI=true`, Platzhalter-Env, `NEXT_TELEMETRY_DISABLED=1`).
- `npm ci`, `lint`, `typecheck`, `test` und `build` laufen alle mit Exit 0. Der Build ohne Env bricht mit einer klaren Zod-Meldung ab. Das ist gewollt.
- Der Secret-Guard (grep aus dem Repo-Root) findet nichts.
- Hinweis zu `.env.local`: Im Repo-Verzeichnis lädt `next build` `.env.local` trotz gesetzter Variablen („Environments: .env.local“). Explizit gesetzte Prozessvariablen haben Vorrang, aber Variablen, die nur in `.env.local` stehen, würden mitgelesen. Deshalb wurde ein Export genutzt. In der echten CI gibt es kein `.env.local`.
- Kleinere Punkte: siehe F8.

### Gefundene Fehler

#### F1 – mittel – Middleware setzt widersprüchliche hreflang-Angaben per `Link`-Header und übernimmt den Host-Header
next-intl (`alternateLinks` ist standardmäßig aktiv) setzt bei jeder Antwort einen HTTP-`Link`-Header mit hreflang. Er widerspricht dem HTML (x-default `/` statt `/de`). Er nimmt den Origin aus dem Request statt aus `NEXT_PUBLIC_SITE_URL`, spiegelt also `Host` und `X-Forwarded-Host`. Außerdem steht er auch auf 404-Seiten. Zusammen mit `Cache-Control: s-maxage=31536000` auf statischen Seiten besteht ein Risiko für Cache-Poisoning bzw. falsche hreflang-Signale hinter einem CDN.
Reproduktion:
1. `npm run build && npx next start -p 3456`
2. `curl -sI -H "Host: evil.example" http://localhost:3456/en | grep -i ^link` → `<http://evil.example/de>; … hreflang="x-default" <http://evil.example/>`
3. `curl -s http://localhost:3456/en | grep x-default` → `http://localhost:3000/de`
4. `curl -sI http://localhost:3456/de/gibtsnicht | grep -i ^link` → hreflang-Links auf einer 404
Erwartet: Es gibt nur eine hreflang-Quelle (das HTML) mit `NEXT_PUBLIC_SITE_URL`. Vorschlag: `alternateLinks: false` in `web/i18n/routing.ts`.

#### F2 – mittel – Lokalisierte 404 wird im Prod-Build nicht serverseitig gerendert
Bei `next start` enthält die HTML-Antwort für `/de/gibtsnicht` nur eine leere Hülle (`<html id="__next_error__">`, ohne `lang`, ohne Text). Der Inhalt wird per Client-Resume (`__NEXT_CLIENT_RESUME`) nachgeladen. Ohne JavaScript, für einfache Crawler und für manche Screenreader-Situationen ist die Seite leer. Im Dev-Modus wird die 404 dagegen serverseitig gerendert, das ist abweichendes Verhalten. Der `<title>` der 404 ist nur „Revier“ und nicht lokalisiert (etwa „Seite nicht gefunden | Revier“).
Reproduktion:
1. `npm run build && npx next start -p 3456`
2. `curl -s http://localhost:3456/de/gibtsnicht | grep -c "Seite nicht gefunden"` → 0, und `<html>` hat kein `lang`
3. Im Browser mit JavaScript erscheint „Seite nicht gefunden“ mit `lang="de"`, Titel „Revier“.
Erwartet: Die 404 kommt serverseitig mit `lang` und lokalisiertem Titel. Vermutlich hängt das mit `cacheComponents`/`partialPrefetching` und `notFound()` im Catch-all zusammen.

#### F3 – mittel – Anon-Key-Variable akzeptiert secret- und service_role-Keys
Weder `web/lib/env.ts` noch `scripts/check-supabase.mjs` prüfen, ob in `NEXT_PUBLIC_SUPABASE_ANON_KEY` wirklich ein anon- bzw. publishable Key steht. Ein versehentlich eingetragener `sb_secret_…`- oder service_role-JWT besteht Validierung und Check („anon-Key akzeptiert“) und würde ab dem ersten Client-Einsatz (M2) ins Browser-Bundle gelangen.
Reproduktion:
1. `supabase status -o json` → `SECRET_KEY` bzw. `SERVICE_ROLE_KEY` kopieren
2. `cd web && NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 NEXT_PUBLIC_SUPABASE_ANON_KEY=<secret> node scripts/check-supabase.mjs` → zwei ✓, Exit 0
Erwartet: Env-Validierung und Check lehnen `sb_secret_*` und JWTs mit `role=service_role` ab.

#### F4 – mittel – Fachbegriffe nicht mit `docs/GLOSSARY.md` abgestimmt
Die DoD verlangt die Abstimmung der Fachbegriffe. Die Startseite verwendet alle 5 Arten, aber:
- cs/pl-Spalten im Glossar sind leer, obwohl `cs.json` und `pl.json` Begriffe festlegen (z. B. cs „pronájem honiteb“, „povolenky k lovu“; pl „dzierżawa obwodów łowieckich“, „odstrzały“, „polowania zbiorowe“). Diese Begriffe gehören als „ungeprüft“ ins Glossar, sonst übersetzt iOS sie in I1 anders.
- de weicht ab: „Trophäenjagden“ statt „Trophäen-/Gastjagd“ und „Jagdhelfer“ statt „Jagdhelfer/Mitjäger“. en weicht ab: „trophy hunts“ statt „Trophy / guest hunt“.
- pl „odstrzały“ für Begehungsschein ist fachlich zweifelhaft und sollte von Muttersprachlern geprüft werden.
Reproduktion: `web/messages/*.json` (`HomePage.intro`) mit `docs/GLOSSARY.md` vergleichen.

#### F5 – niedrig – Titel-Template wird auf der Startseite nicht angewendet
`title.template` (`%s | Revier`) steht in `app/[locale]/layout.tsx`. Laut Next-Doku gilt es nicht für `page.tsx` im selben Segment. Der Titel der Startseite ist deshalb „Jagdgelegenheiten in Mitteleuropa“ ohne Markennamen. Für die Startseite kann das gewollt sein, für künftige Seiten direkt unter `[locale]` aber nicht.
Reproduktion: `curl -s http://localhost:3456/de | grep -o "<title>[^<]*"`.

#### F6 – niedrig – Pfade mit Punkt und `/api/*` zeigen eine englische Standard-404 mit Startseiten-Metadaten
Der Matcher in `proxy.ts` nimmt Pfade mit Punkt aus. `/foo.png` wird deshalb als `[locale]=foo.png` behandelt. Ergebnis ist die englische Next-404 („This page could not be found.“) ohne `lang`. Im Head stehen zusätzlich der deutsche Startseitentitel, `canonical` → `/de` und hreflang-Links (neben `noindex`).
Reproduktion: `http://localhost:3456/foo.png` im Browser öffnen und den DOM prüfen (zwei `<title>`, `link rel=canonical href=…/de`). Bei `/api/x` erscheint ebenfalls die englische 404.
Erwartet: Es kommt eine neutrale bzw. lokalisierte 404 ohne Canonical und hreflang (z. B. `global-not-found` oder `notFound()` vor der Metadaten-Erzeugung bei ungültiger Locale).

#### F7 – niedrig – Locale-Cookie wird ohne Nutzeraktion gesetzt, auch auf langfristig cachebaren Antworten
Jede Antwort setzt `NEXT_LOCALE=…` (Session-Cookie), auch `/de` mit `Cache-Control: s-maxage=31536000`. Für M9 (Consent) muss geklärt werden, ob das Cookie als „notwendig“ gilt. Ein CDN darf Antworten mit `Set-Cookie` nicht cachen. Vorschlag: next-intl `localeCookie` nur beim Sprachwechsel setzen oder deaktivieren.
Reproduktion: `curl -sI http://localhost:3456/de | grep -iE "set-cookie|cache-control"`.

#### F8 – niedrig – CI-Kleinigkeiten
- ADR 004 sagt „läuft bei Änderungen unter `web/`“, der Workflow hat aber keinen `paths`-Filter und läuft immer. Entweder die ADR oder den Workflow anpassen.
- Der Build meldet „No build cache found“. Vorschlag: `.next/cache` per `actions/cache` cachen.
- `npm ci` mit npm 11 meldet `install-scripts`-Warnungen (Skripte von `@swc/core`, `unrs-resolver`, `@parcel/watcher` werden nicht ausgeführt). Der Build ist trotzdem grün. Die Freigaben sollten bewusst entschieden werden.
- Der Secret-Guard prüft nur das Präfix `NEXT_PUBLIC_*SERVICE|SECRET`, nicht die Key-Werte selbst (`sb_secret_`, JWTs). Vorschlag: gitleaks o. Ä. ergänzen (ADR, neue Abhängigkeit).

#### F9 – niedrig – Ungenaue Fehlermeldung in `check-supabase.mjs`
Fehlt nur eine der beiden Variablen, meldet das Skript trotzdem, dass beide fehlen.
Reproduktion: `cd web && NEXT_PUBLIC_SUPABASE_ANON_KEY=x node scripts/check-supabase.mjs` → „NEXT_PUBLIC_SUPABASE_URL und NEXT_PUBLIC_SUPABASE_ANON_KEY fehlen“.

### Nicht prüfbar in M0

- iOS (App-Store-Pflichten, XCTest, UI-Tests): kein Xcode-Projekt bis I1 (Planänderung)
- Gleichstand der Filter Web/iOS: erst ab M5/I2
- RLS-Policy-Tests: noch keine Tabellen (M1)
- E2E-Kernflows: Funktionen existieren noch nicht
- Offline-Verhalten: nicht relevant für eine statische Startseite
- Darstellung bei 360 px: mit dem verfügbaren Werkzeug nicht prüfbar (siehe oben)
- CI auf GitHub: kein Remote; lokal simuliert

### Vorgeschlagene Tests (nicht angelegt)

- Playwright: `/` → `/de` und Accept-Language-Varianten; vier Locales mit `lang`, `h1` und `aria-current`; 404 mit Status 404, `noindex` und lokalisiertem Text **mit `javaScriptEnabled: false`** (deckt F2 ab); Security-Header; hreflang und Canonical absolut und konsistent, kein `Link`-Header (F1); Tab-Reihenfolge im Sprachumschalter; Mobile-Viewport 360 px ohne horizontales Scrollen in pl.
- Vitest: `localeAlternates()` (alle Locales, x-default, Pfad mit Unterseite); `parsePublicEnv` lehnt `sb_secret_*` und service_role-JWT ab (F3); Glossar-Konsistenztest (Begriffe aus `GLOSSARY.md` kommen in den Messages vor).
- Skript-Test: `check:supabase` mit falschem Key und falscher URL liefert Exit 1.

### Empfehlung

M0 **abnehmen: ja, mit Auflagen.** Alle drei Akzeptanzkriterien sind erfüllt, es gibt keinen blockierenden oder hohen Fehler. F1 bis F4 (mittel) sollten vor oder spätestens in M2 behoben werden: F3 vor dem ersten Client-Einsatz des Keys, F4 vor I1.

### Nachtrag 2026-10-29: Stand der Behebung

| Fund | Status | Commit |
|------|--------|--------|
| F1 hreflang-Link-Header | behoben (`alternateLinks: false`) | d912428 |
| F2 404 nur clientseitig | behoben (statische, mehrsprachige `global-not-found`, Catch-all entfernt) | a28ea72 |
| F3 Secret-Key als anon-Key | behoben (Env-Validierung und `check:supabase` lehnen `sb_secret_*` und service_role-JWT ab) | d536f22 |
| F4 Glossar | offen: Begriffe brauchen Muttersprachler (SPEC 7.6), vor I1 klären | – |
| F5 Titel-Template Startseite | behoben | a28ea72 |
| F6 Pfade mit Punkt / `/api` | behoben (Proxy leitet um → 404; öffentliche Dateien unter `public/static/`) | a28ea72 |
| F7 Locale-Cookie | offen, bewusst nach M9 (Consent) verschoben | – |
| F8 CI-Details | behoben (Guard erweitert, Build-Cache, ADR 004 angepasst, install-scripts dokumentiert) | 1181601 |
| F9 Meldung `check-supabase` | behoben | d536f22 |

Hinweis für M5: Unter `cacheComponents` brauchen dynamische Seiten mit `notFound()` (z. B. Anzeigen-Detail) eine `<Suspense>`-Grenze bzw. `use cache`. Das muss beim Bau geprüft werden, damit die 404 serverseitig mit Status 404 ausgeliefert wird.

## M1 – 2026-10-29

Geprüfter Stand: `196e53c` (main, Arbeitsbaum sauber). Umgebung: macOS, Node 24.22.1, Supabase CLI 2.122.0 (lokal), Docker.
Vorgehen: `supabase db reset` und `supabase test db`, danach eine unabhängige Prüfung über die echten APIs mit vier echten Nutzern (`/auth/v1/signup`, `/rest/v1`, `/storage/v1`): 170 Einzelprüfungen per Skript außerhalb des Repos, keine neuen Testdateien. Admin mit 2FA: Die lokale TOTP-Anmeldung ist abgeschaltet (`[auth.mfa.totp] enroll_enabled = false`). Deshalb wurden JWTs mit `aal1`/`aal2` mit dem lokalen JWT-Secret signiert; ein echter Login wurde zusätzlich geprüft (Hook setzt `app_role = admin`, `aal1`).

### Ergebnis je Akzeptanzkriterium

„Test beweist, dass Nutzer A weder Nachrichten, Verifizierungsdokumente noch Entwürfe von Nutzer B lesen kann“

| # | Teil | Ergebnis | Nachweis pgTAP | Nachweis API (unabhängig) |
|---|------|----------|----------------|---------------------------|
| a | Nachrichten | **erfüllt** | `supabase/tests/06_chat_blocks.test.sql`: „B liest die Nachrichten von A und dem Anbieter nicht“, „B sieht die Unterhaltung nicht“, „anon liest keine Nachrichten“, „Auch Admins lesen Chats nicht pauschal“ | Fremder Nutzer A: `messages?select=*`, `messages?id=eq.<fremd>`, `messages?body=like.*geheim*`, `conversations?select=*,messages(*)`, `listings?select=id,conversations(*,messages(*))` liefern `[]`. anon: 401/42501. Schreiben in fremde Unterhaltung 403, fremde Nachricht als gelesen markieren 0 Zeilen, Textänderung 403. |
| b | Verifizierungsdokumente | **erfüllt** | Tabelle: `07_trust_audit.test.sql` („B liest die Verifizierung von A nicht“, anon 42501, Admin aal1 0, aal2 1). Bucket: `08_storage.test.sql` („B sieht den Jagdschein von A nicht“, anon, Admin aal1/aal2, kein Upload in fremden Ordner) | B und anon: `verifications` leer bzw. 401. Storage: `object/`, `object/authenticated/`, `object/public/`, `object/info/…`, HEAD, Signed URL (einzeln und mehrfach), `list` mit Präfix `<A>` und leerem Präfix, PUT, Upsert, DELETE, `copy`/`move` in den eigenen Ordner bzw. anderen Bucket: alle abgelehnt oder leer, die Datei bleibt erhalten. Pfadtricks beim Upload (`<B>/../<A>/…`, `%2e%2e`, `%2F`, `./<A>/…`, UUID in Großbuchstaben) und beim Lesen: abgelehnt. Admin: aal1 sieht nichts, aal2 sieht Zeile und Datei, nach Entzug der Rolle sofort nichts mehr. |
| c | Entwürfe | **erfüllt** | `04_listings.test.sql` („B liest den Entwurf von A nicht“, „anon sieht keine Entwürfe“, „A sieht die Fotos des Entwurfs von B nicht“), `08_storage.test.sql` (Entwurfsfotos für A und anon unsichtbar) | B und anon: `listings?id=eq.<Entwurf>`, `HEAD` mit `count=exact` (`*/0`), `listings?select=*,listing_photos(*),listing_species(*)`, `listing_photos`/`listing_species` des Entwurfs, Embeddings über `public_profiles→listings`, `regions→listings`, `game_species→listing_species`, Volltext `wfts(german)`: kein Entwurf. Storage-Foto des Entwurfs: GET/authenticated/public/sign/list abgelehnt bzw. leer. Existenz-Orakel über Favorit, Unterhaltung, Meldung: 42501. PATCH/DELETE durch B: 0 Zeilen. |

Die Akzeptanz ist in pgTAP für alle drei Teile ausdrücklich abgedeckt. Die Storage-API-Prüfung im CHANGELOG („zusätzlich über die Storage-API geprüft“) ist nicht automatisiert, das ist nach ADR 009 für M2 geplant.

### Vollständigkeit gegen SPEC 3.1 (v0.3)

| Tabelle | Ergebnis | Abweichung | Dokumentiert? |
|---------|----------|------------|---------------|
| profiles | vollständig | – | – |
| verifications | vollständig inkl. `decided_at`, `document_deleted_at`, `document_path` nullable | eigenes Enum `verification_request_status` (ohne `none`); `reviewed_at` und `decided_at` werden identisch gesetzt | Enum nein (nur Migration), sonst ja (SPEC 3.1, ADR 008) |
| regions | vollständig | `unique (code)` statt `unique (country, level, code)` (strenger); Slug eindeutig je (`country`, `level`) statt „je Land“ (ADR 007), Berlin/Hamburg/Wien haben denselben Slug auf beiden Ebenen | nein (F4) |
| listings | vollständig, alle Enums wie SPEC | `country` wird aus der Region abgeleitet; `search_vector` je Sprache (de/en mit Stemming, cs/pl `simple`) | ja (Migration, sinnvoll) |
| listing_photos | vollständig, max. 8 per Trigger und Check | `storage_path` nicht an Besitzer/Anzeige gebunden (F3) | – |
| game_species | vollständig, 14 Arten inkl. aller in SPEC genannten Codes | – | cs/pl ungeprüft (CHANGELOG) |
| listing_species | Spalten vollständig | keine Spalte `id` (zusammengesetzter PK), SPEC verlangt `id` für alle Tabellen | nein (F4) |
| favorites, blocks, conversations, messages | vollständig inkl. Unique-Constraints | – | – |
| saved_searches | vollständig | zusätzliche Spalte `notify_email` | nur Migrationskommentar (F4) |
| reports | vollständig | zusätzliche Spalte `handled_at`; Meldende lesen eigene Meldungen (SPEC 3.4: „Read nur Admin“) | nur Migrationskommentar (F4) |
| reviews | vollständig, gesperrt (nur Admin liest) | – | ja |
| devices | vollständig | – | – |
| audit_log | angelegt (`actor_id`, `action`, `target_type`, `target_id`, `details`) | – | ja |
| SPEC 3.4 Statuslogik | umgesetzt | zusätzliche Übergänge: Besitzer `rejected→draft`, `rejected→pending_review`, `expired→pending_review`; Admin `pending_review→draft` („Bearbeitung anfordern“, SPEC 5) | nein in SPEC 3.4 (F4) |
| Indizes | vorhanden (Status/Land/Art, Region, Besitzer, Preis, GIN Volltext, GiST Standort, Chat, Meldungen) | – | – |

### Definition of Done (CLAUDE.md)

| Punkt | Ergebnis |
|-------|----------|
| RLS für jede Tabelle | erfüllt: Meta-Test `00_meta.test.sql` (RLS an, mindestens eine Policy, keine Rechte auf `private`, keine ausführbaren Funktionen in `public`). Gegenprobe über PostgREST siehe unten. |
| Policies getestet | erfüllt für das Akzeptanzkriterium und die Kernregeln (170 pgTAP-Tests grün). Die in ADR 009 versprochene volle Prüfmatrix je Tabelle fehlt teilweise, und der Server-Pfad (`service_role`) ist ungetestet (F2, F5). |
| Tests grün | erfüllt: `supabase test db` 9 Dateien, 170 Tests PASS; Web `npm test` 3 Dateien, 18 Tests PASS |
| Lint, Typecheck, Build (Web, mit `web/.env.local`) | erfüllt: `npm run lint`, `npm run typecheck`, `npm run build` grün, ohne Warnungen |
| `supabase db lint -s public,private --level warning` | erfüllt: „No schema errors found“ |
| Generierte Typen aktuell | erfüllt: `supabase gen types typescript --local --schema public` ist identisch mit `web/lib/supabase/database.types.ts` |
| CHANGELOG mit Testanleitung | erfüllt, die Anleitung wurde nachvollzogen |
| Texte in 4 Sprachen | nicht zutreffend für UI; Datennamen cs/pl ungeprüft (CHANGELOG) |
| Lücken Web/iOS vermerkt | nicht zutreffend (nur Backend) |

### Explorative Negativtests (PostgREST, Storage)

Alle erwarteten Ablehnungen sind eingetreten, außer F1–F3:
- **Besitzer-PATCH:** `draft→active`, `draft→removed` und `draft→expired` werden abgelehnt (42501 „Statuswechsel … nicht erlaubt“). `owner_id`, `expires_at`, `country`, `created_at`, `id` → 42501 (keine Spaltenrechte). `reject_reason` → 42501 (Trigger). `region_id` auf Bundesland → 23514. POST mit `status=active`, `expires_at` oder fremder `owner_id` → 42501. `draft→pending_review` ist erlaubt.
- **Profile:** PATCH auf `verification_status`, `is_blocked`, `deleted_at`, `user_id` → 42501. B sieht in `profiles` nur sich selbst; anon 401.
- **Embedding:** `listings?select=*,profiles(*)` gibt für anon 401, für Nutzer bei fremden Anzeigen `profiles: null`. `listings?select=id,public_profiles(*)` liefert nur die freigegebenen Spalten (gewollt). `listings→reports` hat keine Beziehung (PGRST200, gewollt: Meldeziele ohne FK).
- **Schema private:** `Accept-Profile: private` / `Content-Profile: private` für `user_roles`, `app_settings`, `listing_location_offsets`, RPC `is_admin` und `custom_access_token_hook` → 406 PGRST106. Ebenso für `extensions`, `auth` und `storage`. RPCs `is_admin`, `write_audit`, `setting_int` im Standardschema → 404 PGRST202. Das OpenAPI-Schema nennt keine private-Objekte. `spatial_ref_sys` ist nicht erreichbar. GraphQL ist nicht aktiv.
- **Standort:** Der gespeicherte Punkt weicht vom eingegebenen ab (pgTAP prüft 3–5 km).
- **Storage, sonstiges:** HTML-Upload (MIME) wird abgelehnt. Bucket anlegen oder öffentlich schalten als Nutzer: abgelehnt. `<B>//x.jpg` und `<B>/./x.jpg` werden von der Storage-API zu `<B>/x.jpg` normalisiert und landen im eigenen Ordner. Das ist kein Fehler.
- **Admin:** aal1 (echter Login und signiertes Token) sieht keine Verifizierungen, Entwürfe oder Dokumente und kann nicht entfernen. aal2 sieht alles und gibt frei (`expires_at` +60 Tage). Ein Entzug der Rolle wirkt sofort. Admins lesen keine fremden Chats, das Audit-Log ist für alle über die API leer, solange noch keine Moderationsaktion lief.

### Regionendaten (Stichprobe)

Anzahl: DE 16 Länder + 401 Kreise, AT 9 Bundesländer + 94 Bezirke. 401 ist plausibel für Stand 01.01.2026: Hessen hat 27 Einträge, weil Hanau (`DE-06415`) seit 2026 kreisfrei ist. Alle Codes passen zum Präfix des Elternlands, kein Punkt liegt außerhalb der Landes-Bounding-Box, keine doppelten Slugs.

| Code | Name | Eltern | Punkt (lat, lon) | Bewertung |
|------|------|--------|------------------|-----------|
| DE-09162 | München (Stadt) | DE-BY | 48.154, 11.524 | plausibel |
| DE-05315 | Köln | DE-NW | 50.957, 6.953 | plausibel |
| DE-11000 | Berlin | DE-BE | 52.514, 13.374 | plausibel |
| DE-04012 | Bremerhaven | DE-HB | 53.540, 8.609 | plausibel |
| DE-16063 | Wartburgkreis | DE-TH | 50.888, 10.239 | plausibel (Eisenach eingegliedert, 22 Kreise in TH korrekt) |
| AT-601 | Graz (Stadt) | AT-6 | 47.073, 15.445 | plausibel |
| AT-701 | Innsbruck-Stadt | AT-7 | 47.285, 11.375 | plausibel |
| AT-900 | Wien | AT-9 | 48.221, 16.368 | plausibel |

Kosmetisch: Die AT-Namen sind uneinheitlich („Graz (Stadt)“, aber „Innsbruck-Stadt“). Das entspricht vermutlich der amtlichen Schreibweise und ist kein Fehler.

### Gefundene Fehler

#### F1 – hoch – E-Mail-Lokalteil wird öffentlich als Anzeigename gezeigt, alle Konten sind aufzählbar
`private.handle_new_user()` setzt ohne `display_name` in den Metadaten den Teil der E-Mail vor dem `@` als `display_name`. `public_profiles` ist für anon lesbar und listet **alle** aktiven Konten mit `user_id` und `display_name`, auch ohne Anzeige. Das betrifft z. B. Magic Link und Sign in with Apple, wenn kein Name mitkommt. Aus `max.mustermann@…` wird öffentlich „max.mustermann“. Das widerspricht „keine Kontaktdaten auf öffentlichen Seiten“ und der Datensparsamkeit (SPEC 8). `user_id` steht außerdem nicht in der Liste der öffentlichen Felder in SPEC 3.4.
Reproduktion:
1. `curl -s -X POST http://127.0.0.1:54321/auth/v1/signup -H "apikey: <publishable>" -H "Content-Type: application/json" -d '{"email":"max.mustermann@example.com","password":"Test-Passwort-123!"}'`
2. `curl -s "http://127.0.0.1:54321/rest/v1/public_profiles?select=*" -H "apikey: <publishable>"` → Eintrag mit `"display_name":"max.mustermann"`. Alle Konten erscheinen.
Erwartet: ein neutraler Platzhalter (z. B. „Jäger 4711“) oder Pflichteingabe in M2. Öffentlich nur Profile, die etwas Öffentliches haben (aktive Anzeige) bzw. nur gezielt per ID abrufbar. Test ergänzen.

#### F2 – hoch – `service_role` hat keine Tabellenrechte, Server-Pfade funktionieren nicht
Wegen `auto_expose_new_tables = false` bekommt keine Rolle automatisch Rechte, und die Migrationen vergeben an `service_role` nur `EXECUTE`/`USAGE`. `service_role` hat auf allen 17 Objekten in `public` nur `REFERENCES, TRIGGER, TRUNCATE`. Edge Functions und serverseitiger Web-Code mit service_role-Key (Freigabe-Jobs, Suchaufträge M8, Lösch-/Retention-Jobs M9, „setzt nur der Server“ in SPEC 3.4) scheitern mit 42501. `private.is_server()` und `is_server_caller()` nennen `service_role`, der Pfad ist aber nicht erreichbar. Die pgTAP-Tests simulieren „Server“ nur als `postgres` und finden das deshalb nicht.
Reproduktion: `curl -s -X PATCH "http://127.0.0.1:54321/rest/v1/listings?id=eq.<id>" -H "apikey: <service_role>" -H "Authorization: Bearer <service_role>" -H "Content-Type: application/json" -d '{"status":"active"}'` → 403 `42501`, Hint „GRANT SELECT, UPDATE ON public.listings TO service_role“. SQL-Gegenprobe: `select table_name, string_agg(privilege_type, ',') from information_schema.role_table_grants where grantee = 'service_role' and table_schema = 'public' group by 1;`
Erwartet: bewusste Grants für `service_role` je Tabelle (oder eine ADR, dass Server-Logik nur über `security definer`-Funktionen läuft). Dazu ein pgTAP-Test mit `set local role service_role`.

#### F3 – mittel – `listing_photos.storage_path` ist nicht an Besitzer und Anzeige gebunden
Der Check prüft nur das Muster `uuid/uuid/datei`. Die Policy prüft nur, dass die Zeile zur eigenen Anzeige gehört. B kann deshalb in seiner Anzeige einen Pfad aus dem Ordner von A eintragen. Folgen: (1) Weil `storage_path` unique ist, kann A sein eigenes Foto danach nicht mehr eintragen (Blockade, 23505). (2) Sobald die Anzeige von A aktiv ist, zeigt die Anzeige von B das Foto von A (Inhalte kapern). Ein Lesezugriff auf Entwürfe entsteht nicht, weil die Storage-Policy nach der Anzeige im Pfad entscheidet.
Reproduktion (als B, Bearer = Token B):
1. `POST /rest/v1/listings` → eigener Entwurf `<draftB>`.
2. `POST /rest/v1/listing_photos {"listing_id":"<draftB>","storage_path":"<A-id>/<draftA>/2.jpg","sort_order":0}` → 201.
3. Als A: `POST /rest/v1/listing_photos {"listing_id":"<draftA>","storage_path":"<A-id>/<draftA>/2.jpg","sort_order":1}` → 409 `23505`.
Erwartet: Check bzw. Policy verlangt `storage_path` = `owner_id || '/' || listing_id || '/…'`. Test ergänzen.

#### F4 – niedrig – Abweichungen von SPEC 3.1/3.4 nicht in SPEC, ADR oder CHANGELOG dokumentiert
Die folgenden Abweichungen sind fachlich vertretbar, stehen aber höchstens als Kommentar in der Migration:
- `saved_searches.notify_email`, `reports.handled_at`
- Meldende lesen eigene Meldungen (SPEC 3.4: „Read nur Admin“)
- zusätzliche Statusübergänge (`rejected→draft`, `rejected→pending_review`, `expired→pending_review`, Admin `pending_review→draft`)
- `listing_species` ohne `id`
- Enum `verification_request_status`
- `regions` mit `unique (code)`; Slug eindeutig je (`country`, `level`) statt „je Land“ wie in ADR 007
Reproduktion: SPEC 3.1/3.4 mit den Migrationen `20261029100500`, `…100700`, `…100400`, `…100200` vergleichen.
Erwartet: SPEC v0.4 oder ein CHANGELOG-Abschnitt „Abweichungen“.

#### F5 – niedrig – ADR 009 passt nicht zur Umsetzung
- Der Helfer heißt `supabase/tests/_helpers.psql` (per `\ir` eingebunden), nicht `00000_helpers.sql`.
- Die versprochene Prüfmatrix (anon, A, B, Admin aal1/aal2 × SELECT/INSERT/UPDATE/DELETE je Tabelle) ist nicht vollständig. Beispiele: `devices` ohne UPDATE/DELETE durch B und ohne anon, `service_role` nirgends (F2).
- Die „Allowlist“ gesperrter Tabellen im Meta-Test gibt es nicht. Das ist derzeit unnötig, weil jede Tabelle eine Policy hat.
Reproduktion: ADR 009 mit `supabase/tests/` vergleichen.

#### F6 – niedrig – Nutzer sehen die `user_id` des prüfenden Admins
`reports.handled_by` (über `reports_select_own`) und `verifications.reviewed_by` sind für den Meldenden bzw. Antragsteller lesbar. Admins lassen sich so über Fälle hinweg wiedererkennen und über `public_profiles` mit einem Namen verbinden.
Reproduktion: als A eine Meldung anlegen, Admin (aal2) setzt `status=handled`, dann als A `GET /rest/v1/reports?select=handled_by` → Admin-UUID.
Erwartet: Spalte für Nutzer ausblenden (View oder Spaltenrechte) oder in ADR 005/008 bewusst entscheiden.

### Nicht prüfbar in M1

- CI auf GitHub (`supabase.yml`): kein Remote. Lokal wurden dieselben Schritte nachvollzogen. Offen ist, ob `gen types --local` ohne den ausgeschlossenen `postgres-meta`-Dienst in CI läuft.
- Echte 2FA (TOTP): lokal abgeschaltet, `aal2` nur mit signiertem Test-Token geprüft (M4)
- Realtime-RLS für Chat: keine Publication in M1 (M7)
- Cloud-Konfiguration (Hook, `auto_expose_new_tables`, Buckets): kein Cloud-Projekt (M2)
- iOS, Gleichstand der Filter Web/iOS, E2E-Kernflows, Lokalisierung der UI: noch keine Funktionen

### Vorgeschlagene Tests (nicht angelegt)

- pgTAP: `set local role service_role` → SELECT/UPDATE auf `listings`, `verifications`, `profiles` (F2); `public_profiles` zeigt keinen E-Mail-Lokalteil (F1); `listing_photos.storage_path` mit fremdem Präfix wird abgelehnt (F3); Spaltensichtbarkeit `handled_by`/`reviewed_by` (F6).
- API-Tests ab M2 (ADR 009): die oben genannten Storage-Prüfungen (Signed URL, `list`, `copy`/`move`, Upsert, Pfadtricks) und PostgREST-Prüfungen (`Accept-Profile: private`, Embeddings, `count=exact`) automatisieren.

### Empfehlung

M1 **abnehmen: ja, mit Auflagen.** Alle drei Teile des Akzeptanzkriteriums sind erfüllt und unabhängig über die echten APIs bestätigt. DoD, Lint, Typecheck, Build, Tests und `db lint` sind grün. Es gibt keinen blockierenden Fehler. Auflagen:
- F1 vor M2 beheben, weil dort die Registrierung live geht.
- F2 vor M4 beheben, spätestens bevor die erste Edge Function bzw. der erste service_role-Code entsteht.
- F3 vor M3 (Foto-Upload) beheben.
- F4 bis F6 bei Gelegenheit erledigen.

### Nachtrag 2026-10-29: Stand der Behebung (QA und Architekt-Review M1)

| Fund | Status | Commit |
|------|--------|--------|
| QA F1: Fallback-Name aus E-Mail, alle Konten auflistbar | behoben: „Nutzer“, öffentlich nur Anbieter und Chatpartner | 04e16d5 |
| QA F2: `service_role` ohne Tabellenrechte | behoben: CRUD für `service_role`, kein TRUNCATE für API-Rollen, Test im echten `service_role`-Kontext | fd363d6 |
| QA F3: `storage_path` nicht gebunden | behoben: Pfad an Besitzer und Anzeige gebunden, Upload nur für registrierte Fotos | c49d8a6 |
| QA F4: Abweichungen von SPEC 3.1/3.4 | dokumentiert in SPEC v0.3 | (dieser Commit) |
| QA F5: ADR 009 | korrigiert | (dieser Commit) |
| QA F6: Admin-IDs sichtbar | behoben: Spalten-GRANT | da9422e |
| Architekt 1: GraphQL-Orakel | behoben: vorsorglich, lokal war pg_graphql inaktiv | 7237b9a |
| Architekt 4: Gerätetoken | behoben: RPC `register_device` | 9fac05f |
| Architekt 6/7: Badge, Fallback-Name | behoben | 04e16d5 |
| Architekt 8: Beweise löschbar | behoben: Chats bleiben, kein Löschen durch gesperrte Nutzer, Admin nur per `removed` | da9422e |
| Architekt 9: Performance | teilweise: Storage über indizierten Pfad; `is_active_user` je Zeile bleibt, vor M5 messen | c49d8a6 |
| Architekt 10: Herausmitteln über mehrere Anzeigen | offen bis M3 (ADR 006) | – |
| Architekt 11–13 | behoben: Children-Guard prüft zuerst, Vier-Augen-Prinzip, Grund unveränderlich, Server-Erkennung über die Rolle | c49d8a6, da9422e |
| Architekt 14: Cloud-Konfiguration | Checkliste in ADR 005 für M2 | (dieser Commit) |

Zusätzlich gefunden: anon/authenticated hatten TRUNCATE auf allen Tabellen. Über PostgREST war das nicht erreichbar, die Rechte sind trotzdem entzogen (fd363d6).

## M2 – 2026-10-29

Geprüfter Stand: `25bb981` (main, Arbeitsbaum sauber). M2-Commits `068dc36..25bb981`. Danach kamen nur QA-Commits mit Tests dazu (`3e4bb60`, `b462fb0`), kein Feature-Code.
Umgebung: macOS, Node 24.22.1, Supabase CLI 2.122.0 lokal (nach `supabase stop && supabase start`), Mailpit, Playwright Chromium, Prod-Build per `next start -p 3456` für Header- und Cookie-Prüfungen.
Vorgehen:
- die Prüfbefehle aus dem CHANGELOG
- unabhängige Proben gegen Auth, PostgREST und Storage mit Skripten im Scratchpad
- zwei temporäre Playwright-Abläufe (Re-Consent, Sperre der Link-Bestätigung), danach gelöscht
- neue automatisierte API-Tests (Auflage M1, siehe unten)

### Ergebnis je Akzeptanzkriterium

„Registrieren, ausloggen, wieder einloggen; Profil bearbeiten; geschützte Seiten leiten auf Login um“ (SPEC 6 M2) sowie die Umfangspunkte AGB-Zustimmung und Session-Handling.

| # | Kriterium | Ergebnis | Nachweis |
|---|-----------|----------|----------|
| a | Registrieren (per Link und per Code) | **erfüllt** | E2E `auth.spec.ts` Test 1 (Link, Vorlage `confirmation`) und Test 2 (Code). Nachvollzogen: Ein GET auf den Link verbraucht das Token nicht (E2E `request.get` → 200, danach klappt der Button). Neue Nutzer landen ohne Zustimmung in `/welcome`. |
| b | Ausloggen | **erfüllt** | E2E: Nach „Abmelden“ zeigt `/de` „Anmelden“, `/de/account/profile` → Login. API: Nach `signOut` ist das Refresh-Token ungültig (400). Das Access-Token gilt bis zum Ablauf weiter (ADR 010, bewusst; `integration/auth.test.ts`). Proxy: Bei widerrufener, abgelaufener Session kommt 307 auf den Login, und das Cookie wird gelöscht. |
| c | Wieder einloggen (per Code und per Link) | **erfüllt** | E2E Test 1 (Code, Bestandsnutzer bekommt die Vorlage `magic_link`, falscher Code zeigt Fehler) und Test 2 (Link mit Rücksprung `/de/account/profile`). |
| d | Profil bearbeiten | **erfüllt** | E2E: gewerblich ohne Firmenname → Fehler, mit Firmenname und Land AT → gespeichert. Vitest `validation/profile.test.ts`, pgTAP `02_profiles`. Einschränkung für gesperrte Konten: F4. |
| e | Geschützte Seiten leiten auf Login um | **erfüllt** | curl gegen den Prod-Build: `/de/account` ohne Cookie → 307 `/de/login?next=%2Fde%2Faccount`. `/account` → `/de/account` → Login. Die Rücksprünge sind geprüft (E2E Test 5, Vitest, 22 eigene Zusatzfälle wie `%2e%2e`, `..%2f`, `//`, `\t`, `@host`, Unicode, doppelt kodiert, fremde Origin in `redirect_to`, doppeltes `next`): Alle landen sicher auf `/de/account` oder dem erlaubten Pfad. |
| f | AGB-Zustimmung je Version | **erfüllt** | pgTAP `10_legal` (21 Tests), API-Tests (veraltete Version 22023, idempotent, nur über RPC). UI unabhängig per temporärem Playwright-Ablauf geprüft: Nach einer neuen Version `terms` führt `/de/account/profile` auf `/de/welcome?next=%2Fde%2Faccount%2Fprofile`. Ändert sich die Version, während das Formular offen ist, erscheint der Hinweis „Die Rechtstexte wurden gerade aktualisiert“, und das zweite Absenden speichert die neue Version. Nachweise danach: `terms:2026-10-draft, privacy:2026-10-draft, terms:2027-02`. Nicht als E2E im Repo, siehe Vorschläge. |
| g | Session-Handling mit `@supabase/ssr` | **erfüllt** | Siehe Sicherheitsprüfung „Session“. |
| h | Sign in with Apple | **nicht prüfbar** | Eingebaut, aber ausgeschaltet (`NEXT_PUBLIC_AUTH_APPLE_ENABLED`, SPEC 7.1). Die Routen `/auth/apple` und `/auth/callback` liefern dann 404 (Code-Review). |

Die Akzeptanzkriterien selbst sind erfüllt. Die Zusage „passwortlos“ (SPEC 4.4 v0.4, ADR 010) hält aber nicht: Über die Auth-API lassen sich Passwörter setzen und registrieren, mit Folge Kontoübernahme (F1).

### Definition of Done (CLAUDE.md)

| Punkt | Ergebnis |
|-------|----------|
| Build ohne Warnungen, Lint und Typecheck grün | erfüllt: `npm run lint`, `npm run typecheck` und `npm run build` grün, ohne Warnungen |
| Tests grün | erfüllt, Reihenfolge beachten (F6): `supabase db reset && supabase test db` 11 Dateien, 230 Tests PASS; `npm test` 6 Dateien, 65 Tests; `npm run test:e2e` 5/5; neu `npm run test:integration` 3 Dateien, 38 Tests |
| `supabase db lint -s public,private --level warning` | erfüllt: „No schema errors found“ |
| Texte in 4 Sprachen | erfüllt: 84 Schlüssel je Sprache, keiner fehlt oder ist leer, keine unübersetzten Kopien aus en. Die Mailvorlagen `confirmation` und `magic_link` sind 4-sprachig (Betreff in einer Zeile mit allen 4 Sprachen). cs/pl sind ungeprüft (Glossar). |
| Glossar abgestimmt | erfüllt für M2: Alle 10 Begriffe aus „Konto und Anmeldung“ stehen wörtlich in den Messages der jeweiligen Sprache. M0 F4 (Muttersprachler für cs/pl) bleibt offen. |
| Lücken Web/iOS vermerkt | erfüllt: CHANGELOG „iOS (I1)“: Code-Login, `accept_legal(…, 'ios')`, Onboarding |
| RLS für neue Tabellen getestet | erfüllt: `legal_acceptances` mit 2 SELECT-Policies, ohne Schreibrechte für API-Rollen. `00_meta` und `10_legal` (anon, A, B, Admin aal1/aal2, gesperrt), dazu API-Tests (direktes INSERT/PATCH/DELETE → 403, fremde Nachweise unsichtbar, `count=exact` 0) |
| CHANGELOG mit Testanleitung | erfüllt, nachvollzogen. Fehlt: Hinweis, dass `supabase test db` nach E2E-Läufen ohne `db reset` rot wird (F6) |
| Secrets | erfüllt: Kein service_role-, secret- oder JWT-Secret-Wert in `.next/static` (Suche nach den echten lokalen Werten). Nur der publishable Key ist enthalten, wie vorgesehen. Treffer für `sb_secret_` sind nur der Text der Env-Validierung. `web/.env.local` ist unverändert. |

### Sicherheitsprüfung

| Thema | Ergebnis | Nachweis |
|-------|----------|----------|
| Open Redirect (`next`, `redirect_to`) | in Ordnung | `safeNextPath` gibt nur `url.pathname` nach Allowlist zurück. `nextFromRedirectTo` prüft die Origin. 22 Zusatzfälle (siehe e), Vitest, E2E Test 5. Login, Welcome, Confirm, Callback, Apple und Proxy nutzen alle die Prüfung. |
| Account-Enumeration | **UI in Ordnung, API nicht** | Das Formular antwortet für alle Fehler außer Netzwerkfehlern gleich. Über die Auth-API verrät `create_user:false` die Existenz eines Kontos (F2). |
| Mail-Scanner-Schutz | in Ordnung | GET zeigt nur den Button, erst die Server Action (POST, Origin-Prüfung durch Next) ruft `verifyOtp` auf. Die Seite hat `noindex, nofollow` und `Referrer-Policy: no-referrer` und lädt keine fremden Skripte. |
| HTML-Injektion in Mails über `redirect_to` | in Ordnung | `redirect_to` mit `"><h1>…<a href=…>` (Muster `**` der Allowlist) wird in der Mail URL-kodiert ausgegeben, das Template escapt. |
| Session-Refresh im Proxy | in Ordnung | Prod-Build: Mit abgelaufenem `expires_at` erneuert der Proxy die Session. `Set-Cookie: sb-127-auth-token` steht auch auf dem 307 von `/account` → `/de/account`, dazu `Cache-Control: private, no-store`. Bei widerrufenem Refresh-Token: 307 auf den Login, Cookie gelöscht. Cookies `SameSite=lax`, nicht `HttpOnly` (ADR 010, bewusst). |
| Cache-Control | in Ordnung | Alle Seiten antworten mit `private, no-cache, no-store`, auch `/de` anonym (Hinweis H1). Persönliche Inhalte werden nicht geteilt gecacht. |
| CSP und Header | in Ordnung, wie ADR 010 | `default-src 'self'; script-src 'self' 'unsafe-inline'` (Prod ohne `unsafe-eval`), `connect-src` nur Supabase, `frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`. Dazu HSTS, `X-Frame-Options: DENY`, Permissions-Policy. E2E prüft, dass keine CSP-Verstöße auftreten. |
| `legal_acceptances` RLS und RPCs | in Ordnung | Nur über `accept_legal` schreibbar, Versionen prüft der Server. anon: `legal_status`/`accept_legal` → 401. `private.setting_text` und `has_accepted_current_legal` sind über die API nicht erreichbar (406/404). |
| Gesperrte Konten | DB in Ordnung, UI unklar | `accept_legal` → 42501. Neue Anzeigen → 42501. Anzeigen und `public_profiles` verschwinden öffentlich (API-Test). Login und Profiländerung sind weiter möglich, die Meldung ist irreführend (F4). |
| Rechteausweitung | in Ordnung | `updateUser({ data: { app_role: 'admin', role: 'service_role' } })` ändert nach dem Refresh weder `role` noch `app_role`. Gefälschte Tokens (`alg: none`, falsches HS256-Secret, getauschtes `sub`, `role: service_role` mit alter Signatur) → 401 bei PostgREST, abgelehnt bei Storage. Die Admin-API mit Nutzer-Token → 403. |
| Passwörter | **Lücke** | F1 |

### Auflage aus M1: API-Tests gegen die lokale Supabase

Angelegt in `web/integration/`, Aufruf mit `npm run test:integration` (eigene Config `vitest.integration.config.mts`, `npm test` schließt `integration/**` aus). Keine neue Abhängigkeit: Es reichen `@supabase/supabase-js`, Vitest und `node:http` (für rohe Pfade ohne URL-Normalisierung).
- **Schlüssel:** zur Laufzeit aus `supabase status -o env`, nur für Hosts `127.0.0.1`/`localhost`, nie im Repo. Der service_role-Key dient nur dem Aufbau und Abbau.
- **Verhalten ohne Supabase:** Ist sie nicht erreichbar, werden alle Tests übersprungen (Exit 0). Mit `CI=true` oder `INTEGRATION_REQUIRED=1` bricht der Lauf ab (geprüft).
- **Aufbau:** Das globale Setup legt drei Nutzer an:
  - A mit Entwurf, Foto, Jagdschein, Verifizierungsantrag und AGB-Zustimmung
  - B mit freigegebener Anzeige und Foto, A schreibt B an
  - C unbeteiligt

  Danach wird alles gelöscht (Dateien, Konten, Audit-Einträge). Nach `db reset` → `test:integration` → `test db` ist pgTAP grün. Dreimal hintereinander stabil (ca. 2,5 s).
- **Positivkontrollen:** Jede Ablehnung hat eine Gegenprobe (Besitzer bzw. Teilnehmer dürfen es), damit kein Test grundlos grün ist.

| Datei | Tests | Inhalt |
|-------|-------|--------|
| `storage.test.ts` | 14 | Jagdschein: Signed URL einzeln und mehrfach (C, anon), `download`, `info`, `exists`, `object/public`, `object/authenticated`, `list` (Ordner, Wurzel, Suche), Upsert, `update`, `remove`, `copy`, `move`, `copy` in einen anderen Bucket. Der Besitzer überschreibt nicht. Pfadtricks beim Upload und beim Signieren (`..`, `%2e%2e`, `..%2F`, `%2F` im Ganzen, `./`, Backslash, UUID in Großbuchstaben). Fotos: freigegeben signierbar, Entwurf nicht. Fremde Fotos kopieren, verschieben, überschreiben oder löschen geht nicht. Upload nur für registrierte Fotos, HTML wird abgelehnt. Buckets anlegen, öffentlich schalten, leeren oder löschen geht nicht. |
| `postgrest.test.ts` | 14 | `Accept-Profile`/`Content-Profile` für `private`, `auth`, `storage`, `extensions` → 406 PGRST106 (mit Token und anon). Interne RPCs → 404. OpenAPI ohne private Objekte. Embeddings: `listings→conversations→messages`, `conversations→messages`, `regions→listings`, `listings→listing_photos`, `listings→profiles`, Volltext. `public_profiles` (Anbieter, Chatpartner, nur öffentliche Spalten). Verifizierungen und Nachweise. `count=exact` für 9 Pfade inklusive `!inner`-Filter. anon zählt keine geschützten Tabellen (401). Schreibversuche. |
| `auth.test.ts` | 10 | anon und Nutzer an der Admin-API, gefälschte Tokens, `user_metadata`, Logout und Refresh, gesperrte Konten, `accept_legal`. Dazu **3 Tests für offene Lücken (F1, F2):** Sie prüfen das heutige Fehlverhalten genau und werden rot, sobald die Lücke behoben ist. Dann sind sie auf das Soll umzustellen. |

Ergebnis: Storage und PostgREST zeigen **keine neuen Lücken**. Die Auth-Tests haben F1 und F2 gefunden.

**Vorschlag CI** (nicht umgesetzt, Workflow-Änderung ist Sache der Entwicklung): Im Job `e2e` von `.github/workflows/web.yml` läuft Supabase mit Auth und Storage schon. Nach dem Schritt „Öffentlichen lokalen Key übernehmen“ ergänzen:
```yaml
      - run: npm ci
      - run: npm run test:integration   # CI=true: Abbruch, falls Supabase fehlt
```
Ein Lauf kostet etwa 3 s. Weil `web.yml` keinen `paths`-Filter hat, prüft das auch jede Migration. Den Abschnitt „Alternativen“ in ADR 009 („folgen ab M2“) auf „umgesetzt in `web/integration/`“ ändern.

### Gefundene Fehler

#### F1 – hoch – Passwort-Anmeldung ist trotz „passwortlos“ aktiv: Kontoübernahme vor der Registrierung und dauerhafter Zugang nach Session-Diebstahl
ADR 010 (Zeile 14) sagt „Keine Passwörter: kein Reset-Ablauf, kein Leak-Risiko“. Supabase Auth nimmt aber weiter Passwörter an (`supabase/config.toml:229-238`: `[auth.email] enable_signup = true`, `secure_password_change = false`; einen Schalter nur für Passwörter gibt es nicht).
1. **Kontoübernahme vor der Registrierung:** Ein Angreifer registriert die Adresse des Opfers per `POST /auth/v1/signup` mit eigenem Passwort. Ohne Bestätigung kann er sich nicht anmelden. Meldet sich das Opfer später ganz normal in der Web-App an, bekommt es die Vorlage „Willkommen bei Revier“. Mit Code oder Link bestätigt es damit die Adresse des Kontos, dessen Passwort der Angreifer kennt. Danach meldet sich der Angreifer per Passwort im Konto des Opfers an und sieht später Chats, Verifizierung und Anzeigen.
2. **Dauerhafter Zugang:** Wer ein Access-Token erbeutet, setzt per `updateUser({ password })` ein Passwort, ohne erneute Anmeldung. Das Passwort überdauert einen globalen Logout. Die Cookies sind bewusst nicht `HttpOnly` und `script-src` erlaubt `unsafe-inline` (ADR 010). Ein XSS macht so aus einem Token-Diebstahl von höchstens 1 h einen dauerhaften Zugang.

Reproduktion (lokal, `<pub>` = publishable Key):
1. `curl -s -X POST http://127.0.0.1:54321/auth/v1/signup -H "apikey: <pub>" -H "Content-Type: application/json" -d '{"email":"opfer@test.local","password":"Angreifer-Passwort-1"}'` → 200
2. Als Opfer in der Web-App unter `/de/login` dieselbe Adresse eingeben und den Code aus Mailpit eingeben → angemeldet, Onboarding
3. `curl -s -X POST "http://127.0.0.1:54321/auth/v1/token?grant_type=password" -H "apikey: <pub>" -H "Content-Type: application/json" -d '{"email":"opfer@test.local","password":"Angreifer-Passwort-1"}'` → 200, `user.id` ist das Konto des Opfers

Automatisiert: `web/integration/auth.test.ts:160` (Passwort setzen und nach globalem Logout anmelden) und `:171` (Kontoübernahme).
Erwartet: Kein Passwort lässt sich setzen oder zur Anmeldung nutzen. Vorschläge für den Architekten:
- (a) Trigger `before insert or update of encrypted_password on auth.users`, der das Passwort leert bzw. ablehnt (Verhalten von GoTrue bei leerem Hash testen)
- oder (b) Auth-Hook „Password Verification Attempt“, der immer ablehnt (Verfügbarkeit im Cloud-Tarif prüfen)
- `secure_password_change = true` allein reicht nicht (nur Reauth nach 24 h)
- Danach ADR 010 korrigieren und die beiden Tests auf das Soll umstellen.

Spätestens vor der Cloud-/Staging-Anbindung beheben.

#### F2 – mittel – Konten lassen sich über die Auth-API aufzählen
Die UI antwortet immer gleich, wie ADR 010 (Zeile 11) zusagt. Die API, die jeder mit dem öffentlichen Key aufrufen kann, unterscheidet aber: `POST /auth/v1/otp` mit `create_user:false` liefert für bestehende Konten `200 {}`, für unbekannte `422 otp_disabled` („Signups not allowed for otp“). Es sendet keine Mail. Gebremst wird das nur durch `sign_in_sign_ups = 30` je 5 min und IP. Ein schwächeres Orakel ist `429` bei einer zweiten Anfrage innerhalb von `max_frequency`. Die Zusage „damit niemand Konten erraten kann“ gilt also nur für die Oberfläche. Für eine Jagdplattform heißt das: Ein Dritter kann prüfen, ob eine Person dort ein Konto hat.
Verwandt: Der 6-stellige Code ist 10 min gültig, und `token_verifications = 30` gilt je IP. Gegen verteiltes Raten hilft nur die geplante Captcha.
Reproduktion:
1. `curl -s -X POST http://127.0.0.1:54321/auth/v1/otp -H "apikey: <pub>" -H "Content-Type: application/json" -d '{"email":"<bestehend>","create_user":false}'` → 200
2. dasselbe mit einer unbekannten Adresse → 422 `otp_disabled`

Automatisiert: `web/integration/auth.test.ts:191`.
Erwartet: Das Verhalten liegt in Supabase Auth und ist mit Bordmitteln kaum zu beheben. Vorschlag:
- ADR 010 korrigieren und das Restrisiko annehmen bzw. bewerten (SPEC 8, Datenschutz)
- die Captcha (Turnstile/hCaptcha) wie geplant vor dem Go-live, sie greift auch für `/otp`
- die Cloud-Rate-Limits für `sign_in_sign_ups` und `token_verifications` bewusst setzen

#### F3 – mittel – Kein Impressum, Datenschutz und Nutzungsbedingungen von keiner Seite verlinkt
CLAUDE.md (Web-Datenschutz) verlangt: „Impressum und Datenschutz sind von jeder Seite erreichbar.“
- Das Layout (`web/app/[locale]/layout.tsx:36-41`) hat nur einen Header mit Sprachumschalter und Anmeldung, keinen Footer.
- `/de/privacy` und `/de/terms` gibt es seit M2, sie sind aber nur aus dem Onboarding verlinkt. Eine Impressumsseite gibt es nicht.
- Die Login-Seite erhebt die E-Mail-Adresse ohne Link zur Datenschutzerklärung (`web/components/auth/LoginForm.tsx:99`, nur „Neue Konten stimmen … zu“). Art. 13 DSGVO verlangt die Information beim Erheben.

SPEC M9 nennt „Rechtstext-Platzhalter“. Die Regel in CLAUDE.md gilt aber ohne Schritt-Bezug, und mit M2 werden erstmals personenbezogene Daten erhoben.
Reproduktion: `curl -s http://localhost:3456/de | grep -cE 'href="/de/(privacy|terms|imprint|impressum)'` → 0; ebenso für `/de/login`.
Erwartet: ein Footer im Layout mit Impressum (Platzhalterseite, `noindex`), Datenschutz und Nutzungsbedingungen, in 4 Sprachen. Auf der Login-Seite ein Link zur Datenschutzerklärung. Platzhalter bleiben als solche gekennzeichnet.

#### F4 – niedrig – Gesperrte Konten: irreführende Meldung, Profil bleibt änderbar
Ein gesperrtes Konto (`is_blocked = true`) kann sich anmelden. Ohne Zustimmung landet es in `/welcome`:
- `updateOwnProfile` gelingt, denn `profiles_update_own` prüft nur `deleted_at` (`supabase/migrations/20261029100100_profiles.sql:34`).
- `accept_legal` scheitert mit 42501.
- `acceptLegal` macht daraus „failed“ (`web/lib/services/legal.ts:24`), und die Seite zeigt „Speichern fehlgeschlagen. Bitte versuche es noch einmal.“ Das Profil wurde aber gespeichert, und Wiederholen hilft nie.

Gesperrte Konten mit Zustimmung können ihr Profil (Anzeigename, Firmenname) weiter ändern. Öffentlich ist das nicht sichtbar (`public_profiles` blendet Gesperrte aus), für die Moderation ist es aber unerwartet.
Reproduktion:
1. Konto anlegen, als `postgres` `update profiles set is_blocked = true where user_id = …`
2. anmelden, `/de/welcome` ausfüllen, absenden → „Speichern fehlgeschlagen…“, `display_name` ist trotzdem geändert. API-Gegenprobe: `PATCH /rest/v1/profiles?user_id=eq.<id>` mit Token des Gesperrten → 200, Zeile geändert.

Erwartet: eine verständliche Meldung „Konto gesperrt“ (lokalisiert, CLAUDE.md: Fehler verständlich anzeigen). Profiländerungen gesperrter Konten bewusst entscheiden (Policy um `not is_blocked` ergänzen oder in ADR festhalten). Passt zu M4 (Sperren).

#### F5 – niedrig – Link-Bestätigung läuft über den Web-Server und teilt sich dessen IP-Limit (Risiko, lokal nicht reproduziert)
`confirmSignIn` ruft `verifyOtp({ token_hash })` serverseitig auf (`web/app/[locale]/auth/actions.ts:18`, `web/lib/services/auth.ts:68`). Supabase sieht dann die IP des Web-Servers. Das ist dasselbe Argument, mit dem ADR 010 das Anfordern und Prüfen des Codes in den Browser verlegt. `token_verifications` (30 je 5 min und IP) würde in der Cloud für alle Link-Anmeldungen gemeinsam gelten. Ein Angreifer könnte die Link-Anmeldung aller sperren, indem er die öffentliche Bestätigungsseite mit erfundenen `token_hash` absendet. Der Code-Weg bliebe als Ausweg.
Lokal nicht reproduzierbar: 31 Fehlversuche über die Bestätigungsseite, danach klappte ein gültiger Link in einem zweiten Browser. Die lokale Instanz setzt das Limit für `/verify` offenbar nicht so durch.
Erwartet: in Staging bzw. Cloud prüfen. Alternative: Nach dem Klick (Mail-Scanner-Schutz bleibt) `verifyOtp({ token_hash })` im Browser-Client aufrufen, wie beim Code, und danach weiterleiten.

#### F6 – niedrig – pgTAP-Tests zählen global und werden nach E2E-Läufen ohne `db reset` rot
`02_profiles` Test 17 („Admin mit 2FA liest alle Profile“, have 19, want 4), `10_legal` Test 18 („have 20, want 2“) und `07_trust_audit` Tests 27/41 zählen Zeilen der ganzen Tabelle. Die E2E-Tests legen Konten an und räumen nicht auf. Nach `npm run test:e2e` schlägt `supabase test db` deshalb ohne vorheriges `db reset` fehl. Die CI ist nicht betroffen, weil `supabase.yml` vorher zurücksetzt. Die neuen API-Tests räumen vollständig auf (geprüft).
Reproduktion: `supabase db reset && (cd web && npm run test:e2e) && supabase test db` → `Result: FAIL`.
Erwartet: In pgTAP nur die Zeilen der eigenen Testnutzer zählen (`where user_id in (…)`), oder im CHANGELOG festhalten, dass vor `test db` immer `db reset` nötig ist.

### Hinweise (keine Fehler)

- **H1 Caching für M5:** Durch `AuthNav` im Layout rendert jede Seite dynamisch. Auch `/de` anonym antwortet mit `Cache-Control: private, no-cache, no-store`, in M0 war das noch `s-maxage`. Für die SEO-Seiten in M5 (CDN, Core Web Vitals) sollte der Anmeldestatus clientseitig oder hinter einer Grenze kommen, die die öffentliche Seite cachebar lässt.
- **H2:** Geschützte Seiten mit Session, aber ohne Zustimmung, antworten mit HTTP 200 und leiten erst im Stream auf `/welcome` weiter (`requireOnboardedUser` hinter Suspense). Die statische Hülle enthält keine Nutzerdaten (geprüft: keine E-Mail im HTML).
- **H3 UGC-Pflicht:** „Account löschen“ fehlt im Web bis M9 (CHANGELOG vermerkt). Seit M2 können Konten angelegt werden. Vor M9 darf es keinen öffentlichen Start und kein Staging mit echten Nutzern geben.
- **H4:** `accept_legal` übernimmt `p_source` vom Client (Web-Nutzer können `ios` senden). Das ist nur eine Information und unkritisch, sollte aber nicht als Nachweis der Plattform gelten.
- **H5:** Bei `/welcome?next=…` ohne Session geht `next` verloren, der Login führt dann auf `/welcome` und danach auf `/account`. Kosmetisch.

### Nicht prüfbar in M2

- Sign in with Apple (kein Apple-Developer-Account, SPEC 7.1)
- Cloud-Konfiguration (Signing Keys, Redirect-URLs, Vorlagen, SMTP, Rate-Limits): kein Cloud-Projekt (ADR 002). F5 ist dort zu prüfen.
- CI auf GitHub (`e2e`-Job): kein Remote. Lokal liefen dieselben Schritte gegen den Dev-Server, gegen den Prod-Build nur die Header- und Cookie-Proben.
- iOS (I1), Gleichstand Web/iOS: noch nicht gebaut
- Darstellung bei 360 px, Screenreader und Tastaturbedienung: nicht systematisch geprüft. Im Code haben Labels, `role="alert"`/`role="status"` und `aria-describedby` am Häkchen gepasst.
- Offline-Verhalten: Der Netzwerkfehler beim Code-Anfordern bzw. -Prüfen ist übersetzt (`networkError`), wurde aber nicht im Browser offline geprüft.

### Vorgeschlagene Tests (nicht angelegt)

- Playwright: Re-Consent bei neuer AGB-Version (wie oben manuell; braucht einen Weg, die Version in `private.app_settings` zu ändern, z. B. per `psql` im CI-Job). Gesperrtes Konto zeigt einen Sperrhinweis (nach F4). Footer-Links von jeder Seite (nach F3). Login-Formular mit `context.setOffline(true)` → Netzwerkhinweis.
- pgTAP: Zählungen auf Testnutzer einschränken (F6). Nach dem Fix von F1 ein Test, dass `auth.users.encrypted_password` leer bleibt.

### Empfehlung

M2 **abnehmen: ja, mit Auflagen.** Alle Akzeptanzkriterien sind erfüllt und unabhängig nachvollzogen. Die DoD ist erfüllt, Lint, Typecheck, Build, pgTAP, Vitest und Playwright sind grün. Die Auflage aus M1 (API-Tests) ist mit 38 automatisierten Tests erledigt.
Auflagen:
- **F1 (hoch)** vor jeder Cloud-/Staging-Anbindung und vor M3 beheben, inklusive Korrektur von ADR 010.
- **F2** im ADR als Restrisiko bewerten, die Captcha bleibt harter Punkt vor dem Go-live.
- **F3** vor dem ersten öffentlichen Staging.
- F4 mit M4, F5 bei der Cloud-Anbindung prüfen, F6 bei Gelegenheit.
- Die API-Tests in den CI-Job `e2e` aufnehmen.

### Nachtrag 2026-10-29: Stand der Behebung (QA und Architekt-Review M2)

| Fund | Status | Commit |
|------|--------|--------|
| QA F1: Passwort-Anmeldung aktiv | behoben: Trigger `discard_password` leert jeden Hash. Ablehnen ging nicht, weil Auth auch bei OTP intern ein Zufallspasswort setzt. Tests auf Soll umgestellt, pgTAP `11_no_passwords` | 439f336 |
| QA F2: Aufzählung über die Auth-API | als Restrisiko bis zur Captcha in ADR 010 dokumentiert; Test hält das Verhalten fest | (dieser Commit) |
| QA F3: Impressum, Footer | behoben: Footer auf jeder Seite inklusive 404, Impressum-Platzhalter, Datenschutz-Hinweis beim Login, E2E | e4dfccc |
| QA F4: Gesperrte Konten | behoben: Profiländerung per RLS gesperrt, Hinweis statt Formular | 1af7a43 |
| QA F5: Link-Bestätigung und IP-Limit | offen, in Staging prüfen | – |
| QA F6: pgTAP nach E2E | behoben: Zählungen gegen die Gesamtzahl; API-Tests in der CI | 70340de |
| Architekt 1: Mailvorlagen | behoben: feste Sprache je Zweig, Mailpit-Test | 5143269 |
| Architekt 2: Prüfung je Seite | behoben: Vitest `guards.test.ts`, ADR 010 | 9ac5a97 |
| Architekt 3: Cookie-Rotation | behoben: E2E mit abgelaufenem Token | b7ec086 |
| Architekt 4: Cookie-Begründung | behoben: ADR 010, `react/no-danger` | 749e672 |
| Architekt 7: Fremde Metadaten | behoben: kein Name aus `user_metadata`, Löschjob in ADR 008 (M9) | 1af7a43 |
| Architekt 9: Fehlersignal | behoben: `RV001` über `private.require_current_legal()`, ADR 010 | 847b2dc |
| Architekt 11: Impressum | siehe QA F3 | e4dfccc |
| Architekt 12: API-Tests | erledigt durch die QA | 3e4bb60 |
| Architekt 13: CHANGELOG | berichtigt | (dieser Commit) |
| Architekt 5, 6, 8, 10, 14–16 | offen mit Termin, siehe CHANGELOG M2 „Noch offen“ | – |

## M3 – Zwischenstand 2026-10-29

Geprüfter Stand: `a85568c` (main, sauber). Geprüft werden nur die fertigen Teile:
- `5180272` Standortverfremdung v2
- `fd96087` Foto-Grundlage
- `a85568c` PLZ-Verzeichnis

Grundlage: Plan M3 inklusive der Abschnitte 12–15, die Reviews des Architekten (Plan, PLZ, Spike), CLAUDE.md und SPEC 3.3. M3 ist **nicht abnahmereif**, das ist auch nicht der Anspruch dieses Zwischenstands. Akzeptanzkriterien von M3 (Assistent, „Meine Anzeigen“, Pflichtfelder) sind noch nicht prüfbar.

### Prüfläufe

| Prüfung | Ergebnis |
|---|---|
| `supabase db reset && supabase test db` | grün, 15 Dateien, 289 Tests. Davon sind 5 neu in `14_qa_m3`, 4 dieser 5 sind TODO-Tests für F1 und F4. Dreimal mit Reset, also jedes Mal mit neuem Vault-Secret. `12_location` lief 25-mal hintereinander grün (zufällige Besitzer-IDs je Lauf). |
| `supabase db lint -s public,private --level warning` | keine Funde |
| Typen (`gen types --local` gegen `database.types.ts`) | identisch |
| `npm run lint`, `npm run typecheck`, `npm run build` | grün |
| `npm test` (Vitest) | 68/68 |
| `npm run test:integration` | 58/58, davon 17 neu (`location.test.ts` 9, `photo-rows.test.ts` 8). Dreimal stabil. Danach ist `test db` ohne Reset grün. |
| `npm run test:e2e` | 7/7, zweimal (vor und nach den neuen Tests). Danach ist `test db` grün. |
| Laufzeit der PLZ-Datenmigration | 0,43 s für 10 402 PLZ, 11 530 Zuordnungen und 13 340 Ortsnamen. Datei 1,0 MB, Tabellen 4,2 MB. Unkritisch. |

### Ergebnis je Teil

**1. Standortverfremdung v2: erfüllt, mit F4 und F6.**
- Kein Orakel für fremde Versätze gefunden:
  - Den Punkt setzt nur der Besitzer. Ein Admin bekommt `42501`, `service_role` ebenfalls (`auth.uid()` ist null). Entfernen (`null`) ist erlaubt.
  - Ein PATCH von C auf eine Anzeige von A antwortet byte-gleich wie ein PATCH auf eine unbekannte id.
  - Der Schlüssel enthält `owner_id`. Damit liefern eigene Probe-Anzeigen nur den eigenen Versatz.
- Kreiswechsel:
  - ohne Punkt → `null`
  - mit zurückgeschicktem gelesenem Punkt → ebenfalls `null`. Es entsteht also keine zweite Stichprobe.
- Rundweg: PostgREST liefert EWKB-Hex, und `geography`-Gleichheit ist exakt (geprüft auf 0,07 m). Der zurückgeschickte Wert ändert nichts, ein gerundeter Wert würde neu verschoben (ADR 006 nennt das).
- Plausibilität:
  - Die Meldung enthält keine Koordinaten.
  - Die Prüfung ist kein Distanz-Orakel, weil der Centroid des Kreises ohnehin öffentlich ist und nur der eigene Punkt geprüft wird.
  - Andere Geometrien (LINESTRING) werden abgelehnt, ohne Koordinaten in der Meldung.
- Secret:
  - Für `anon` und `authenticated` sind `vault` und `listings_blur_location` nicht erreichbar.
  - Über die API: `rpc/listings_blur_location` → 404, `Accept-Profile: vault`/`private` → 406.
  - Alle `security definer`-Funktionen in `public`/`private` setzen `search_path`. Die Abfrage auf Funktionen ohne `search_path` ergab 0 Treffer.
  - `decrypted_secrets` liest außerhalb von `vault` nur der Trigger.
  - Ausnahme: siehe F4.
- Der Fingerprint schlägt fail-closed zu (`RV003`, pgTAP).
- Neu ist ein Integrationstest über PostgREST (Plan 4.3 „Integration“, bisher fehlend):
  - Ring 2,28–5,72 km
  - gleicher Versatz für eine zweite Anzeige
  - anderer Besitzer → anderer Punkt
  - Rundweg, Kreiswechsel, Server, Admin, Fehlermeldungen

**2. Foto-Grundlage: erfüllt, mit F1.** Über die echte API geprüft, alles abgelehnt oder unsichtbar:
- Spaltenrechte per PostgREST:
  - Insert mit `processed_at`, `width`/`height`, `storage_path`, `upload_path`, `thumb_path` oder `id` → `42501`
  - PATCH derselben Spalten und von `listing_id` → `42501`
  - Positivkontrolle: Alt-Text und Reihenfolge
- Upsert `on_conflict=id` mit `merge-duplicates` auf eine fremde Foto-id → abgelehnt, die Zeile bleibt unverändert.
- Unverarbeitete Fotozeilen an einer freigegebenen Anzeige sehen weder anon noch Fremde, weder direkt noch per Embedding `listings→listing_photos`.
- Eingang `listing-uploads`:
  - Gesperrte Wege zum Original, auch für den Besitzer:
    - kein Lesen, keine Signed URL (einzeln und mehrfach), kein `info`/`exists`, kein `object/public`
    - weder `copy`/`move` nach `listing-photos` noch innerhalb des Eingangs
    - kein Upsert
  - Signed Upload URL gibt es nur für den eigenen registrierten Pfad (nicht für Fremde, nicht für freie Pfade) und nie für `listing-photos`.
- Tageslimit (100):
  - Löschen und Neuanlegen umgeht es nicht.
  - Von 10 parallelen Inserts bei Stand 95 kommen genau 5 durch, die anderen bekommen `RV002`. Dreimal stabil.
  - Ein Bulk-Insert über dem Limit legt nichts teilweise an.

**3. PLZ-Verzeichnis: weitgehend erfüllt, mit F2, F5 und F6.**
- Stichprobe von 35 bekannten Paaren, alle richtig:
  - DE (23): z. B. 80331→München Stadt, 85521→LK München, 17033→Mecklenburgische Seenplatte, 83471→Berchtesgadener Land, 66111→Regionalverband Saarbrücken
  - kreisübergreifend: 21039→Hamburg **und** Herzogtum Lauenburg
  - AT (12): z. B. 1010→Wien, 8970→Liezen, 6370→Kitzbühel; 8010, 6020, 4020 und 9020 jeweils Stadt **und** Umland-Bezirk
- Alle 401 Kreise und 94 Bezirke haben mindestens eine PLZ.
- Im Repo und in der ganzen Git-Historie gibt es keine Polygone und keine Exportdateien (`POLYGON((`/`MULTIPOLYGON`: 0 Treffer).
- Rechte: Die Tabellen sind nur lesbar.
- Abbruchprüfungen des Generators:
  - vorhanden: 16 Exporte, Mindestzahlen, unbekannte Kreise, PLZ ohne Kreis, Kreise ohne PLZ
  - Lücken siehe F5
- Lizenzen:
  - `SOURCES.md` nennt alle drei Pflichtvermerke (ODbL, dl-de/by-2-0, CC BY 4.0).
  - Die Seite „Datenquellen“ ist offen laut Plan.
  - Kleinere Lücken siehe F6.

**4. Projekt-Ref, Token, Spike-Reste: im Repo sauber, in der Arbeitskopie nicht (F3).**
- `git log --all -p` enthält
  - keine Projekt-Referenz
  - keinen `SPIKE_TOKEN`-Wert (nur der Name in Plan und Review)
  - keine `*.supabase.co`-Projekt-URL (außer dem Testwert `abc`)
  - kein `sbp_`/`sb_secret_`/JWT
  - keine Spike-Dateien oder Testbilder
- `supabase/functions/` gibt es noch nicht.

**5. Regressionen M1/M2: keine.** Alle Suiten sind grün. Die Fixtures aus M1/M2 (`storage.test.ts`, `postgrest.test.ts`) laufen unverändert mit dem neuen Pfad-Trigger.

### Gefundene Fehler

#### F1 – mittel – Admin-Besitzer ändert eigene freigegebene Anzeigen ohne erneute Prüfung (Fotos, Alt-Text, Inhalte)
`supabase/migrations/20261029104100_listing_photo_processing.sql:93,104,115`: Der neu gefasste `listing_children_guard` zählt `is_admin()` zu `privileged`. Er setzt deshalb eine `active`/`paused`-Anzeige nicht auf `pending_review`, wenn deren Besitzer Admin mit `aal2` ist, und das Foto-Tageslimit gilt für ihn nicht. Dasselbe gilt für Inhaltsänderungen im `listings_guard` (`20261029101500_review_medium.sql:124`, `content_changed and not is_admin`). Das Vier-Augen-Prinzip (Plan 5.1, Review M1) gilt also nur für den Statuswechsel, nicht für spätere Änderungen. Ist die Edge Function da, kann ein Admin an seiner eigenen aktiven Anzeige ungeprüft Fotos, Alt-Texte und Texte veröffentlichen. Auflage 1 (die Function setzt nach der Verarbeitung auf `pending_review`) deckt nur neue Fotos ab, nicht Alt-Text, Reihenfolge, Löschen und Text.

Reproduktion (`supabase/tests/14_qa_m3.test.sql`, TODO-Tests 2–4):
1. Admin (aal2) legt eine Anzeige an. Ein anderer Admin bzw. `postgres` gibt sie frei (`active`).
2. Als derselbe Admin: `insert into listing_photos (listing_id, sort_order) values (<id>, 1)` → Status bleibt `active`.
3. Danach `update listing_photos set alt_text = …` und `update listings set title = …` → Status bleibt `active`.
4. Gegenprobe: Dieselbe Person mit `aal1` → `pending_review`.

Erwartung:
- Für die Rückführung nach `pending_review` und das Tageslimit gilt „privilegiert“ nur für Server-Aufrufe und für Admins an **fremden** Anzeigen (`is_admin() and not owner`).
- Zusammen mit Commit 6 (Guard neu, Statusschleife „als Admin-Besitzer“ laut Auflage 8/C5) beheben, danach `todo_start/todo_end` in `14_qa_m3` entfernen.

#### F2 – mittel – Rund 270 Ortsnamen sind Notiztexte statt Orte
`supabase/data/postal_codes/generate.py:55-61` zerlegt den OSM-Tag `note` an `,`, `/` und `;` und übernimmt jeden Teil als Ortsnamen. Von 9 379 Ortsnamen in DE sind etwa 270 (2,9 %) unbrauchbar:
- 246 enden auf „u.a.“ (`16866 Kyritz u.a.`), einer ist nur `u.a.` (67822)
- Sätze und Satzteile:
  - 99976: „die Postleitzahl ist aber weiterhin 99976“, „die Adressen sind aber weiterhin gültig. Gde. Rodewald wurde 1.1.24 aufgelöst“, „für Rodeberg“
  - 06847: „incl. Kochstedt“, 24796: „und Krummwisch“, 63925: „dazu gehört noch Brunnthal in Hessen“
- Englisch: 26759 „Hinte is different from the municipal boundary“
- PLZ im Namen: „74321 Tamm“, „73635 Welzheim“ (unter 73667)
- abgeschnitten: 73453 „Hüttlingen (bestehend aus Abtsgmünd sowie Fach“
- Tippfehler: 24361 „ittensee“

Die Namen sind laut Plan 6.1 und ADR 012 Vorschläge im Assistenten und landen damit in `listing_places`.
Reproduktion: `select code, place_name from postal_code_places where place_name ~ 'u\.\s?a\.' or place_name ~ '^[a-zäöü]' or place_name ~ '\d' or char_length(place_name) > 40;`
Erwartung:
- Der Generator bereinigt die Namen: „u.a.“ und ein PLZ-Präfix entfernen, nicht an Kommas innerhalb von Klammern trennen.
- Teile, die mit Kleinbuchstaben beginnen oder Ziffern bzw. Satzzeichen eines Satzes enthalten, verwirft er oder schreibt sie in eine Prüfliste.
- Besser ist es, die Namen aus `place`-Knoten bzw. dem Gemeindenamen zu nehmen (Plan 6.1 nennt beides).
- Eine Abbruchprüfung „verdächtige Namen > 0“ verhindert den Rückfall, dazu ein pgTAP-Test mit derselben Abfrage.

#### F3 – mittel – Arbeitskopie ist mit dem Spike-Projekt verlinkt
`supabase/.temp/linked-project.json` (vom 29.10., 17:30) existiert und enthält die Projekt-Referenz. Die Datei ist per `.gitignore` nicht im Repo, Git ist sauber. Plan 13 erlaubte für den Spike ausdrücklich **kein** `supabase link`. Spike-Auflage 10 verlangt „keine Spike-Reste“. Solange der Link besteht, wirken CLI-Befehle ohne `--local`, die auf das verlinkte Projekt zielen, auf das Cloud-Projekt des Nutzers. Das betrifft z. B. `db push`, `functions deploy`, `secrets` und `gen types --linked`. Die Prüfbefehle dieses Berichts liefen alle lokal.
Reproduktion: `ls supabase/.temp/linked-project.json && grep -c "\"ref\"" supabase/.temp/linked-project.json` → 1. Inhalt nicht ausgeben.
Erwartung:
- Der Nutzer führt selbst `supabase unlink` aus (bzw. löscht die Datei) und prüft im Dashboard, dass `photo-spike` und `SPIKE_TOKEN` gelöscht sind (Plan 13.2).
- Für das Spike-Protokoll ergänzen, wie der Link entstanden ist.
- Die QA hat das bewusst nicht selbst getan (keine Cloud-Befehle).

#### F4 – niedrig – `service_role` darf das Standort-Secret lesen
ADR 006 (Zeile 21) sagt: „Lesbar nur über die Trigger-Funktion“. Tatsächlich hat `service_role` (Supabase-Standard) `SELECT` auf `vault.secrets` und `vault.decrypted_secrets` sowie `EXECUTE` auf `vault.create_secret`/`update_secret`. `12_location.test.sql:168-171` prüft nur anon und authenticated. Über PostgREST ist `vault` nicht erreichbar (406, getestet). Eine spätere `public`-Funktion mit `security invoker`, die als `service_role` läuft, oder ein Server-Pfad mit direkter DB-Verbindung könnte das Secret aber lesen. Nach ADR 006 („Ernstfall“) liegen dann alle Zellen offen.
Reproduktion: `select has_table_privilege('service_role', 'vault.decrypted_secrets', 'select');` → `t` (TODO-Test 5 in `14_qa_m3`).
Erwartung: entweder `revoke select on vault.decrypted_secrets, vault.secrets from service_role` (prüfen, ob Supabase-Funktionen das brauchen) **oder** die Aussage im ADR korrigieren und das Restrisiko benennen. Danach den Test in `12_location` um `service_role` ergänzen.

#### F5 – niedrig – Abbruchprüfungen des PLZ-Generators lückenhaft
`supabase/data/postal_codes/generate.py`:
- Die SHA-256-Werte der Eingaben stehen nur in `SOURCES.md`. Der Generator prüft oder druckt sie nicht. Eine andere Datei fällt also nicht auf, und die Reproduzierbarkeit ist nicht belegt.
- AT-CSV (Zeilen 145-155): feste Spaltenpositionen `row[4]`/`row[5]` ohne Prüfung der Kopfzeile. Bei geänderter Spaltenfolge entstünden still falsche Zuordnungen, solange die Mindestzahl erreicht wird.
- `relationen_ohne_flaeche` (Zeile 116) wird nur gezählt, ist aber keine Abbruchbedingung. Heute 0. PLZ ohne Fläche fallen still weg.
- Keine Prüfung der Ortsnamen (siehe F2).

Erwartung: Hash-Abgleich gegen `SOURCES.md` (oder `--expect-sha`), Kopfzeilenprüfung, Abbruch bei `relationen_ohne_flaeche > 0` und bei verdächtigen Namen.

#### F6 – niedrig – Doku- und Konsistenzmängel
- `docs/adr/006-standortverfremdung.md`:
  - Zeile 6: Der Kontextsatz bricht mitten im Wort ab („verfremdeter Pun## Entscheidung (v2, M3)“).
  - Zeile 33: Ein Rest der alten Fassung steht verwaist da („t`, `lng`, … `coordinates`.“).
  - Beides entstand in `5180272`.
- Plausibilitätsradius:
  - Plan 4.1 (Zeile 132) und 12 „B8“ (Zeile 377) nennen 60 km.
  - Migration (`20261029104000_listing_location_v2.sql:43`) und ADR 006 setzen 80 km, wie es das Review B8 als Alternative empfiehlt.
  - Den Plan angleichen.
- Plan 4.3 Test 5 verlangt 200 zufällige Besitzer, `12_location.test.sql:103-129` nimmt 40. Fachlich reicht das: Die Wahrscheinlichkeit, dass weniger als 6 Oktanten belegt sind, liegt bei etwa 4·10⁻⁷. Die Abweichung sollte trotzdem im Plan oder im Testkommentar stehen.
- Kopf der Datenmigration (`generate.py:181-183`, `20261029104300_postal_codes_data.sql:2-3`): Der Kopf nennt OSM und Statistik Austria, aber nicht „© GeoBasis-DE / BKG (2026)“ (dl-de/by-2-0). Die Zuordnung PLZ→Kreis ist aus VG250 abgeleitet. CC BY 4.0 verlangt zudem einen Hinweis auf Änderungen (Bezirk aus der Gemeindekennziffer abgeleitet). ADR 012 nennt unter „ODbL-Pflichten“ nur OSM. Die Pflichtvermerke für BKG und Statistik Austria auf der Seite „Datenquellen“ ergänzen (CHANGELOG Zeile 146 kennt sie schon).

### Offen laut Plan (keine Funde)
- **A1 / Auflage 1:** Admin gibt mit unverarbeiteten Fotos frei. Heute gelingt das. Die Bereitschaftsprüfung bei der Admin-Freigabe kommt mit Commit 6. Ebenso kommt mit Commit 5 das Zurücksetzen auf `pending_review` durch die Function.
- **Commit 5** (Edge Function `process-listing-photo`):
  - Header-Parser, Versuchszähler (Spike-Auflage 4)
  - Folgemigration „kein PNG“ (Spike-Auflage 7; `listing-uploads` nimmt heute noch `image/png` an)
  - `deno.lock`, CI mit Edge Runtime
  - Integrationstests der Metadaten-Entfernung, E2E mit GPS-Fixture
- **Commit 5b:** `listing_places`, `set_listing_location`, `postal_prefix`, Meta-Test „wer darf `listing_places` verwenden“
- **Commit 6:** Guard neu (Pflichtfelder, Legal-Gate `RV001`, Anzeigen-Rate-Limit, Freigabe-Hash, Preisgrenzen, Attribut-Check). Der Koordinaten-Check in `attributes` prüft heute nur Schlüssel der obersten Ebene.
- **Commit 7 ff.:** `listing_content_hints`, `listings.test.ts`, Web-Oberfläche, E2E Inserieren, CHANGELOG M3 (hat noch keinen M3-Eintrag)
- Seite „Datenquellen“ mit ODbL-Download und Namensnennung am PLZ-Feld (M5/M9)
- iOS (I4)
- Messung in eu-central-1 (Spike-Auflage 3, Blocker für den Go-live)

### Nicht prüfbar
- Cloud-Logs, Logging-Checkliste ADR 006 und gehostete Limits: kein Stage-Projekt (ADR 002)
- Web/iOS-Gleichstand, Lokalisierung, App-Store-Pflichten: Für die geprüften Teile gibt es noch keine Oberfläche.

### Neue Tests
- `supabase/tests/14_qa_m3.test.sql` (5): Positivkontrolle aal1, TODO-Tests für F1 (3) und F4 (1). Sie schlagen den Lauf nicht fehl. Nach der Behebung meldet pg_prove sie als „unexpectedly succeeded“, dann `todo_start/todo_end` entfernen.
- `web/integration/location.test.ts` (9): Plan 4.3 „Integration“ und die Orakel-Proben aus Teil 1
- `web/integration/photo-rows.test.ts` (8):
  - Spaltenrechte per PostgREST, Upsert über fremde id, Sichtbarkeit unverarbeiteter Zeilen
  - Wege zum Original (`copy`/`move`, Signed Upload URL, `info`/`exists`)
  - Tageslimit (Löschen, parallel, Bulk). Der Test legt einen eigenen Nutzer an und löscht ihn wieder.

### Empfehlung
Die drei Teil-Commits tragen. Keine Lücke erlaubt Dritten, den Eingabepunkt, den Versatz oder unverarbeitete Originale zu ermitteln, und das Tageslimit hält auch parallel. Vor Commit 5 bzw. 6:
- **F3** sofort (Nutzer: `supabase unlink`, Spike-Reste in der Cloud prüfen).
- **F1** mit Commit 6 beheben, zusammen mit A1, und dabei denselben Maßstab „Admin an eigener Anzeige = Besitzer“ für Kinder-Tabellen und `listing_places` (5b) anlegen.
- **F2** vor Commit 12 (Assistent mit Ortsvorschlägen), am besten zusammen mit F5.
- F4 und F6 bei Gelegenheit, F6 (ADR-006-Textschaden) mit dem nächsten Doku-Commit.

### Nachtrag 2026-10-29: Stand der Behebung (QA M3 Zwischenstand)
| Fund | Stand | Commit |
|---|---|---|
| F1: Admin-Besitzer umgeht die Prüfung | behoben: Admin an der eigenen Anzeige = Besitzer in Guard und Kinder-Guard (Migration `listing_rules`, ADR 013); TODO-Tests in `14_qa_m3` sind jetzt reguläre Tests, Statusmatrix als Admin-Besitzer in `17_listing_rules` | (Commit 6) |
| F2: Notiztexte als Ortsnamen | behoben: Gemeindenamen aus VG250 als Hauptquelle, OSM-Namen bereinigt, Abbruch bei verdächtigen Namen, pgTAP `13_postal_codes` | d978eea |
| F3: Arbeitskopie mit Cloud-Projekt verlinkt | behoben: Link-Datei gelöscht, Teil-Ref aus dem Bericht entfernt. Ursache: `supabase functions list --project-ref …` im Repo-Ordner. CLI-Befehle gegen die Cloud laufen künftig nur außerhalb des Repos. | – |
| F4: `service_role` liest das Standort-Secret | Grant von `supabase_admin`, per Migration nicht entziehbar. ADR 006 korrigiert, Restrisiko benannt; Meta-Test in `12_location`: nur die Verfremdungsfunktion verwendet `vault` | (dieser Commit) |
| F5: Abbruchprüfungen des Generators | behoben: `inputs.sha256`, Kopfzeilenprüfung AT, Abbruch bei Relationen ohne Fläche und verdächtigen Namen | d978eea |
| F6: Doku-Mängel | behoben: ADR-006-Textschäden, Plan auf 80 km und 40 Besitzer angeglichen, Lizenzvermerke BKG und Statistik Austria im Migrationskopf und in ADR 012 | d978eea, (dieser Commit) |

## M3 – Abnahme 2026-10-30

Geprüfter Stand: `b7aaf92` (main, Arbeitsbaum sauber). Geprüft wurden die M3-Commits `16b6369` bis `4e0743e` sowie `b8e71cb` (Dev-Origin) und `b7aaf92` (Wildart `other_predators`). Umgebung: macOS, Node 24.22.1, Supabase CLI 2.122.0 (lokal, nach `supabase stop && supabase start` wegen `config.toml`), Deno 2.1.4 aus Docker, Chromium headless (Playwright).
Grundlage: SPEC 6 (M3), Plan M3 inklusive der Abschnitte 12–15, ADR 006, 011, 012 und 013, CHANGELOG „M3“ und „Nachtrag M3“, CLAUDE.md. iOS (I4) ist laut Plan nicht Teil von M3.

### Prüfläufe

| Prüfung | Ergebnis |
|---|---|
| `supabase db reset && supabase test db` | grün, 20 Dateien, **410** Tests. Mit der neuen QA-Datei sind es 21 Dateien und 418 Tests, davon 5 TODO (F2). |
| `supabase test db` ohne Reset nach `npm run test:e2e` | **rot**: `08_storage` Test 28 „A löscht keine Fotos von B“ (have 5, want 3), siehe F4 |
| Deno (`deno task check && deno lint && deno task test`, Image wie CI-Job `functions`) | grün, **24/24** (Header-Parser 10, Pipeline 14) |
| `npm run lint`, `npm run typecheck` | grün, auch mit der neuen E2E-Datei |
| `npm test` (Vitest) | **143/143** |
| `npm run test:integration` | **104/104**. Der erste Lauf direkt nach dem Neustart der Container brach mit „supabaseKey is required“ ab, statt zu überspringen (F10). |
| `npm run test:e2e` | **10/10** (Stand `b7aaf92`); mit `qa-m3.spec.ts` sind es 16/16, davon 2 erwartete Fehlschläge (`test.fail`, F1 und F3) |
| `npm run build` | grün |
| Browser-Bundle (`.next/static`) | Die Werte von `SECRET_KEY` und `SERVICE_ROLE_KEY`: 0 Treffer. Die Zeichenkette `sb_secret_` steht nur in der Env-Prüfung („darf nie in den Browser“) und in supabase-js. Der publishable Key ist jetzt im Bundle. Das ist gewollt, weil der Foto-Upload über den Browser-Client läuft. |

### Ergebnis je Akzeptanzkriterium

| # | Kriterium (SPEC 6 M3, Plan 0) | Ergebnis | Nachweis |
|---|---|---|---|
| a | Assistent für alle 5 Arten, jeweils Angebot und Gesuch | **erfüllt** (Einschränkung F5) | E2E: Pacht vollständig, die anderen 4 Arten über die Pflichtfeldprüfung; QA-E2E: Helfer-Gesuch, Tastatur, 360 px in pl |
| b | Foto-Upload mit Verkleinerung, höchstens 8 | **erfüllt** | Vitest `targetSize`, pgTAP-Limit 8, E2E. QA-E2E: JPEG mit GPS und WebP mit EXIF über den ganzen Weg; Bild und Thumbnail ohne Exif, GPS, XMP und Kommentar; nichts nach EOI; Eingang gelöscht; Orientierung 6 gedreht |
| c | Preisfeld mit Währung | **erfüllt** mit F3 | Vitest `price.test.ts`, DB `price_bounds`, E2E „8.400 € pro Jahr“ |
| d | Entwurf speichern | **erfüllt** | Jeder Schritt speichert per Server Action, E2E |
| e | Absenden → `pending_review` | **erfüllt** | E2E, `listings.test.ts`, Statusmatrix in `17_listing_rules` |
| f | **Akzeptanz:** Anzeige erscheint in „Meine Anzeigen“ mit Status | **erfüllt** | E2E: „In Prüfung“, keine Aktion zum Freischalten; Zurückziehen und Löschen im QA-E2E |
| g | **Akzeptanz:** Pflichtfelder je Art werden validiert | **erfüllt**, Lücke F2 | DB und Zod mit denselben Feldcodes (`17_listing_rules`, `listing-rules-parity.test.ts`, E2E). Leerraum außer U+0020 zählt in der DB als Inhalt. |
| h | Pflichtpunkt A: EXIF/GPS serverseitig entfernt | **erfüllt** | Deno-Tests, `photo-processing.test.ts`, QA-E2E |
| i | Pflichtpunkt B: Standort nicht herausmittelbar | **erfüllt** | `12_location`, `location.test.ts` (Zwischenstand-QA), unverändert grün |
| j | Der Nutzer setzt nie selbst `active` | **erfüllt** | Statusmatrix, Upsert-Wege, Admin-Besitzer, eigene Proben (siehe unten) |

### Definition of Done (CLAUDE.md)

| Punkt | Ergebnis |
|---|---|
| Build ohne Warnungen, Lint und Typecheck grün | erfüllt |
| Tests grün | erfüllt; nach E2E ohne Reset aber rot (F4) |
| Neue Texte in 4 Sprachen | erfüllt. Die Schlüssel sind in allen 4 Dateien gleich. 106 im Code benutzte Schlüssel (Arten, Status, Feldcodes, Attribute, Optionen, Fotofehler, Hinweise) sind überall vorhanden. Es gibt keine hartcodierten Strings in `components/listings` und `app/[locale]/account/listings`. |
| Fachbegriffe im Glossar abgestimmt | teilweise: Arten, Richtungen, Status und Wildarten ja, die Attributbegriffe aus SPEC 3.2 fehlen (F8) |
| Lücke Web/iOS im CHANGELOG | erfüllt (I4) |
| RLS für neue Tabellen, getestet | erfüllt: `listing_places` (Policies und Tests); `private.listing_creations`, `listing_approvals` und `content_terms` mit RLS und ohne API-Rechte (Meta-Test `private`) |
| CHANGELOG mit Testanleitung | erfüllt. Die Anleitung wurde nachvollzogen und funktioniert. Inhaltliche Abweichungen: F1, F8. |

### Sicherheitsprüfung (eigene Proben, Transaktion mit Rollback bzw. API)

| Probe | Ergebnis |
|---|---|
| B liest `listing_places` von A, auch per Embedding und Zählung | 0 Zeilen (zusätzlich `places.test.ts`) |
| anon liest `listing_places` | `42501` (kein Grant); öffentlich ist nur `postal_prefix` |
| Admin mit `aal1` / `aal2` liest Orte | 0 / alle (nur mit 2FA, wie Plan) |
| B ruft `set_listing_location`, `reorder_listing_photos`, `listing_content_hints` für eine Anzeige von A auf | `42501` bzw. leer, gleiche Antwort wie bei einer unbekannten id |
| Freigabe-Hash lesen oder als Orakel nutzen | `listing_approvals` und `listing_content_hash` sind für API-Rollen nicht erreichbar, `listing_resume_allowed` liefert nur ja/nein für eigene Anzeigen |
| Fortsetzen nach Änderung (Text, Foto, Alt-Text, Ort, Wildart) | `pending_review` (pgTAP, API); kein Weg zu `active` ohne Freigabe gefunden |
| Admin gibt mit unverarbeitetem Foto frei | `23514 photos.unprocessed` |
| Foto an aktiver Anzeige | Der Kinder-Guard setzt sofort `pending_review`, die Function danach erneut (`complete_photo_processing`) |
| Rate-Limit | Advisory-Lock, Zähler übersteht Löschen (pgTAP mit echten Grenzen). Lokal ist es per `seed.sql` auf 1000 angehoben, deshalb gibt es keinen API- oder E2E-Nachweis (F10). |
| Legal-Gate | `RV001` beim Anlegen, Ändern, Absenden, Fortsetzen und bei `set_listing_location`; nicht beim Pausieren, Zurückziehen und Löschen |
| Exakte Lage | Das Web setzt keinen Punkt (`display_location` bleibt leer); Hints und Fehlermeldungen nennen nie PLZ oder Koordinaten |
| Waffen/Munition in Kategorien | keine; Arten, Optionen und Wildarten sind neutral. Der Begriffsabgleich (`18_content_hints`) trifft in allen 4 Sprachen auch Großbuchstaben mit Diakritika (`BÜCHSE`, `ZBRAŇ`, `BROŃ`, `STŘELIVO`; DB-Locale `en_US.UTF-8`). |
| **Leerraum als Pflichtinhalt** | **Lücke:** 30 Zeilenumbrüche bzw. 30 × U+00A0 als Beschreibung und `\t\t\t` als Titel werden angenommen und abgesendet (F2) |

### Web-Pflichten und Lokalisierung
- Alle Assistent- und Kontoseiten haben `noindex` (QA-E2E prüft das auf 8 Seiten in pl).
- Impressum, Datenschutz und Nutzungsbedingungen sind im Footer verlinkt.
- Cookie-Consent: nicht zutreffend (M9). M3 setzt keine neuen Cookies außer der Session.
- Öffentliche Seiten gibt es noch nicht (M5).
- 360 px in pl (längste Sprache): keine horizontale Überbreite auf „Meine Anzeigen“, „Neu“ und allen 6 Schritten (QA-E2E).
- cs/pl sind muttersprachlich ungeprüft (bekannt, SPEC 7.6). Zur neuen Wildart siehe F9.
- Offline: Der Foto-Upload meldet „network“, das ist lokalisiert (Code geprüft, nicht simuliert). Server Actions zeigen offline die Fehlerseite des Browsers. Ein Offline-Hinweis nach SPEC 4.3 fehlt im Web noch, das ist kein M3-Kriterium.

### Gefundene Fehler

#### F1 – mittel – Ohne JavaScript ist der Assistent unsichtbar (CHANGELOG sagt das Gegenteil)
Die Seiten rendern ihren Inhalt in `<Suspense fallback={null}>`. Mit `cacheComponents`/PPR kommt der dynamische Teil gestreamt in `<div hidden id="S:…">` und wird erst per Inline-Skript (`$RC`) eingesetzt. Ohne JavaScript sieht der Nutzer nur Kopfzeile, Überschrift „Anzeige aufgeben“ und Footer. Formular, Schritte und Fehlerzusammenfassung fehlen. Das gilt im Dev-Server und im Produktions-Build (`next start`). Der CHANGELOG M3 („Bekannte Lücken“) sagt: „Fotos lassen sich nur mit JavaScript hochladen. Alle anderen Schritte gehen ohne.“ Dieselbe Bauweise haben „Meine Anzeigen“ und `/account`, dort nicht einzeln geprüft.
Reproduktion:
1. Anmelden, dann in einem Kontext mit `javaScriptEnabled: false` `/de/account/listings/new` öffnen. Das Feld „Titel“ ist nicht sichtbar.
2. `QA_DUMP_HTML=1 npx playwright test e2e/qa-m3.spec.ts -g "ohne JavaScript"` → `QA-HTML … hiddenS: 122 form-at: 46157 firstHidden-at: 34076 RC: true`: Das Formular steht hinter dem ersten versteckten Streaming-Container.
3. Test „Assistent ohne JavaScript“ in `qa-m3.spec.ts` (als `test.fail` markiert).

Erwartet: Entweder geht der Assistent ohne JS (Inhalt nicht im versteckten Stream, z. B. Daten im Seitensegment statt in einer Suspense-Grenze laden), oder der CHANGELOG nennt die Einschränkung ehrlich und es gibt einen `<noscript>`-Hinweis.
**Risiko für M5:** Öffentliche Seiten mit demselben Muster lieferten Crawlern ohne JS-Rendering und Link-Vorschauen einen leeren Hauptteil.

#### F2 – mittel – Pflichtfelder lassen sich mit Leerraum füllen; DB und Zod zählen verschieden
Die DB kürzt mit `btrim(x)`, das entfernt nur U+0020 (`listing_readiness`: `char_length(btrim(l.description)) < 30`; Check `listings_title_check`). Zod kürzt mit `String.trim()` jeden Leerraum. Über die API gilt deshalb:
- 30 Zeilenumbrüche, Tabs/CRLF oder 30 × U+00A0 bestehen als Beschreibung die Bereitschaftsprüfung, die Anzeige geht in die Prüfung.
- Ein Titel aus drei Tabs wird angelegt.

Das Web lehnt dieselben Eingaben ab. Damit ist die zugesagte Parität DB/Zod (ADR 013) verletzt, und die Pflichtangabe „Beschreibung 30 Zeichen“ ist über iOS oder direkt per API umgehbar.
Nebenbefund: Für Höchstlängen zählt Zod UTF-16-Einheiten (`length`), die DB Codepoints (`char_length`). Ein Titel aus 60 Emoji wird im Web als zu lang abgelehnt, in der DB angenommen.
Reproduktion:
- `supabase test db` → `20_qa_m3_abnahme`, TODO-Tests 4–8 („have: ok, want: 23514“)
- als `authenticated` per psql (gleiche Rolle und Claims wie PostgREST): `update listings set description = repeat(E'\n', 30), status = 'pending_review' where id = <eigener Entwurf, helper/wanted>` → ok, Status `pending_review`. Über HTTP nicht eigens ausgeführt.

Vorschlag:
- In der DB `regexp_replace(x, '^[[:space:]  -​　]+|[[:space:]  -​　]+$', '', 'g')` (oder eine Hilfsfunktion `private.trim_all`) in der Bereitschaftsprüfung und im Titel-Check verwenden.
- In Zod Codepoints zählen (`[...v].length`).
- Die Fälle in `supabase/tests/fixtures/listing_rules.json` aufnehmen.
- Danach `todo_start/todo_end` in `20_qa_m3_abnahme` entfernen.

#### F3 – mittel – Eingegebener Preis geht ohne Hinweis verloren
Im Schritt „Preis und Zeitraum“ sind Betrag, Währung und Einheit immer sichtbar. Gespeichert wird der Betrag aber nur, wenn zusätzlich die Option „Betrag“ gewählt ist (`actions.ts`: `if (mode === "amount")`). Sonst speichert die Action „Keine Angabe“ und geht ohne Meldung weiter. Die Vorschau zeigt „Keine Preisangabe“. Bei neuen Anzeigen ist keine Option vorgewählt, der naheliegende Weg (Betrag eintippen, „Speichern und weiter“) verliert also die Eingabe. Das verstößt gegen „Fehler nie stumm schlucken“.
Reproduktion:
1. Entwurf anlegen, Schritt 5 öffnen.
2. „Betrag“ = 1200 eingeben, keine Option wählen, „Speichern und weiter“.
3. Die Vorschau zeigt „Keine Preisangabe“.

Test „Preis: eingegebener Betrag geht nicht stumm verloren“ in `qa-m3.spec.ts` (`test.fail`).
Vorschlag: Ist ein Betrag eingetragen und keine Option gewählt, den Modus `amount` annehmen. Bei „Keine Angabe“ bzw. „Auf Anfrage“ mit Betrag einen Feldfehler zeigen. Alternativ die Betragsfelder erst nach Wahl von „Betrag“ anbieten, ohne JS über eigene Formularabschnitte.

#### F4 – niedrig – pgTAP wird nach E2E-Läufen rot (Regression zu QA M2 F6)
`e2e/listings.spec.ts` räumt nicht auf. Nach einem Lauf bleiben 6 Anzeigen, die Testkonten und 2 Dateien in `listing-photos`. `08_storage` zählt `storage.objects` global, deshalb schlägt Test 28 fehl („have: 5, want: 3“). In der CI laufen die Jobs getrennt, lokal stimmt nach dem Nachtrag zu M2 („pgTAP-Zählungen sind unabhängig von E2E-Resten“) die Erwartung nicht mehr.
Reproduktion: `supabase db reset && npm run test:e2e && supabase test db` → `08_storage` Test 28 FAIL.
Vorschlag: `afterAll` in `listings.spec.ts` löscht Konten und Dateien, wie `qa-m3.spec.ts` es tut. Zusätzlich die Zählungen in `08_storage` auf die Ordner der Testnutzer beschränken.

#### F5 – niedrig – Art oder Richtung einer freigegebenen Anzeige lässt sich im Assistenten nicht ändern
Ändert der Besitzer in „Grunddaten“ die Art einer aktiven oder pausierten Anzeige, leert die Action die Attribute (`attributes: {}`). Der Guard setzt `pending_review`, und die Bereitschaftsprüfung lehnt den Zwischenstand ab, z. B. `{"fields": ["attributes.lease_type","attributes.revier_type","area_hectares"]}`. Die neuen Pflichtfelder lassen sich erst im Schritt „Details“ der neuen Art speichern. Dorthin kommt der Nutzer aber nicht, und „Zurückziehen“ gibt es für `active`/`paused` nicht. Bei `pending_review` hilft Zurückziehen. Per API geht der Wechsel in einem Update (geprüft). Dasselbe gilt für Gesuch → Angebot, wenn der Ort fehlt.
Reproduktion (DB-Seite per psql als Besitzer geprüft, UI-Ablauf aus dem Code abgeleitet): freigegebene Helfer-Anzeige → `update listings set kind = 'lease', attributes = '{}', area_hectares = null` → `23514 listing_not_ready`. Im UI: Bearbeiten → Grunddaten → „Jagdpacht“ → Speichern → Fehlerzusammenfassung mit Feldern aus „Details“, Art unverändert.
Vorschlag: Art und Richtung bei `active`/`paused` sperren und erklären („neue Anzeige aufgeben“), oder Grunddaten und Details beim Wechsel gemeinsam speichern.

#### F6 – niedrig – „Entwurf löschen“ löscht Fotodateien auch dann, wenn die Anzeige kein Entwurf mehr ist
`deleteDraft` liest die Fotos ohne Statusfilter und entfernt die Dateien aus `listing-photos`. Erst danach löscht es die Zeile mit `.eq("status", "draft")`. Bei veralteter Ansicht (zweiter Tab hat schon abgesendet) oder einem nachgebauten Aufruf der Server Action schlägt das Löschen der Zeile fehl. Die Bilddateien sind dann aber weg, die Fotozeilen bleiben als verarbeitet stehen. Die Anzeige geht mit kaputten Bildern in die Prüfung bzw. bleibt so öffentlich. Die Storage-Policy erlaubt das Löschen, weil `owns_editable_listing` auch für `active` gilt. Es gibt keine Statusänderung.
Reproduktion (aus dem Code abgeleitet, nicht ausgeführt): Tab A „Meine Anzeigen“ mit Entwurf (mit Foto), „Entwurf löschen“ aufklappen. In Tab B denselben Entwurf absenden. In Tab A „Endgültig löschen“ → Meldung „fehlgeschlagen“. Die Anzeige ist „In Prüfung“, `storage.objects` enthält ihre Bilder nicht mehr.
Vorschlag: Zuerst den Status prüfen (oder die Zeile zuerst löschen und die Dateien danach), Dateien nur bei Status `draft` entfernen.

#### F7 – niedrig – Fotos und Formular: kleinere Barrierefreiheits- und UX-Mängel
- `PhotoUploader`: Wählt der Nutzer mehr Dateien als freie Plätze, wird der Hinweis „limit“ sofort von „wird hochgeladen“/„n hochgeladen“ überschrieben. Dass Dateien übersprungen wurden, erfährt er nicht.
- Ersatz-Alt-Text: Es wird immer nur der Titel verwendet. Plan 2.7 verlangt bei mehreren Fotos „{Titel}, Foto n von m“, heute haben alle Fotos denselben Alt-Text (QA-E2E prüft den Ist-Zustand).
- Preis: Die Option „Betrag“ und das Textfeld „Betrag“ haben denselben zugänglichen Namen (de „Betrag“). Screenreader-Nutzer können sie nicht unterscheiden. Auch der E2E-Test muss über die Rolle trennen.
- Mehrere Alt-Text-Felder heißen gleich („Alt-Text (optional)“). Der Name sollte die Fotonummer enthalten, wie bei den Buttons.
- Der Client prüft die Größe der Originaldatei nicht vor dem Dekodieren. Sehr große PNG/WebP (z. B. 20 000 × 20 000) würden voll in den Speicher geladen, der Tab könnte einfrieren (nicht ausprobiert). Die 15-MB-Grenze gilt erst nach der Umwandlung.
- `aria-invalid` steht auf `<fieldset>` (Wildarten, Mehrfachauswahl). ARIA 1.2 sieht das für `group` nicht vor; die Fehlermeldung ist aber per `aria-describedby` verbunden.

#### F8 – niedrig – Doku nicht nachgezogen
- **SPEC ist nicht auf v0.5** (Plan 8):
  - 3.2 nennt für `trophy_hunt` noch `species_targeted[]` (entfallen, Antwort 2) und weder `trophy_details` noch `legal_ack`.
  - 3.1 kennt weder `listing_places` noch `listings.postal_prefix`, die neuen Fotospalten (`upload_path`, `thumb_path`, `processed_at`, `width`, `height`, `alt_text`, `processing_attempts`) oder die Tabelle `listing_species` mit Pflicht je Art.
  - iOS (I4) baut auf der SPEC auf.
- **Glossar:** Die Attributbegriffe aus SPEC 3.2 fehlen in `docs/GLOSSARY.md`, obwohl Plan 7 sie verlangt. Gemeint sind Pachtart (Eigenjagd, Genossenschaftsjagd, Pachtnachfolge, Pachtanteil), Reviertyp (Hochwild … Wasser), Umfang (selbstständig/in Begleitung), Abschussplan, Abgabefrist, Mitpächter, Preiseinheiten usw. Die cs/pl-Begriffe stehen nur in den Message-Dateien und werden in I4 sonst anders übersetzt.
- **CORS:** Die Function antwortet mit `Access-Control-Allow-Origin: *`, Plan 7 sagt „CORS auf `SITE_URL`“. Mit Bearer-Token ohne Cookies ist das sicherheitlich vertretbar (Kommentar in `index.ts`), es fehlt aber in ADR 011.
- **CHANGELOG:**
  - „E2E mit GPS-Fixture“ belegt die Metadatenfreiheit nicht, weil `listings.spec.ts` nur den Upload prüft. Den Nachweis führen Deno- und Integrationstests, über den ganzen Weg jetzt `qa-m3.spec.ts`.
  - Spike-Auflage 5 („E2E: WebP mit EXIF durch den ganzen Weg“) war offen und ist mit `qa-m3.spec.ts` erfüllt.
  - Zur Aussage über den Assistenten ohne JS siehe F1.

#### F9 – niedrig – Neue Wildart: cs-Begriff fraglich, Cache verzögert neue Referenzdaten
- `other_predators`: Die Namen in de („Sonstiges Raubwild“) und en („Other predators“) sind passend und in Glossar und Migration gleich. cs „Ostatní dravá zvěř“: Im Tschechischen meint „dravci/dravý“ vorwiegend Greifvögel, die nicht bejagbar sind. Für Haarraubwild (Dachs, Marder, Waschbär, Marderhund) ist „šelmy“ üblich, etwa „Ostatní šelmy“. pl „Inne drapieżniki“ ist vertretbar; analog zu `small_game` („Inna drobna zwierzyna“) eher „Inne drapieżniki (zwierzyna)“ oder „Pozostałe drapieżniki“. Beides von Muttersprachlern prüfen lassen (SPEC 7.6). Bis dahin bleibt der Glossar-Status „ungeprüft“, das ist korrekt.
- `listSpecies`/`listRegions` sind mit `cacheLife("days")` gecacht. Eine neue Wildart oder ein neuer Kreis erscheint im Web erst nach Ablauf des Caches bzw. nach einem Deploy. Der CHANGELOG nennt das nur für den Dev-Server. Für die Cloud gehört ein Punkt „nach Referenzdaten-Migration Cache revalidieren/deployen“ in die Release-Checkliste.

#### F10 – niedrig – Testlücken und Test-Infrastruktur
- **`RV002` im Web:** Die Meldung „Limit erreicht“ mit Zeitpunkt (`?error=rateLimited&retry=…`) ist weder per Vitest noch per E2E geprüft. Lokal hebt `seed.sql` das Limit auf 1000, manuell ist das also nicht nachvollziehbar. Vorschlag: ein API-Test, der für einen Testnutzer das Limit per `app_settings` senkt, oder ein Vitest für `toError`.
- `seed.sql` läuft auch bei Supabase Branching (Preview-Branches). Dort gälte dann das Limit 1000. Das gehört in ADR 013 bzw. die Cloud-Checkliste.
- `integration/listings.test.ts` und `photo-processing.test.ts` rufen `serviceClient(fx)` schon im `describe` auf. Ist Supabase nicht erreichbar, brechen sie mit „supabaseKey is required“ ab, statt wie die übrigen Dateien zu überspringen. Das ist einmal direkt nach dem Container-Neustart aufgetreten.

### Nicht prüfbar
- iOS (I4), Gleichstand Web/iOS, App-Store-Pflichten: Es gibt noch keine App.
- Freigabe im Admin-Bereich (M4), öffentliche Detailseite und Suche (M5): Bis dahin wurde nur über die DB freigegeben.
- Fotoverarbeitung in eu-central-1 (Spike-Auflage 3, Blocker für den Go-live).
- Muttersprachliche Prüfung cs/pl.

### Neue Tests
- `supabase/tests/20_qa_m3_abnahme.test.sql` (8): 3 Positivkontrollen und 5 TODO-Tests für F2 (Beschreibung aus Zeilenumbrüchen, Tabs/CRLF, U+00A0; Titel aus Tabs bzw. U+3000)
- `web/e2e/qa-m3.spec.ts` (6). Die Testkonten samt Dateien werden in `afterAll` gelöscht.
  - Assistent ohne JavaScript inklusive Länderwechsel, Absenden, Zurückziehen, Entwurf löschen (`test.fail`, F1)
  - Fotos: JPEG mit GPS/XMP/Kommentar und WebP (VP8X) mit EXIF/GPS über den ganzen Weg. Bild und Thumbnail ohne Metadaten und ohne Anhang, Eingang gelöscht, Orientierung angewandt, lange Seite ≤ 2048. Dazu der Ist-Zustand des Alt-Fallbacks (F7).
  - Fehlerzusammenfassung: `role=alert`, Anker `#f-postal`, `aria-invalid`, `aria-describedby`, Fehlertext am Feld, Sprung per Tastatur
  - Tastatur: Schritt 1 nur mit Pfeiltasten, Leertaste, Tab und Enter
  - 360 px in pl ohne Überbreite auf 8 Seiten, alle mit `noindex`
  - Preis geht nicht stumm verloren (`test.fail`, F3)
  - Optional gegen den Produktions-Build: `QA_BASE_URL=http://localhost:3456`

### Empfehlung
M3 ist **mit Auflagen abnahmereif**. Die beiden Akzeptanzkriterien sind erfüllt. Es gibt keinen blockierenden oder hohen Fund, und kein Weg führt an Moderation, Freigabe-Hash, Legal-Gate oder Standortschutz vorbei.
- Vor M4: **F2** beheben (Pflichtfeld-Parität, betrifft auch iOS), **F3** beheben, **F1** entscheiden (beheben oder CHANGELOG korrigieren, vor M5 unbedingt klären), **F4** (Aufräumen in `listings.spec.ts`).
- Mit dem nächsten Doku-Commit: **F8** (SPEC v0.5, Glossar-Attribute), **F9** (cs-Begriff an die Muttersprachler).
- Bei Gelegenheit: F5, F6, F7, F10.

### Nachtrag: Status der Funde (2026-10-30)

| Fund | Status | Commit |
|---|---|---|
| F1 ohne JavaScript | behoben (blockierendes Rendern, QA-E2E ohne `test.fail`) | `4aa3d69` |
| F2 Leerraum, Codepoints | behoben (`private.trim_all`, Zod in Codepoints, TODO-Tests aktiv) | `a751b66`, `599b1cd` |
| F3 Preis geht verloren | behoben (`price_conflict`, keine Vorauswahl) | `350d9c9` |
| F4 E2E-Reste | behoben (`e2e/cleanup.ts`, Zählung eingegrenzt) | `43479d6` |
| F5 Art/Richtung | behoben (gesperrt ab Einreichung) | `2924697` |
| F6 Entwurf löschen | behoben (Dateien nur bei Status `draft`) | `609a593` |
| F7 Barrierefreiheit/Fotos | behoben | `583c817` (Optionsname in `350d9c9`) |
| F8 Doku | behoben (SPEC v0.5, Glossar, ADR 011, CHANGELOG) | Doku-Commit |
| F9 Wildart | cs-Begriff laut Produkt korrekt; Cache als Cloud-Checklistenpunkt | Doku-Commit |
| F10 Testlücken | behoben (Vitest `listing-errors`, E2E Tageslimit, SKIPPED-Schlüssel, ADR 013 Branching) | `1b94e35` |

Testlauf danach: pgTAP 424, Vitest 153, API 111, E2E 19; `supabase test db` nach E2E ohne Reset grün; Lint, Typecheck, DB-Lint und Build grün.

## M4 – Abnahme 2026-10-30

Geprüfter Stand: `6890685` (main, Arbeitsbaum sauber). Geprüft wurden die M4-Commits `a96cf1d` bis `6890685`. Umgebung: macOS, Node 24.22.1, Next.js 16.4.1, Supabase CLI 2.122.0 (lokal, nach `supabase stop && supabase start` wegen TOTP in `config.toml`), Chromium headless (Playwright). Produktions-Build per `npx next start -p 3456`.
Grundlage: SPEC v0.6 (5, 6 M4), Plan M4 mit Architekt-Review (10) und „Eingearbeitet“ (11), ADR 014, ADR 005/010/013, CHANGELOG „M4 Admin-Bereich (Freigabe)“, CLAUDE.md. iOS ist laut Plan nicht Teil von M4 (Lücke im CHANGELOG vermerkt).

### Prüfläufe

| Prüfung | Ergebnis |
|---|---|
| `supabase db reset && supabase test db` | grün, 24 Dateien, **506** Tests. Mit der neuen QA-Datei 25 Dateien und **541** Tests, davon 1 TODO (F4). |
| `supabase test db` ohne Reset direkt nach `npm run test:e2e` | grün (506 bzw. 541). Rollen, MFA-Faktoren, Audit-Zeilen und Anzeigen sind nach E2E weg. Reste siehe F5 und Hinweise. |
| `npm run lint`, `npm run typecheck` | grün, auch mit der neuen E2E-Datei |
| `npm test` (Vitest) | **161/161** |
| `npm run test:integration` | **117/117** |
| `npm run test:e2e` (Dev-Server) | **25/25**; mit `qa-m4.spec.ts` **36/36** (davon 3 erwartete Fehlschläge per `test.fail`: F1 CSP, F2, F4) |
| `admin.spec.ts` gegen den Produktions-Build (`QA_BASE_URL=http://localhost:3456`) | **6/6**, ohne CSP-Verletzungen |
| `qa-m4.spec.ts` gegen den Produktions-Build | **11/11** (davon 5 erwartete Fehlschläge: F1 Status anonym/Nicht-Admin, F1 CSP, F2, F4) |
| `npm run build` | grün, ohne Warnungen. Auffällig: alle Admin-Routen sind dynamisch (ƒ) oder PPR (◐ bei `/admin/listings/[id]`), die Antworten tragen `x-nextjs-postponed: 1` (F1). |

### Ergebnis je Akzeptanzkriterium

| # | Kriterium (SPEC 6 M4, Plan 0) | Ergebnis | Nachweis |
|---|---|---|---|
| a | Freigegebene Anzeige wird sichtbar (`active`, für anon lesbar) | **erfüllt** | `22_moderate_listing` (anon liest), `admin.test.ts`, E2E „Warteschlange“; öffentliche Seiten folgen in M5 |
| b | Abgelehnte Anzeige zeigt den Grund im Dashboard | **erfüllt** | E2E auf Polnisch: Vorlage übersetzt, Freitext unverändert; „Bearbeitung anfordern“ zeigt den Hinweis in „Meine Anzeigen“ und im Assistenten, er verschwindet nach erneutem Absenden |
| c | Nicht-Admins erhalten 403 | **erfüllt** auf allen kanonischen Pfaden (`/{locale}/admin…`, auch `/de/./admin`, Query, unbekannte Unterpfade, gesperrte und gelöschte Admins), Dev und Produktion. **Einschränkung F1:** Über prozentkodierte Pfade (`/de/%61dmin`) liefert der Produktions-Build 200 mit der Seite „Kein Zugriff“, die zweite Schicht hinter dem Proxy setzt den Status nicht. |
| – | `/admin` mit Admin-Rolle und 2FA | **erfüllt** | aal1 → `/admin/mfa`, alle RPCs verlangen aal2 (`is_admin`), Integration mit echtem aal2 |
| – | Freigabe/Ablehnung inkl. Grund | **erfüllt** | RPC mit Versionsvergleich, Vorlage plus Freitext, Pflicht bei „anderer Grund“ |
| – | Audit-Log | **erfüllt** | Entscheidungen mit Akteur, Code und Freitext; `role.*` per Trigger (auch SQL); `user.looked_up` ohne E-Mail; Filter und Paging. Audit ist für Admins nicht schreib- oder löschbar (QA-pgTAP). |

### Architekt-Auflagen (Plan 10)

| Auflage | Status | Bemerkung |
|---|---|---|
| B1 Freigabe nur für gesehenen Stand | **erfüllt** | `for update`, Version vor Inhalt gelesen. QA ergänzt: neues Foto, Alt-Text, „Bearbeitung anfordern“ mit altem Stand, Version `null`/leer → `RV004` |
| B2 Schutz der Admin-Ernennung | **erfüllt** | Step-up per `amr` in der DB, 3/10 in 24 h, 7 Tage Karenz, letzter **aktiver** Admin unter Advisory-Lock, Trigger-Audit, Runbooks in ADR 005. Kleine Lücke F3 (Kandidat per URL). |
| B3 MFA-Einrichtung nicht per GET | **erfüllt** mit JS | GET legt nichts an (E2E), unbestätigte Faktoren werden vor jedem Start entfernt (höchstens 1 offener Faktor), Secret nur in der Action-Antwort (`no-store`), nie in URL/Cookie. Ohne JS ist die Einrichtung nicht möglich (F2). |
| A1 403 im Proxy und im Gate | **teilweise** | Proxy, `PROTECTED_SECTIONS`, `guards.test.ts`, `requireAdmin()` in allen Seiten und Actions erfüllt. Server-Action-POST als Nicht-Admin fehlte im E2E (QA ergänzt, wird abgelehnt). **Nicht erfüllt:** „blockierendes Rendern“ (F1); die geforderte Quelle zur Next-Option fehlt in ADR 014. |
| A2 `admin_access()` | **erfüllt** | invoker, nur `authenticated`, Meta-Allowlist; gesperrte und gelöschte Admins `has_role = false` |
| A3 Nonce-CSP für `/admin` | **teilweise** | Kanonische Pfade in Dev und Produktion mit Nonce und `strict-dynamic`, keine Verletzungen. Über kodierte Pfade gilt die feste CSP mit `'unsafe-inline'` (F1). |
| A4 Moderation nur über die RPC | **erfüllt** | Roh-UPDATE auf `active`/`rejected`/`draft`/`removed` → `42501` |
| A5 Keine Inhaltsänderung durch Moderatoren | **erfüllt** | auch an aktiven Anzeigen, `expires_at`, `owner_id`, Fotos, Wildarten; kein Löschen (QA-pgTAP). `listings_delete_admin` wurde schon in `review_medium` entfernt. |
| A6 `reject_code` durch alle Pfade | **erfüllt** | Constraints, Hash-Ausschluss, Audit-Bedingung auf Code, Trigger `listings_zz_moderation_fields` leert Grund außerhalb von Entwurf/abgelehnt/entfernt |
| A7 Hinweise für Admins | **erfüllt** | Zahl in der Warteschlange ohne N+1 (`admin_review_queue`) |
| A8 `submitted_at` | **erfüllt** | Trigger auf allen Pfaden, Index, Keyset |
| A9 `admin_find_user` | **erfüllt** | exakt, normalisiert, ohne eigenes/gesperrtes/unbestätigtes Konto, 30/h (QA-pgTAP), Audit ohne E-Mail; Suche per POST, E-Mail nie in der URL (E2E) |
| A10 Signierte URLs | **erfüllt** | Session des Admins, 600 s, kein `use cache`, Antworten `private, no-store` |
| A11 Gesperrte/gelöschte Admins | **erfüllt** | `is_admin`, `admin_access`, 403 im Browser geprüft |
| A12 Testplan | **teilweise** | pgTAP und Integration wie gefordert; fehlend: E2E „eigene Anzeige nicht entscheidbar“, E2E „letzter Admin“, B1 mit Foto (QA ergänzt). Der CHANGELOG nennt die Lücken ehrlich. |
| A13 Commit-Reihenfolge | **erfüllt** | E2E-Commit entfiel, Tests kamen mit 6–10 (im CHANGELOG vermerkt) |
| A14 Doku | **teilweise** | ADR 005/010/013, Cloud-Checkliste und Fehlervertrag vorhanden. ADR 014 und CHANGELOG beschreiben `instant = false` fälschlich als blockierendes Rendern (F1). |

Hinweise H1–H8: H1, H4, H7 und H8 umgesetzt bzw. dokumentiert. H2 und H3 (Re-Auth nach 12 h, zweiter Faktor) sind nicht umgesetzt (optional). Der Index aus H5 `(created_at desc, id desc)` fehlt, es gibt nur `audit_log_created_idx (created_at)`. Für den heutigen Umfang ist das unkritisch. H6 ist teilweise umgesetzt (F4).

### Definition of Done (CLAUDE.md)

| Punkt | Ergebnis |
|---|---|
| Build ohne Warnungen, Lint und Typecheck grün | erfüllt |
| Tests grün | erfüllt, auch `supabase test db` nach E2E ohne Reset |
| Neue Texte in 4 Sprachen | erfüllt. Die Schlüssel sind in allen 4 Dateien gleich, alle dynamischen Schlüssel (`errors.*`, `notices.*`, `reasons.*`, `decisions.*`, `actions.*`) sind vorhanden. Auf 5 Admin-Seiten in en/cs/pl erscheinen keine rohen Schlüssel, `lang` stimmt, bei 360 px gibt es keine Überbreite (QA-E2E). Mit en identisch sind nur „Admins“, „Details“ und „System“ (de/pl), das ist vertretbar. Die Begriffe stimmen mit `docs/GLOSSARY.md` überein (cs/pl ungeprüft, korrekt markiert). |
| Lücke Web/iOS im CHANGELOG | erfüllt (I4, Admin nur Web) |
| RLS für neue Tabellen, getestet | erfüllt: `private.admin_lookups` mit RLS und ohne API-Rechte (Schema `private`); neue RPCs in der Meta-Allowlist |
| CHANGELOG mit Testanleitung | erfüllt. Die Anleitung wurde nachvollzogen und funktioniert. Inhaltliche Abweichung: F1 („rendert blockierend“). |

### Sicherheitsprüfung (eigene Proben)

| Probe | Ergebnis |
|---|---|
| Nicht-Admin auf `/de/admin`, `/de/admin/`, `/de/./admin`, `/de/admin?x=1`, `/pl/admin/listings`, `/de/admin/foo`, `/de/admin/listings/<uuid>`, `/de/forbidden` | 403 (bzw. 308 auf `/de/admin`), `X-Robots-Tag: noindex`, `private, no-store` |
| Nicht-Admin auf `/de/%61dmin`, `/de/%61dmin/listings`, `/de/admi%6E/mfa` u. a. (Produktion) | **200** mit „Kein Zugriff“ und `<meta robots noindex>`, ohne `X-Robots-Tag`; keine Daten (F1) |
| Anonym auf `/de/%61dmin/listings` (Produktion) | **200**, Redirect zur Anmeldung nur im Stream (`NEXT_REDIRECT`) (F1) |
| Admin (aal2) auf `/de/%61dmin/listings/<id>` | volle Prüfansicht mit Version, CSP `script-src 'self' 'unsafe-inline'`, 13 Skripte ohne Nonce (F1) |
| Rollenentzug zwischen Proxy und Seite | nicht im Wettlauf ausgeführt. Die Proxy-Umgehung oben ist gleichwertig: die Seite liefert 200 mit „Kein Zugriff“, also die Hülle, die A1 verhindern sollte. |
| Server Action „Entscheidung“ als Nicht-Admin (echte Action-ID, gültige Version) | kanonisch 409 (Rewrite auf `/forbidden`, Action nicht ausgeführt), kodiert 404 mit „Kein Zugriff“; die Anzeige bleibt `pending_review` |
| Gesperrter bzw. gelöschter Admin | 403 auf allen Admin-Seiten; RPCs `42501` |
| aal1-Admin | nur `/admin/mfa`; alle Admin-RPCs `42501`, Warteschlange leer, Version `null` |
| Roh-UPDATE, Kinder-Tabellen, Löschen, Audit fälschen (aal2-Admin) | alles abgelehnt (QA-pgTAP) |
| Definer-Pfade | öffentliche Definer-Funktionen für `authenticated`: `accept_legal`, `admin_*`, `grant/revoke_admin`, `legal_status`, `listing_content_hints`, `register_device`. Keine davon schreibt in `listings`; der Kinder-Guard schreibt nur für Besitzer. |
| Selbst-Moderation | RPC `42501`, Warteschlange ohne eigene Anzeigen, Version `null` |
| Ernennen: Step-up, Karenz (6 Tage 23 Stunden), Gesamtlimit, letzter aktiver Admin (anderer gesperrt), unbestätigtes Konto | wie spezifiziert (QA-pgTAP) |
| TOTP-Faktoren-Flut | GET erzeugt keinen Faktor; wiederholtes POST lässt höchstens einen unbestätigten Faktor stehen (auch ohne JS geprüft) |
| Secret-Leak | Das Secret steht nur in der POST-Antwort (`no-store`). Ohne JS steht es unsichtbar im Flight-Payload derselben Antwort (F2). |
| XSS in Titel (`<script>`) in Warteschlange/Prüfansicht | escaped |

### Gefundene Fehler

#### F1 – hoch – Zweite Schicht hinter dem Proxy greift nicht: 200 statt 403, Nonce-CSP per kodiertem Pfad umgehbar
Die Admin-Seiten rendern nicht blockierend. `export const instant = false` ist in Next 16 eine Prefetch-Option (`build/segment-config/app/app-segment-config.js`: „How this segment should be prefetched“). Alle Admin-Antworten tragen `x-nextjs-postponed: 1`. Der Status 200 ist also gesendet, bevor `requireAdmin()` `forbidden()` oder `redirect()` aufruft. Den 403 liefert heute nur der Proxy. Dessen Regex prüft den rohen Pfad, `next-intl` dekodiert ihn aber und schreibt `/de/%61dmin` intern auf `/de/admin` um (`x-middleware-rewrite: /de/admin`). Folgen:
- Nicht-Admin und anonym bekommen im Produktions-Build 200 („Kein Zugriff“ bzw. Redirect erst im Stream). Daten fließen keine ab, die Autorisierung im Gate hält.
- Ein Admin auf einem kodierten Pfad bekommt die feste CSP mit `'unsafe-inline'` statt der Nonce-CSP, ohne `X-Robots-Tag` (das Meta-`noindex` bleibt). Ein Link in einer Nachricht oder Mail reicht, damit die Admin-Seiten, die UGC zeigen, ohne die Schutzschicht aus A3 laufen.
- Dasselbe gilt für den Fall „Rolle zwischen Proxy und Seite entzogen“, den A1 ausdrücklich ausschließen sollte.
- ADR 014 und CHANGELOG („rendert blockierend“) sind in diesem Punkt falsch, die in A1 geforderte Quelle fehlt.

Reproduktion:
1. `npm run build && npx next start -p 3456`, als Nicht-Admin angemeldet: `curl -s -o /dev/null -w '%{http_code}' -H 'Cookie: <sb-…-auth-token>' http://localhost:3456/de/%61dmin` → `200`, Body enthält „Kein Zugriff“.
2. Als aal2-Admin `curl -sD - …/de/%61dmin/listings/<id>` → `Content-Security-Policy: … script-src 'self' 'unsafe-inline'`, Inhalt der Prüfansicht.
3. `QA_BASE_URL=http://localhost:3456 npx playwright test e2e/qa-m4.spec.ts -g "kodierter"` (3 Tests als `test.fail`; im Dev-Server ist nur der CSP-Test rot, weil `next dev` nicht vorrendert).

Vorschlag:
- Im Proxy den Pfad vor dem Abgleich normalisieren (`decodeURIComponent` je Segment, Fehler → 400), oder Admin-Erkennung und CSP auf den von `next-intl` umgeschriebenen Pfad stützen. Besser zusätzlich: die Nonce-CSP für `/admin` als Standard setzen, sobald der dekodierte Pfad passt, und kodierte Varianten von `/admin` per Redirect auf den kanonischen Pfad schicken.
- Für den echten 403 der Seite: den Zugriff vor dem ersten Byte entscheiden, z. B. in einem `layout.tsx` unter `/admin`, das ohne Suspense-Grenze vor der Hülle prüft (mit `cacheComponents` ggf. `connection()`/dynamische Hülle), oder auf den Proxy als einzige Status-Quelle setzen und das ADR korrigieren. Danach die `test.fail` in `qa-m4.spec.ts` entfernen.
- ADR 014 und CHANGELOG korrigieren (Quelle zur Option angeben).

#### F2 – mittel – TOTP-Einrichtung geht ohne JavaScript nicht
Plan 4.1 verlangt: „die Einrichtung selbst braucht kein Client-JS“. `EnrollTotp` nutzt `useActionState` in einer Client-Komponente. Ohne JS läuft die Action zwar (POST 200, ein unbestätigter Faktor entsteht), die Seite zeigt danach aber wieder nur „Authenticator einrichten“, ohne QR-Code und ohne Schlüssel. Das Secret steht dabei unsichtbar im Flight-Payload der Antwort (`no-store`, also kein Cache-Leck). Die Code-Eingabe für einen bestehenden Faktor funktioniert ohne JS, die Entscheidung über Anzeigen ebenfalls (QA-E2E).
Nebenbefund (UX): Ein falscher Code bei der Ersteinrichtung verwirft den Faktor. Der Admin muss einen neuen QR-Code scannen, der alte Eintrag in der App ist dann ungültig. Das E2E dokumentiert das so, eine Meldung („bitte den alten Eintrag löschen“) fehlt.
Reproduktion: `npx playwright test e2e/qa-m4.spec.ts -g "TOTP-Einrichtung per POST ohne JavaScript"` (`test.fail`).
Vorschlag: Die Einrichtung als Server-Action mit Redirect auf eine Seite bauen, die das Secret serverseitig aus dem unbestätigten Faktor liest. Supabase liefert das Secret nur beim `enroll`, deshalb alternativ: im selben POST rendern, statt `useActionState` zu verwenden. Oder die Einschränkung im CHANGELOG nennen und `<noscript>` ergänzen. Bei falschem Code den Faktor behalten und nur die Code-Eingabe wiederholen.

#### F3 – niedrig – Ernennung per Nutzer-ID über `?candidate=` ohne Kontosuche
`findAdminCandidate` leitet auf `/admin/admins?candidate=<uuid>`. Die Seite lädt jedes Profil per ID (`candidateProfile`, RLS `profiles_select_admin`) und zeigt das Ernennungsformular. Ein Admin kann so eine beliebige ID ernennen, z. B. aus dem Audit-Log (die Links dort enthalten die volle `target_id`), ohne die Suche per E-Mail. Damit entfallen Rate-Limit und `user.looked_up`-Eintrag der Suche. Das Review (10.1.3, A9) schließt die Ernennung per ID ausdrücklich aus. Step-up, Limits und das Audit der Ernennung greifen weiter. Das Formular erscheint auch für gesperrte oder unbestätigte Konten, die RPC lehnt dann mit „nicht gefunden“ ab.
Reproduktion: als aal2-Admin `/de/admin/admins?candidate=<user-id eines Inserenten>` öffnen → „<Name>, Mitglied seit …“ mit Formular „Zum Admin ernennen“.
Vorschlag: Den Kandidaten nach der Suche nicht in der URL führen. Stattdessen ein kurzlebiges, signiertes Token (HMAC über `user_id`, Admin und Zeit) oder ein Cookie mit `no-store` verwenden, oder die Suche und die Bestätigung in einem POST erledigen. `grant_admin` könnte zusätzlich einen `user.looked_up`-Eintrag desselben Admins aus der letzten Stunde verlangen.

#### F4 – niedrig – Prüfansicht zeigt fremde Entwürfe (H6 teilweise)
`getListingForReview` lädt mit `loadListing(id, null)` jede Anzeige, die RLS dem Admin zeigt, auch fremde Entwürfe (inklusive PLZ, Beschreibung und Attribute, serverseitig). Für Anzeigen außerhalb der Prüfung rendert die Seite Titel und Status („QA geheimer Entwurf“). `admin_listing_version` liefert auch für fremde Entwürfe einen Hash, `listing_content_hints` die Treffer. Moderierbar sind Entwürfe nicht (`RV003`), Daten über die Zeile hinaus zeigt die Seite nicht. Der Kommentar im Service („keine fremden Entwürfe, H6“) trifft aber nicht zu.
Reproduktion: als aal2-Admin `/de/admin/listings/<id eines fremden Entwurfs>` → Überschrift mit dem Entwurfstitel. pgTAP `24_qa_m4_abnahme` TODO 22, E2E „Prüfansicht zeigt keine fremden Entwürfe“ (`test.fail`).
Vorschlag: in `getListingForReview` zuerst nur `status` lesen und außerhalb von `pending_review` (bzw. bei Entwürfen) `notFound()`; `listing_review_version` und `listing_content_hints` für Admins auf `status = 'pending_review'` beschränken. Mittelfristig `listings_select_admin` auf Nicht-Entwürfe einschränken (M9-Meldungen prüfen).

#### F5 – niedrig – `private.admin_lookups` wird nie bereinigt und überlebt die Kontolöschung
Die Tabelle hat keinen Fremdschlüssel auf `auth.users` und keinen Aufräumjob. Nach jedem Lauf von Integration und `admin.spec.ts` bleiben Zeilen gelöschter Testkonten stehen (lokal 7 nach zwei Läufen). Für M9 („Gelöschter Account verschwindet aus allen Tabellen“) und die Datensparsamkeit fehlt eine Regel. Die Zeilen enthalten Akteur und Zeitpunkt, keine E-Mail.
Reproduktion: `npm run test:e2e`, dann `select count(*) from private.admin_lookups l where not exists (select 1 from auth.users u where u.id = l.actor_id)` → > 0.
Vorschlag: `actor_id references auth.users on delete cascade` und eine Bereinigung älter als 1 Stunde (oder bei jedem Aufruf `delete … where created_at < now() - interval '1 hour'`). E2E-Cleanup um die Tabelle ergänzen.

#### F6 – niedrig – Kleinere Unstimmigkeiten in der Admin-Oberfläche
- Übersicht und Warteschlange zählen verschieden: `countPendingListings` zählt alle `pending_review` inklusive der eigenen, die Warteschlange zeigt eigene Anzeigen nicht. Ein Admin mit eigener Anzeige sieht „1 Anzeige zur Freigabe“ und eine leere Warteschlange.
- Der Regeltext und `errors.waiting` nennen 7 Tage, 3 und 10 fest. Die Werte stehen aber in `private.app_settings` und können abweichen.
- Audit-Details zeigen Schlüssel und Werte roh (`from`, `code`, `reason`, `pending_review`, `contact_in_text`). Die Codes sind nicht in der Sprache des Admins.
- `/admin/admins`: Alle Code-Felder zum Entziehen heißen gleich („Aktueller Code aus deiner Authenticator-App“). Der Name des Admins steht nur am Button.
- Das Fehlerfeld der Entscheidung (`role=alert`) ist nicht per `aria-describedby` mit dem Feld verbunden; `aria-invalid` ist gesetzt.

Vorschlag: Zähler aus `admin_review_queue` bzw. mit `owner_id <> auth.uid()`, Werte per RPC an die Oberfläche geben, Audit-Codes über `Moderation.reasons`/`Listings.status` übersetzen, Feldnamen eindeutig machen.

### Hinweise (keine M4-Fehler)
- `e2e/auth.spec.ts` räumt nicht auf: Nach jedem Lauf bleiben 4 Konten (`register-…`, `code-…`, `redirect-…`, `refresh-…@test.local`). pgTAP bleibt grün, die Konten sammeln sich aber an.
- Die E2E-CSP-Prüfung in `admin.spec.ts` deckt nur `/de/admin` ab. `qa-m4.spec.ts` prüft zusätzlich die Prüfansicht (Header).
- Gleichzeitiges Entziehen durch zwei Admins ist weiter nur per Code-Review abgesichert (Advisory-Lock vor dem Zählen, korrekt).

### Nicht prüfbar
- E-Mail in Server-Logs der Cloud (PostgREST/Postgres-Logparameter): Lokal steht die Adresse nur im POST-Body. Das Logging der Cloud ist nicht einsehbar.
- Supabase-Rate-Limits für MFA-Verifizierungen in der Cloud (H1), Access Token Hook und Session-Timeouts (Cloud-Checkliste).
- iOS (Grund ab I4), Gleichstand Web/iOS, App-Store-Pflichten: Es gibt noch keine App.
- Muttersprachliche Prüfung cs/pl.

### Neue Tests
- `supabase/tests/24_qa_m4_abnahme.test.sql` (35, davon 1 TODO für F4). Läuft in einer Transaktion mit Rollback und entfernt fremde Admin-Rollen nur innerhalb der Transaktion, damit Reste anderer Läufe nicht stören.
  - B1: neues Foto, Alt-Text, „Bearbeitung anfordern“ mit altem Stand, Version `null`/leer
  - A4/A5: Roh-UPDATE auf `removed`, Umschreiben aktiver Anzeigen, `expires_at`, `owner_id`, Löschen, fremde Fotos und Wildarten
  - Audit: nicht lösch-, änder- oder fälschbar; Akteur bei der Freigabe
  - H6: Entwurf nicht moderierbar, nicht in der Warteschlange
  - A11: gelöschter und gesperrter Admin (`is_admin`, `admin_access`, Moderation, Ernennen, Suche)
  - B2/A9: letzter aktiver Admin, Selbstentzug, Karenz knapp unter 7 Tagen, Gesamtlimit, unbestätigtes Konto, Such-Limit 30/h
- `web/e2e/qa-m4.spec.ts` (11). Die Konten entstehen per Magic-Link-Token in Node und werden in `afterAll` samt Audit-Zeilen gelöscht. Gegen den Produktions-Build lauffähig (`QA_BASE_URL`). Bekannte Fehler stehen als `test.fail`, bei F1 nur im Produktions-Build bzw. in CI.
  - kodierte Pfade: Status als Nicht-Admin/anonym (F1), CSP und `X-Robots-Tag` als Admin (F1)
  - Server-Action-POST als Nicht-Admin, kanonisch und kodiert (A1, besteht)
  - fremder Entwurf in der Prüfansicht (F4)
  - ohne JS: TOTP-Einrichtung (F2), Entscheidung mit Fehler und Erfolg (besteht)
  - Tastatur-Entscheidung; en/cs/pl auf 5 Seiten: übersetzt, `lang`, `noindex`, 360 px

### Empfehlung
M4 ist **mit Auflagen abnahmereif**. Alle drei Akzeptanzkriterien sind auf den kanonischen Wegen erfüllt. Moderation, Versionsvergleich, Selbst-Moderation, Ernennung und Audit halten allen Angriffen auf DB- und API-Ebene stand.
- Vor M5: **F1** beheben. M5 bringt öffentliche Seiten mit denselben Render-Mustern, und `noindex`/Status für nicht freigegebene Anzeigen hängen dort an derselben Mechanik. ADR 014 und CHANGELOG korrigieren.
- Bald: **F2** (beheben oder als Lücke im CHANGELOG führen), **F3**.
- Bei Gelegenheit bzw. mit M9: F4, F5, F6.

## M5 – Abnahme 2026-11-01

Geprüfter Stand: `e81f912` (main, Arbeitsbaum sauber). Geprüft wurden die M5-Commits `95da5e2` bis `e81f912` (14 Commits laut Plan 11). Umgebung: macOS, Node 24.22.1, Next.js 16.4 (`cacheComponents`), Supabase CLI 2.122.0 (lokal), Chromium headless (Playwright). Produktions-Build per `npm run build && npx next start -p 3456`.
Grundlage: SPEC v0.7 (3.3, 3.4, 4.2, 4.3, 6 M5, 8), Plan M5 mit Architekt-Review (10: B1–B3, A1–A15, H1–H10) und „Eingearbeitet“ (11, Nutzer-Ergänzungen), ADR 015, CHANGELOG „M5“, CLAUDE.md. iOS (I2) ist laut Plan nicht Teil von M5 (Lücke im CHANGELOG vermerkt).

### Prüfläufe

| Prüfung | Ergebnis |
|---|---|
| `supabase db reset && supabase test db` | grün, 28 Dateien, **641** Tests. Mit der neuen QA-Datei 29 Dateien und **676** Tests, davon 6 TODO (F1, F2, F4, F7). |
| `supabase test db` ohne Reset direkt nach allen E2E-Läufen | grün (676). Keine `@test.local`-Konten übrig. |
| `npm run lint`, `npm run typecheck` | grün, auch mit den neuen QA-Dateien |
| `npm test` (Vitest) | **345/345**; mit `lib/qa-m5.test.ts` **394/394** |
| `npm run test:integration` | **160/160** |
| `npm run test:e2e` (Dev-Server) | **52/52**; mit `qa-m5.spec.ts` **79/79** (davon 7 erwartete Fehlschläge per `test.fail`: F1, F2, F3, F4, F5, F6, F9) |
| `qa-m5.spec.ts` gegen den Produktions-Build (`QA_BASE_URL=http://localhost:3456`) | **27/27** (davon 8 erwartete Fehlschläge: zusätzlich F8, das nur im Produktions-Build auftritt) |
| `public.spec.ts` gegen den Produktions-Build (eigene Playwright-Konfiguration mit `baseURL` 3456) | Status, hreflang, Detail, Anbieter, ohne JS, 410 und „Sofortige Wirkung“ (3 Fälle): **9/9**. „Akzeptanz c“ scheitert dort an der Sitemap-Erwartung, weil die Sitemap des laufenden Servers bis zu 1 h gecacht ist (F11). Die Tests mit Login setzen das Cookie fest für Port 3000 und laufen nur gegen den Dev-Server. |
| `npm run build` | grün, ohne Warnungen. Öffentliche Seiten sind ◐ (Partial Prerender), Startseite, Konto und Admin ƒ, `robots.txt` ○ (statisch, siehe F10). |
| Cache-Messung im Produktions-Build | Pausierte Anzeige (normale Änderung): Detail sofort 410, aus Start- und Kategorieseite nach **≈ 65 s** verschwunden (Profil `publicListings`, `revalidate` 60). Entfernen, Sperren, Löschen: sofort (E2E). |

### Ergebnis je Akzeptanzkriterium

| # | Kriterium (SPEC 6 M5, Plan 0, Plan 11) | Ergebnis | Nachweis |
|---|---|---|---|
| a | Filtern nach Land/Region/Art/Preis liefert korrekte Ergebnisse | **erfüllt** | pgTAP `26` (jeder Filter einzeln und kombiniert, Bundesland schließt Kreise ein, Preis nur in der Währung), Integration mit gemeinsamer Fixture, E2E „Akzeptanz a“. QA: Pfadwerte gehen vor Query, ungültige Werte fallen weg (Vitest). Einschränkungen: Suchtext ab sechs Wörtern ergibt „Filter ungültig“ (F2); „auf Anfrage“ mit Währung (nur über API/iOS möglich) erscheint im Währungsfilter (F7). |
| b | Preise in Originalwährung mit passender Locale | **erfüllt** | E2E „Akzeptanz b“ (de/en/cs/pl × EUR/CZK gegen `Intl` derselben Laufzeit). QA ergänzt die volle Matrix 4 Locales × EUR/CHF/CZK/PLN, ganze Beträge und Cent-Beträge, Einheit im selben Text (Vitest). Keine Umrechnung, auch nicht im Filter. |
| c | Nicht freigegebene Anzeigen sind weder abrufbar noch indexierbar | **erfüllt** | Entwurf, Prüfung, abgelehnt: 404 mit `X-Robots-Tag: noindex`, auch für den eingeloggten Besitzer; nicht in Sitemap, Suche, Such-RPC (anon, Besitzer, Admin aal2, `service_role`), Regionszähler, Anbieterliste; Foto-Route 404. QA: RSC-Anfrage (`RSC: 1`, ohne Statusprüfung im Proxy) liefert keinen Inhalt; `listing_places` für anon und Fremde nicht lesbar. Dev und Produktions-Build. |
| – | Nutzer-Ergänzung: Entfernen, Sperren, Konto-Löschung wirken sofort | **erfüllt** | E2E „Sofortige Wirkung“ (Kategorie, Start, Detail, Foto) auf Dev und Produktion. QA ergänzt: Anbieterseite 410, Textsuche (ungecacht), Favoriten zählen die Anzeige sofort als „nicht mehr verfügbar“. Ausnahme Sitemap (F11, laut ADR bewusst `hours`). |
| – | Nutzer-Ergänzung: normale Änderungen nach höchstens 5 min | **erfüllt** | gemessen ≈ 65 s im Produktions-Build; Detail und Profil sofort über den Proxy |
| – | Umfang M5: Startseite, Kategorie-/Regionsseiten, Volltext, Filter, Detail, Favoriten, Meta-Tags, hreflang, Sitemap, strukturierte Daten | **erfüllt mit Funden** | Volltext F1/F2, Favoriten F3/F4/F9, hreflang F6, Sitemap F10/F11, Layout F5 |

### Architekt-Auflagen (Plan 10)

| Auflage | Status | Bemerkung |
|---|---|---|
| B1 Sichtbarkeit nicht nur über RLS | **erfüllt** | `private.listing_is_public` in Policy, `public_profiles`, allen RPCs, Regionszähler; die Sitemap liest als anon dieselbe Menge (QA-pgTAP: Tabellenzugriff = Suche). Unverarbeitete Fotos sind nie Thumbnail. |
| B2 Ein Pfad-Parser | **erfüllt** | Proxy, Seiten, Sprachumschalter (auch ohne JS im HTML), hreflang, Sitemap, `safeNextPath`. Großschreibung → 404, nicht kanonische Kodierung und abschließender Schrägstrich → 308, Fremdsprachwort, überzählige Segmente, Kreis aus anderem Bundesland → 404. Kollisionstest liest `app/[locale]` aus dem Dateisystem. Slugs aus `reference-data.json` mit Integrationsabgleich. Rest: Unterpfade statischer Seiten (F8). |
| B3 Cache-Lebensdauer als Garantie | **erfüllt** | Profil `publicListings` 60/60/300, Tags per `updateTag` in Moderation, Absenden, Zurückziehen, Pausieren, Fortsetzen, Löschen, Bearbeiten, Fotoaktionen; kein Personenbezug in `use cache` (QA-E2E: anonyme Seiten nach Login in anderem Kontext ohne Session-Inhalt, Dokumente `private, no-store`). Zusätzlich Cache-Zähler (Nutzer-Ergänzung). |
| A1 Such-Vertrag | **teilweise** | `v: 1`, unbekannte Schlüssel, Region passt zum Land, Preis-Sortierung mit Währung und Einheit, Standard `newest`, `id` als letzter Schlüssel, Grenzen, Fehlertabelle: erfüllt. Cursor an Filter und Sortierung gebunden, Typ- und Längenprüfung erfüllt (QA: gefälschter Hash, Überlauf, keine UUID → 22023). **Nicht erfüllt:** „Rang als float8-Text verlustfrei“ – unter `extra_float_digits = 0` (Supabase-Standard) wird der Rang gerundet, das Relevanz-Paging wiederholt Treffer (F1). |
| A2 Missbrauch der Such-RPC | **teilweise** | Zählung bis 1001, `event_date` nur mit `kind`, kein `use cache` für freie Filter, Messung mit 10.000 Anzeigen, Cloud-Checkliste (Timeout anon lokal 3 s, Rate-Limit). Die Grenze `numnode ≤ 32` gilt für den verknüpften tsquery aus drei Konfigurationen und trifft schon normale Suchtexte mit sechs Wörtern (F2). |
| A3 Statusprüfung im Proxy | **erfüllt** | nur Dokumentanfragen, Parser vor DB, ungecacht, 800 ms, fail-open, 404/410 mit `noindex`, Session über `session.apply`. 410 kommt als eigene HTML-Seite des Proxys (begründet in ADR 015). |
| A4 Nur ein Zustand `gone` | **erfüllt** | auch für gesperrte und als gelöscht markierte Besitzer (QA-pgTAP), Text „nicht mehr verfügbar“, kein „entfernt“ |
| A5 Foto-Route | **erfüllt** | UUID und Variante vor DB, `processed_at`, gestreamt, `image/jpeg`, `nosniff`, `inline`, `Content-Length`; 200 `public, no-cache` + ETag/304 (Nutzer-Ergänzung statt `max-age=300`), 404 `public, max-age=60`, 5xx `no-store`; keine Storage-Pfade im HTML (QA geprüft auf Detail, Listen, Profil, Sitemap); Open Graph absolut auf `full`. |
| A6 `published_at`/`approved_at` | **erfüllt** | pgTAP `25` |
| A7 Kategorie-/Regionsseiten | **teilweise** | Aggregat-RPC, Links nur auf Regionen mit Anzeigen, Query-Seiten `noindex, follow` ohne Canonical/hreflang, Titel ohne Kasus („Pronájem honitby – Bavorsko“). **Abweichung:** leere Seiten sind `noindex`, tragen aber Canonical und hreflang (F6). |
| A8 Sitemap und robots | **teilweise** | `/sitemap/{locale}.xml` außerhalb von next-intl, zur Anfrage erzeugt, absolute URLs mit `alternates`, ohne Suche/Konto/Admin/private Profile/Unveröffentlichtes (QA). **Abweichung:** `SITE_INDEXABLE` wirkt nur zur Build-Zeit (F10). |
| A9 `safeNextPath` und Merken | **erfüllt** | QA-Vitest mit 15 Umgehungsversuchen (`//`, `/\`, `%2f`, Punktsegmente, `@`, Tab, Großschreibung, Fremdsprachwort, unbekannter Slug, verschachteltes `next`, absolute URL): alle auf das Konto oder ein bereinigtes Ziel derselben Origin. Kein Merken per GET nach dem Login (QA-E2E mit Bestätigungslink). Nebenbefund F9 (q im Login-Link). |
| A10 Favoriten | **teilweise** | Limit mit Advisory-Lock und `23514`, `aria-pressed`, feste Breite, auf der eigenen Anzeige weder Merken noch Kontakt (Oberfläche). **Fehler:** „nicht mehr verfügbare entfernen“ löscht ab etwa 220 Favoriten alle (F3); die eigene Anzeige lässt sich per POST merken (F4). |
| A11 Öffentliche Service-Schicht | **erfüllt** | Anon-Client, feste Spalten, Test `public-boundary`, Beschreibung als Text ohne Autolinks (QA: `https://…` im Text bleibt Text) |
| A12 Barrierefreiheit | **teilweise** | `fieldset`/`legend`, `aria-describedby`, `aria-live`, Galerie-Links mit Fokus, „verifiziert“ als Text, Brotkrumen-`nav` mit `aria-current`, Umschalter mit `lang`/`hrefLang`, 410-Seite mit H1 und Link; axe ohne schwere Verstöße auf Start, Kategorie, Kreis, Suche mit Filtern, Detail (de/en/pl), Anbieter, Favoriten, 410. **Nicht umgesetzt:** „Weitere laden“ mit Fokus auf den ersten neuen Treffer – es gibt Seitenlinks mit vollem Seitenwechsel, die Live-Region wirkt dabei nicht. Überbreite bei langen Wörtern (F5). |
| A13 Preisformat | **teilweise** | nur serverseitig; Projekt-Tests decken die Matrix nur teilweise ab (Vitest 3 Fälle, E2E EUR/CZK). QA-Vitest ergänzt 16 Kombinationen, alle korrekt. |
| A14 Commit-Reihenfolge | **erfüllt** | 14 Commits wie in Plan 11 |
| A15 Doku | **erfüllt** | ADR 015, ADR 003 (Matcher, Slugs), SPEC v0.7, Glossar (URL-Wörter, cs/pl ungeprüft markiert), CHANGELOG mit Lücken und Messung. Inhaltliche Abweichungen: F10 („Server-Variable“), A1 („verlustfrei“, F1). |

Hinweise H1–H10: H1, H3 (x-default bleibt `de`), H4, H5, H7 dokumentiert bzw. bewusst offen. H2 in ADR 015 „Folgen“. H6 umgesetzt (`X-Robots-Tag` für Suche, Query-Listen, 404/410; private Profile und leere Seiten nur per Meta). H8 nicht umgesetzt (optional). H9 umgesetzt (Text, kein Link). H10 teilweise (F9).

### Definition of Done (CLAUDE.md)

| Punkt | Ergebnis |
|---|---|
| Build ohne Warnungen, Lint und Typecheck grün | erfüllt |
| Tests grün | erfüllt, auch `supabase test db` nach E2E ohne Reset |
| Neue Texte in 4 Sprachen | erfüllt. `Public` (73 Schlüssel), `Favorites` (12), `LocaleSwitcher`: in allen 4 Dateien vollständig, keine Werte unverändert aus en (außer den Sprachnamen). Auf Start, Kategorie, Kreis, Suche, Detail, Anbieter und 410 in de/en/cs/pl keine rohen Schlüssel, `lang` stimmt, 360 px ohne Überbreite mit üblichen Titeln (QA-E2E). Glossar abgestimmt, cs/pl ungeprüft markiert. |
| Lücke Web/iOS im CHANGELOG | erfüllt (I2) |
| RLS für neue Tabellen, getestet | erfüllt: `private.public_cache_epoch` mit RLS, ohne API-Rechte (Schema `private`), Zugriff nur über die Definer-Funktion; neue RPCs in der Meta-Allowlist |
| CHANGELOG mit Testanleitung | erfüllt. Die Anleitung funktioniert; das Beispiel `/de/jagdpacht/bayern/rosenheim` aus Plan/ADR gibt es nicht (Slugs `rosenheim-landkreis`, `rosenheim-stadt`). |

### Sicherheitsprüfung (eigene Proben)

| Probe | Ergebnis |
|---|---|
| Unveröffentlichte Anzeigen über Seite, Such-RPC (anon, Besitzer, fremder Nutzer, Admin aal2, `service_role`), Sitemap, Foto-Route, JSON-LD, Open Graph, RSC-Anfrage | kein Leck |
| PLZ, Ortsname, Storage-Pfad in Detail (de/pl), Suche, Kreisseite, Start, Anbieter, Sitemap, Such-RPC | nicht enthalten; nur „PLZ-Bereich 80…“. Ort und PLZ sind auch kein Suchkriterium (QA-pgTAP). |
| Orakel `public_page_state` / `provider_listings` | nie veröffentlicht → `null`, auch für den Besitzer; einmal öffentlich → `gone` ohne Grund; Anbieter ohne je öffentliche Anzeige → 404; `favorites`-Insert auf fremde Entwürfe → `42501` |
| UGC-XSS: Titel `</script><script>alert()</script> & <img onerror>`, U+2028, Beschreibung mit Skript und URL, Firmenname mit `<b>` | keine Ausführung (Detail de/en, Suche, Anbieter), JSON-LD parsebar und wortgleich, `<title>` und `og:*` escaped, keine Autolinks |
| Open Redirect über `safeNextPath` mit öffentlichen Pfaden | 15 Umgehungsversuche abgewiesen (QA-Vitest) |
| Cursor-Manipulation | gefälschter Hash (md5 der Filter ist berechenbar) mit ungültigem Schlüssel, Zahlenüberlauf, ohne UUID, > 200 Zeichen → `22023`; gültiger gefälschter Cursor verschiebt nur die Seite |
| Teure Filter | Filter ≤ 4 KB, `species` ≤ 20, tsquery ≤ 32 Knoten, Zählung ≤ 1001, Limit ≤ 50, `statement_timeout` anon 3 s lokal |
| Cache-Leck | anonym gerenderte Start-, Kategorie-, Kreis-, Detail-, Anbieter- und Suchseite nach Login und Merken in einem anderen Kontext ohne Name, „Abmelden“ oder `aria-pressed="true"` |
| Merken per GET, Prefetch | nicht möglich; nach Login kein Favorit ohne POST |
| Manipulierter POST „Merken“ | fremde Entwürfe abgewiesen; eigene Anzeige wird gespeichert (F4) |
| Statuscodes (Dev und Produktion) | siehe E2E „Statuscodes“; zusätzlich `/DE/…` → 307 (next-intl), `/de/anzeige/..%2f..%2fadmin` → 308 auf `/admin`, `/de/anzeige/<id>%00` → 308, `/sitemap.xml` 404 (kein Index, robots nennt die vier Dateien) |

### Gefundene Fehler

#### F1 – hoch – Relevanz-Paging wiederholt Treffer endlos (Rang im Cursor gerundet)
`search_listings` legt den Sortierschlüssel bei `sort = relevance` als `ts_rank(...)::float8::text` in den Cursor. Supabase setzt `extra_float_digits = 0` (lokal für alle Sitzungen, auch über PostgREST). Damit wird der float8-Wert auf 15 Stellen gerundet (`0.454819530248642` statt `0.45481953024864197`), A1 („seit PG 12 verlustfrei“) gilt nur für `extra_float_digits ≥ 1`. Ist der gerundete Wert größer als der echte Rang, erfüllt der letzte Treffer der Seite die Bedingung `(rank, id) < (k, i)` wieder, und die nächste Seite beginnt mit ihm. Bei gleichen Rängen (gleiche Texte, Vorlagen, Duplikate) liefert jede Folgeseite dieselben Treffer. „Nächste Seite“ kommt nie weiter. Der Vertrag gilt unverändert für iOS (I2) und M8.
Reproduktion:
1. Drei aktive Anzeigen mit gleichem Titel und Text anlegen, als anon `search_listings('{"v":1,"q":"Gleichstand Keiler","sort":"relevance"}', null, 1)` aufrufen, dann mit dem `next_cursor` erneut: dieselbe ID, beliebig oft.
2. Web: `/de/suche?q=<Text>&sort=relevance` mit mehr als 20 Treffern, „Nächste Seite“ → dieselben 20 Treffer.
3. pgTAP `28_qa_m5_abnahme` (2 TODO), E2E `qa-m5.spec.ts -g "Relevanz"` (`test.fail`).

Vorschlag: In beiden Such-RPCs `set extra_float_digits = 3` als Funktionsattribut (`alter function … set extra_float_digits = 3`), oder den Rang exakt kodieren (z. B. `float4send` als Hex), oder einen ganzzahligen Schlüssel wie `round(rank * 1e6)::bigint` in Sortierung und Cursor verwenden. Test mit gleichen Rängen und mit einem Rang, der beim Runden aufrundet.

#### F2 – mittel – Suchtexte ab sechs Wörtern ergeben „Die Filter sind ungültig“
Die Grenze `numnode ≤ 32` (Review A2) prüft den mit ODER verknüpften tsquery aus drei Konfigurationen. Jedes Wort zählt bis zu dreimal plus die Operatoren. Fünf Wörter ergeben etwa 29 Knoten, sechs schon 35 („Begehungsschein Rotwild Schwarzwild Bayern Landkreis Rosenheim“), ein natürlicher Satz mit sieben Wörtern 39. Die RPC antwortet mit `22023` (`hint = q`), die Seite zeigt „Die Filter sind ungültig. Bitte prüfe deine Eingaben.“ und keine Treffer. Zod im Web kennt die Grenze nicht, der Nutzer kann den Fehler nicht zuordnen. Das Feld erlaubt 200 Zeichen.
Reproduktion: `/de/suche?q=Begehungsschein+Rotwild+Schwarzwild+Bayern+Landkreis+Rosenheim` → Alert, 0 Treffer. pgTAP `28` (TODO), E2E `-g "sechs Wörtern"` (`test.fail`).
Vorschlag: Die Grenze je Konfiguration prüfen (z. B. ≤ 32 je tsquery, also ≤ 100 gesamt) oder die Anzahl der Wörter begrenzen (z. B. 16) und das in Zod und der Fixture gleich festhalten. Bei Überschreitung im Web einen eigenen Text („Suchbegriff zu lang“) statt „Filter ungültig“.

#### F3 – hoch – Ab etwa 220 Favoriten gelten alle als „nicht mehr verfügbar“, „Entfernen“ löscht alle
`favoritesOverview` prüft die Verfügbarkeit mit `anonClient().from("listings").select("id").in("id", ids)`. Das wird ein GET mit allen IDs im Query-String. Ab etwa 220 IDs (≈ 8 KB) antwortet das API-Gateway mit **414 URI Too Long** (lokal geprüft: 200 IDs → 200, 250 → 414). Der Fehler wird nicht ausgewertet, `visible` ist `null`, also gilt jede gemerkte Anzeige als nicht verfügbar. Die Seite zeigt keine Favoriten, sondern „230 gemerkte Anzeigen sind nicht mehr verfügbar“. Der Button „Nicht mehr verfügbare entfernen“ bestimmt die Menge neu, mit demselben Fehler, und löscht **alle** Favoriten, auch die verfügbaren. Das Limit erlaubt 500. Daneben lädt die Seite jede verfügbare Anzeige einzeln (`getPublicListing` mit vier Abfragen und Profil), bei 500 Favoriten also über 2.000 Abfragen pro Aufruf.
Reproduktion:
1. Für ein Konto 230 Favoriten auf öffentliche Anzeigen anlegen (z. B. per `service_role`).
2. `/de/account/favorites` öffnen → keine Liste, Hinweis „230 … nicht mehr verfügbar“.
3. „Nicht mehr verfügbare entfernen“ → `select count(*) from favorites where user_id = …` ergibt 0.
4. E2E `qa-m5.spec.ts -g "230 Favoriten"` (`test.fail`).

Vorschlag: Fehler der Verfügbarkeitsabfrage nie als „nicht verfügbar“ werten (bei Fehler nichts entfernen und den Fehlerzustand zeigen). Die Abfrage per RPC mit `uuid[]` im POST-Body oder in Blöcken zu 100 IDs; besser eine RPC `my_favorites(p_cursor)`, die Favoriten mit `listing_card` und einem Flag `available` in einer Abfrage liefert und blättert. `removeUnavailableFavorites` serverseitig in einer Anweisung (`delete … where not listing_is_public(...)`).

#### F4 – niedrig – Die eigene Anzeige lässt sich per POST merken
Die Oberfläche blendet „Merken“ auf eigenen Anzeigen aus (A10). Die Policy `favorites_insert_own` prüft aber nur, ob der Nutzer die Anzeige lesen kann; das trifft für eigene Anzeigen immer zu, auch für Entwürfe. Ein manipuliertes Formular (Server Action ohne JavaScript, `id` umgeschrieben) speichert die eigene Anzeige. Eigene Entwürfe erscheinen danach auf der Favoritenseite als „nicht mehr verfügbar“. Ein Leck entsteht nicht.
Reproduktion: als Inserent eine fremde Anzeige öffnen, im Formular „Merken“ das Feld `id` auf die eigene Anzeige setzen, absenden → Zeile in `favorites`. pgTAP `28` (2 TODO), E2E `-g "Eigene Anzeige lässt sich"` (`test.fail`).
Vorschlag: In der Policy zusätzlich `l.owner_id <> auth.uid()` (bzw. `listing_is_public(...)` und nicht eigene), und `addFavorite` meldet das als `failed`.

#### F5 – mittel – Listenkarten laufen bei langen Wörtern über 360 px hinaus
Ein Titel mit einem gewöhnlichen deutschen Kompositum (z. B. „Rehwildbestandsregulierung“, 26 Zeichen) macht Start-, Kategorie-, Such- und Anbieterseite bei 360 px etwa 400 px breit. Die Karte steht in einem Grid (`ul.grid`), dessen Element die min-content-Breite des längsten Worts annimmt. `break-words` (`overflow-wrap: break-word`) verkleinert diese nicht, `min-w-0` sitzt nur am inneren Flex-Element. Das Detail bricht korrekt um. CLAUDE.md verlangt „Responsive ab 360 px“; Lange Firmennamen in der Anbieterzeile sind ebenso betroffen.
Reproduktion: Anzeige „QA5 Hochwildrevier Rehwildbestandsregulierung“ freigeben, `/de` bei 360 px Breite → `document.documentElement.scrollWidth` 403. E2E `-g "langem deutschem Kompositum"` (`test.fail`).
Vorschlag: `min-w-0` auch am `li` bzw. `grid-cols-1`/`minmax(0,1fr)` am `ul`, und `[overflow-wrap:anywhere]` oder `hyphens-auto` (mit `lang`) an Titel und Anbieterzeile. E2E mit einem langen Kompositum in allen vier Sprachen.

#### F6 – niedrig – Leere Kategorie- und Regionsseiten sind `noindex`, haben aber Canonical und hreflang
`listMetadata` setzt `alternates` immer und bei leeren Seiten zusätzlich `robots: noindex, follow`. Review A7: „hreflang nur zwischen indexierbaren Seiten“, keine widersprüchlichen Signale. Betroffen sind rund 5 Arten × 500 Kreise × 4 Sprachen, sobald ein Crawler sie über Links erreicht (Links gibt es nur auf befüllte Regionen, die Seiten sind aber direkt abrufbar und tauchen über externe Links oder alte Sitemaps auf).
Reproduktion: `/de/gesellschaftsjagd/wien` (leer) → `<meta name="robots" content="noindex, follow">` und 6 `link rel="canonical|alternate"`. E2E `-g "Leere Regionsseite"` (`test.fail`).
Vorschlag: Bei leerer Seite `alternates` weglassen. Optional `X-Robots-Tag` auch für leere Seiten (H6).

#### F7 – niedrig – „Auf Anfrage“ mit Währung erscheint im Währungsfilter
Der Check `price_consistent` erlaubt `currency` bei `price_unit = 'on_request'`. Der Währungsfilter vergleicht nur `currency`, eine solche Anzeige erscheint also bei „CHF“, obwohl der Hinweis neben dem Filter sagt, „ohne Preis und ‚auf Anfrage‘ fallen dann weg“. Das Web speichert `currency = null`; iOS (I3) und direkte API-Aufrufe können die Kombination schreiben.
Reproduktion: Anzeige mit `price_unit = 'on_request', currency = 'CHF'` aktiv setzen, `search_listings('{"v":1,"currency":"CHF"}')` → enthalten. pgTAP `28` (TODO).
Vorschlag: Check verschärfen (`on_request` ⇒ `currency is null`, Bestand bereinigen) oder im Filter `price_minor is not null` verlangen, sobald `currency` gesetzt ist; ADR-Tabelle ergänzen.

#### F8 – niedrig – Unbekannte Unterpfade statischer Seiten liefern im Produktions-Build 200 (Soft 404)
`/de/imprint/x`, `/de/login/x`, `/de/privacy/a/b`, `/de/forbidden/x` ergeben im Produktions-Build **200** mit `noindex`-Meta und der 404-Seite im Stream; im Dev-Server 404. Der Parser liefert für statische Bereiche `static` und überlässt den Rest Next, das unter `cacheComponents` den Status nicht mehr setzt (gleiche Mechanik wie QA M4 F1). Für die öffentlichen Formen aus ADR 015 gilt der 404 korrekt.
Reproduktion: `curl -s -o /dev/null -w '%{http_code}' http://localhost:3456/de/imprint/x` → 200. E2E `-g "Unterpfade statischer Seiten"` (`test.fail` nur mit `QA_BASE_URL`/CI).
Vorschlag: Im Proxy für statische Bereiche ohne Unterseiten (`imprint`, `privacy`, `terms`, `login`, `forbidden`, `missing`) überzählige Segmente wie unbekannte Formen behandeln (404 per Rewrite auf `missing`), gepflegt in `sections.ts` mit dem bestehenden Dateisystem-Test.

#### F9 – niedrig – Merken in der Textsuche verliert den Suchtext; der Login-Link trägt ihn im `next`
`ListingsPage` gibt den aktuellen Pfad inklusive `q` als `back` an die Merken-Schaltfläche. `toggleFavorite` schickt ihn durch `safeNextPath`, das `q` absichtlich entfernt (H10). Nach dem Merken landet der Nutzer auf `/de/suche` ohne Suchtext und mit einer anderen Trefferliste. Ohne Login steht `q` im Link `/de/login?next=/de/suche?q=…` und damit in Browser-Verlauf, Referer und Zugriffslogs (H10: „q nicht in next“); serverseitig wird es zwar entfernt, bevor es in `redirect_to` geht.
Reproduktion: eingeloggt `/de/suche?q=<Text>` → bei einem Treffer „Merken“ → URL `/de/suche`. E2E `-g "Merken in der Textsuche"` (`test.fail`) und `-g "Merken-Link in der Textsuche"` (dokumentiert den Login-Link).
Vorschlag: `back` für den Login-Link ohne `q` bauen (wie `safeNextPath`); für die Server Action einen eigenen, nur serverseitig geprüften Rücksprung zulassen, der `q` behält (die Action läuft per POST, `q` landet nicht in Auth-Logs), oder nach dem Merken mit `Referer`-freiem Redirect auf den vollständigen, neu serialisierten Pfad.

#### F10 – mittel – `SITE_INDEXABLE` wirkt nur zur Build-Zeit
ADR 015 und Review A8 verlangen eine „Server-Variable der Umgebung“. Tatsächlich wird sie beim Build ausgewertet: `X-Robots-Tag: noindex` kommt aus `headers()` in `next.config.ts` (beim Build in das Routes-Manifest geschrieben), und `robots.txt` ist statisch vorgerendert (○ im Build). Ein Build ohne die Variable, gestartet mit `SITE_INDEXABLE=true`, liefert weiter `Disallow: /` und `X-Robots-Tag: noindex`. Umgekehrt bliebe ein mit `true` gebautes Artefakt auf Stage indexierbar. Wird ein Artefakt von Stage nach Prod befördert oder die Variable nur zur Laufzeit gesetzt, ist Prod komplett `noindex` oder Stage indexierbar. CHANGELOG und `.env.example` nennen das nicht.
Reproduktion: `npm run build` (ohne Variable), `SITE_INDEXABLE=true npx next start -p 3457`, `curl localhost:3457/robots.txt` → `Disallow: /`; `curl -I localhost:3457/de` → `X-Robots-Tag: noindex`.
Vorschlag: Entweder dokumentieren („Build-Variable, je Umgebung eigener Build“) und in der Cloud-Checkliste verankern, oder zur Laufzeit auswerten: `robots.ts` mit `await connection()` dynamisch machen und den Header im Proxy setzen (der läuft je Anfrage). Test im CI gegen einen Build mit und ohne Variable.

#### F11 – niedrig – Sitemap bis zu etwa einer Stunde veraltet, E2E „Akzeptanz c“ hängt davon ab
Die Sitemap nutzt das Profil `hours` ohne Cache-Zähler (bewusst, ADR 015). Folgen: Neue Anzeigen fehlen bis zu 1 h, entfernte Anzeigen und Anbieter-URLs gesperrter oder gelöschter Konten (mit `user_id`) stehen bis zu 1 h (ohne Zugriffe bis 1 Tag) darin. Die URLs selbst antworten sofort mit 404/410, ein Leck ist das nicht. `public.spec.ts` „Akzeptanz c“ erwartet die eben angelegte Anzeige in der Sitemap und scheitert gegen jeden Server, dessen Sitemap schon einmal abgerufen wurde (lokal gegen den Produktions-Build reproduziert). In der CI mit frischem Server ist der Test grün.
Reproduktion: `/sitemap/de.xml` abrufen, Anzeige freigeben, erneut abrufen → fehlt.
Vorschlag: Den Cache-Zähler auch in den Sitemap-Schlüssel nehmen (eine Abfrage je Sitemap-Aufruf, kostet nichts) und im CHANGELOG die Verzögerung für neue Anzeigen nennen; den E2E auf „nicht enthalten“ für Unveröffentlichtes beschränken oder vorher den Zähler erhöhen.

### Hinweise (keine M5-Fehler)
- `cacheEpoch()` nutzt bei einem Fehler `-Date.now()` als Schlüssel. Im Dev-Server erscheint dadurch beim Vorrendern von `/[locale]/[section]/[a]` „Next.js encountered the unstable value `Date.now()` while prerendering“. Fällt die DB aus, entsteht je Anfrage ein neuer Cache-Eintrag. Besser: bei Fehler ungecacht lesen statt einen Zufallsschlüssel zu verwenden.
- Jede öffentliche Seite enthält alle Übersetzungen der App im RSC-Payload (`NextIntlClientProvider` ohne Auswahl, auch Admin-Texte); das Detail-HTML ist rund 93 KB groß. Für Core Web Vitals (SPEC 8) nur die Namespaces der Client-Komponenten übergeben.
- Prefetch- und RSC-Anfragen umgehen die Statusprüfung (A3, gewollt). Über den Sprachumschalter (`next/link`) kann eine eben pausierte Anzeige deshalb bis zu 5 min per Client-Navigation erscheinen; entfernte nicht (Cache-Zähler).
- Die 410-Seite hat keinen Sprachumschalter und keinen Footer (eigene HTML des Proxys); Links zu Suche, Impressum und Datenschutz sind vorhanden.
- Private Anbieterprofile und leere Listen setzen `noindex` nur per Meta, nicht per `X-Robots-Tag` (H6 nennt nur Suche und Status ≠ 200).
- Die Anmeldung per Mail-Code ließ sich lokal nicht wiederholt testen (`email_sent = 2` je Stunde in `config.toml`); der Rücksprung wurde über den Bestätigungslink mit `redirect_to … next` geprüft.

### Nicht prüfbar
- Cloud: Statement-Timeout und Rate-Limits, CDN-Verhalten der Foto-Route, Mehr-Instanz-Betrieb (der Cache-Zähler ist lokal mit einer Instanz geprüft).
- Google-Verhalten (Rich Results, Soft 404, hreflang-Auswahl).
- iOS (I2), Gleichstand der Filter Web/iOS: Es gibt noch keine App. Der Vertrag (`search_listings`, Fixture) ist vorbereitet; F1, F2 und F7 betreffen iOS ebenso.
- Muttersprachliche Prüfung cs/pl (URL-Wörter und Texte im Glossar als ungeprüft markiert).

### Neue Tests
- `supabase/tests/28_qa_m5_abnahme.test.sql` (35, davon 6 TODO). Transaktion mit Rollback.
  - Ort und PLZ kein Suchkriterium und nicht in der Rückgabe, `listing_places` für anon und Fremde nicht lesbar
  - Paging bei gleichen Schlüsseln für `newest`, `price_asc`, `price_desc` (bestehen) und `relevance` (TODO F1)
  - Cursor: gefälschter Hash, Überlauf, ohne UUID, zu lang, Zukunft
  - Sitemap-Quelle = Suche (anon), `gone` für gesperrte und gelöschte Besitzer, Regionszähler, Admin aal2
  - Favoriten: fremder Entwurf abgewiesen, eigene Anzeige (TODO F4)
  - Suchtext mit fünf (besteht) und sechs Wörtern (TODO F2), „auf Anfrage“ mit Währung (TODO F7)
- `web/lib/qa-m5.test.ts` (49, Vitest): `safeNextPath` mit 15 Umgehungsversuchen, Parser-Rundweg und Fixpunkt von `canonicalPath`, Filter aus feindlichem Query-String, Preis-Minor-Einheiten, JSON-LD mit UGC, Preis-Matrix 4 × 4.
- `web/e2e/qa-m5.spec.ts` (27). Konten per `service_role` in Node, Löschung in `afterAll`. Gegen den Produktions-Build lauffähig (`QA_BASE_URL`). Bekannte Fehler als `test.fail`.
  - Datenschutz und UGC: PLZ/Ort/Storage-Pfade, XSS in Titel, Beschreibung und Firmenname, Open Graph absolut
  - Cache: anonyme Seiten ohne Session-Inhalt; Sperren sofort auch für Anbieterseite, Textsuche und Favoriten
  - Favoriten: eigene Anzeige (F4), 230 Favoriten (F3), Merken in der Textsuche (F9), eigene Anzeige ohne Merken/Kontakt
  - Paging mit gleichen Schlüsseln (newest, Preis; Relevanz F1), sechs Wörter (F2)
  - Statuscodes inkl. 308 für kodierte Pfade, Schrägstrich und `//`, RSC ohne Leck; Unterpfade statischer Seiten (F8)
  - hreflang/Canonical in vier Sprachen, leere Regionsseite (F6), robots und Sitemaps außerhalb von Prod
  - ohne JavaScript: Sprachumschalter mit Query, Filterformular; 360 px, Schlüssel und `lang` in vier Sprachen; langes Kompositum (F5); axe auf Kreis, Suche mit Filtern, Detail en/pl, 410; Rücksprung nach dem Login

### Empfehlung
M5 ist **mit Auflagen abnahmereif**. Die drei Akzeptanzkriterien und die Nutzer-Ergänzung „sofortige Wirkung“ sind auf Dev und im Produktions-Build erfüllt. Sichtbarkeit, Standortschutz, Statuscodes, XSS-Schutz, Rücksprungziele und Cache-Trennung halten allen Proben stand.
- Vor M6/I2: **F3** (Datenverlust bei Favoriten) und **F1** (Relevanz-Paging, Vertrag für iOS und M8) beheben.
- Bald: **F2**, **F5**, **F10** (vor dem ersten Prod-Deployment entscheiden und dokumentieren).
- Bei Gelegenheit: F4, F6, F7, F8, F9, F11.

## M5 – Nachprüfung 2026-11-01

Geprüfter Stand: `1413241` (main, Arbeitsbaum sauber), Fixes `b5a47d6..1413241` (Migration `20261101100000_qa_m5_fixes`, CHANGELOG „Nachtrag M5: QA-Funde F1–F11“, ADR 015). Geprüft wurde auf dem Dev-Server und im Produktions-Build (`npm run build && npx next start -p 3456`, E2E mit `QA_BASE_URL`). Für F10 lief ein Build ohne `SITE_INDEXABLE` zweimal: auf 3456 ohne Variable und auf 3457 mit `SITE_INDEXABLE=true`.

### Status je Fund

| Fund | Status | Beleg |
|---|---|---|
| F1 Relevanz-Paging | **behoben** | `search_listings` hat `proconfig` `extra_float_digits=3`. QA-pgTAP `30`: 37 Anzeigen mit verschiedenen Rängen plus Gleichständen, Sitzung auf `extra_float_digits = 0`. Mit Limit 1 kommen alle 37 ohne Doppelte, mit Limit 3 in derselben Reihenfolge wie am Stück. Das Attribut wirkt nicht über die Funktion hinaus in die Sitzung. **Gegenprobe** mit `alter function … reset extra_float_digits`: 100 Seiten, 2 verschiedene IDs, der alte Fehler wäre also erkannt worden. E2E „Relevanz“ grün auf Dev und Produktion (über PostgREST). |
| F2 Sechs Wörter | **behoben** | Die Grenze gilt je Sprachfassung. Ein Satz mit 12 Wörtern ist gültig, ebenso 16 Wörter, Phrase und Ausschluss. 17 Wörter (auch mit `or`) und über 200 Zeichen ergeben weiter `22023`/`q`. Web: eigener Hinweis „Der Suchbegriff ist zu lang.“ in de/en/cs/pl als `role="alert"` (E2E). |
| F3 Favoriten ab ~220 | **behoben** | RPCs `my_favorites` und `remove_unavailable_favorites` (Invoker, nur `authenticated`, Allowlist in `00_meta`). E2E mit 232 Favoriten, davon 2 pausiert: 230 Karten, Hinweis „2 … nicht mehr verfügbar“. „Entfernen“ lässt 230 stehen, danach kein Button mehr. pgTAP: gesperrter Besitzer zählt als nicht verfügbar, keine Titel oder Ortsnamen nicht verfügbarer Anzeigen in der Antwort, fremde Favoriten unberührt, anon → `42501`. Bei Fehler der RPC zeigt die Seite `loadFailed` und keinen Entfernen-Button (Code geprüft). |
| F4 Eigene Anzeige merken | **behoben** | Policy verlangt `owner_id <> auth.uid()` und `listing_is_public`. Eigene öffentliche Anzeige und eigener Entwurf → `42501`, pausierte fremde → `42501` (kein Orakel). E2E mit manipuliertem POST: keine Zeile. Es gibt keine UPDATE-Policy auf `favorites`, über die sich `listing_id` umschreiben ließe. |
| F5 360 px | **behoben** | E2E 360 px ohne Überbreite auf Anbieter- (Firmenname „Forstbetriebsgemeinschaftsgesellschaft“), Kategorie-, Such- und Startseite in de/en/cs/pl, Titel „Rehwildbestandsregulierungsmaßnahmen“. Dev und Produktion. |
| F6 Leere Seiten | **behoben** | `/de/gesellschaftsjagd/wien`: `noindex`, ohne Canonical und `alternate`. Gegenprobe: befüllte Kategorieseite in vier Sprachen mit Canonical, 5 `alternate` und ohne `noindex`. |
| F7 „Auf Anfrage“ mit Währung | **behoben** | Insert und Update mit `on_request` und Währung → `23514`, ohne Währung erlaubt. Das Web-Formular speichert `currency: null` (Bearbeiten-Action), deshalb keine Regression. |
| F8 Unterpfade statischer Seiten | **teilweise** | Leaf-Bereiche behoben: `/de/imprint/x`, `/de/login/x`, `/de/privacy/a/b`, `/de/forbidden/x`, `/de/terms/x`, `/de/missing/x`, `/en/imprint/x`, `/pl/terms/a/b` geben im Produktions-Build 404 mit `noindex`. `/de/welcome/x` leitet ohne Login auf den Login um (kein Orakel) und ergibt mit Login 404. **Offen:** Bereiche mit Unterseiten, siehe N3. |
| F9 Suchtext beim Merken | **teilweise** | Behoben: Der Rücksprung nach erfolgreichem Merken behält `q` (E2E). Der Login-Link der Merken-Schaltfläche enthält `q` nicht mehr. Manipulierte `back`-Werte (`//evil…`, `next=https://…`, CRLF) bleiben auf derselben Origin. **Offen:** Leitet die Action selbst auf Login oder Welcome um, steht `q` wieder in der URL, siehe N2. |
| F10 `SITE_INDEXABLE` | **behoben** | Dasselbe Artefakt auf 3456 (ohne Variable): `robots.txt` mit `Disallow: /`, `X-Robots-Tag: noindex` auf 200, 307, 308, 403, 404, 410. Auf 3457 (`SITE_INDEXABLE=true`): `Allow: /` mit vier Sitemaps, kein `X-Robots-Tag` auf `/de` und `/de/jagdpacht`. Suche weiter `noindex, follow`, 404 weiter `noindex`. `robots.txt` ist im Build jetzt ƒ. Die 410-Seite behält ihre CSP, 403 `no-store`, Admin behält die Nonce-CSP (`qa-m4.spec.ts` gegen Produktion grün). Rest: N1. |
| F11 Sitemap | **behoben** | Nach Entfernen fehlt die Anzeige sofort in `/sitemap/de.xml` und `/sitemap/pl.xml`, ohne weiteren Anstoß (E2E, Dev und Produktion). `public.spec.ts` „Akzeptanz c“ läuft jetzt auch gegen einen Produktionsserver, dessen Sitemap schon abgerufen wurde. Neue Anzeigen erscheinen weiter erst nach bis zu 1 h, das steht so in ADR und CHANGELOG. |

Hinweis `cacheEpoch()`: Statt `-Date.now()` wird jetzt `-1` verwendet. Damit entsteht bei DB-Ausfall kein Cache-Eintrag je Anfrage mehr. Während des Ausfalls können Listen aus einem früheren Ausfall bis zu 5 min alt sein. Das ist vertretbar, weil die Statusprüfung im Proxy dann ohnehin fail-open arbeitet.

### Neue Funde

#### N1 – niedrig – `X-Robots-Tag: noindex` fehlt außerhalb von Prod auf Pfaden außerhalb des Proxy-Matchers
Mit F10 wurde der Header aus `next.config.ts` (galt für alle Pfade außer Admin) in den Proxy verlegt. Der Matcher schließt `api/`, `sitemap/`, `static/`, `_next/`, `robots.txt` und `favicon.ico` aus. Next leitet den abschließenden Schrägstrich außerdem per 308 um, bevor der Proxy läuft. Auf Stage tragen deshalb Foto-Route, Sitemaps, `robots.txt` und dieser 308 kein `noindex` mehr. ADR 015 sagt „überall `X-Robots-Tag: noindex`“. Auswirkung gering, weil `Disallow: /` das Crawlen auf Stage verhindert. Fotos von Stage könnten aber über externe Links als URL ohne Inhalt in den Index geraten.
Reproduktion: Build ohne Variable, `npx next start -p 3456`, `curl -sI localhost:3456/sitemap/de.xml`, `…/robots.txt`, `…/api/photos/<uuid>/full`, `…/de/jagdpacht/` → kein `X-Robots-Tag`. Vor `bdc7621` war er gesetzt. E2E `qa-m5-nachpruefung.spec.ts -g "N1"` (`test.fail`).
Vorschlag: Den Header für diese Pfade zusätzlich in Route-Handlern bzw. `robots.ts`/Sitemap setzen, dort zur Laufzeit möglich. Oder ADR anpassen: „alle Seiten, nicht Dateien“.

#### N2 – niedrig – Suchtext doch im Login- bzw. Welcome-Link, wenn die Merken-Action umleitet (F9-Rest, H10)
`toggleFavorite` bildet `back` jetzt mit `keepSearchText: true` und übergibt genau diesen Wert an `requireOnboardedUser(locale, back)`. Ist die Sitzung abgelaufen oder fehlt die Zustimmung zu neuen Rechtstexten, leitet die Action auf `/de/login?next=/de/suche?q=…` bzw. `/de/welcome?next=/de/suche?q=…` um. Der Suchtext steht dann wieder in Verlauf, Referer und Zugriffslogs. Login und Welcome entfernen `q` später über `safeNextPath`, es landet also nicht in `redirect_to`. Der CHANGELOG-Satz „Der Login-Link enthält ihn nie“ stimmt deshalb nicht.
Reproduktion:
1. Einloggen, `/de/suche?q=<Text>` öffnen, alle Cookies löschen, bei einem Treffer „Merken“ → URL `/de/login?next=/de/suche?q=<Text>`.
2. Mit einem Konto ohne aktuelle Zustimmung: `/de/suche?q=<Text>` → „Merken“ → `/de/welcome?next=/de/suche?q=<Text>`.
3. E2E `qa-m5-nachpruefung.spec.ts -g "N2"` (2 × `test.fail`).
Vorschlag: `requireOnboardedUser(locale, safeNextPath(raw, locale))` (ohne `q`) und erst für den abschließenden `redirect` nach dem Merken die Variante mit `q` verwenden.

#### N3 – niedrig – Unbekannte Unterpfade von Bereichen mit Unterseiten bleiben im Produktions-Build Soft 404 (F8-Rest)
`LEAF_SECTIONS` deckt nur Bereiche ohne Unterordner ab. Für `account` und `auth` bleibt der alte Mechanismus: Im Produktions-Build kommt 200 mit der 404-Seite im Stream und Meta-`noindex`, im Dev-Server 404. Betroffen sind `/de/auth`, `/de/auth/x`, `/de/auth/confirm/x` (auch ohne Login) sowie mit Login `/de/account/x`, `/de/account/favorites/x` und `/de/account/listings/x/y`. In Prod (`SITE_INDEXABLE=true`) trägt `/de/auth/x` keinen `X-Robots-Tag`, nur das Meta-Tag. Für Crawler erreichbar ist nur `/de/auth…`, `account` leitet ohne Login um.
Reproduktion: `curl -s -o /dev/null -w '%{http_code}' localhost:3456/de/auth/x` → 200 (Dev: 404). E2E `qa-m5-nachpruefung.spec.ts -g "F8 Rest"` (`test.fail` nur mit `QA_BASE_URL`/CI).
Vorschlag: Im Proxy die bekannten Unterseiten-Formen je Bereich zulassen (z. B. aus dem Dateisystem-Test erzeugte Muster `account/listings/[id]/edit`) und alles andere wie unbekannte Formen behandeln (Rewrite auf `missing`, 404). Mindestens für `auth` (ohne Seite unter `/de/auth` selbst) analog zu `LEAF_SECTIONS`.

### Umstellung der Proben (Prüfung)
- `28_qa_m5_abnahme`: Nur die `todo(...)`-Zeilen sind entfernt, die Assertions sind unverändert. F7 prüft jetzt zusätzlich per `throws_ok` die Verletzung des Checks (Plan 35 → 36). Die Suche nach CHF ergibt 0 damit trivial, der Fall ist aber über den Check abgedeckt. Drei Abschnittskommentare beschrieben noch den alten Fehler und sind in diesem Commit angepasst.
- `qa-m5.spec.ts`: `test.fail` → `test` ohne Änderung der Erwartungen. Bei F8 entfällt die bedingte Markierung. Der Login-Link-Test (F9) prüft jetzt `not.toContain(q)` und `next=/de/suche`, das ist die Erwartung aus H10. Der F3-Test klickt „Entfernen“ nur, wenn der Button erscheint. Mit dem Fix erscheint er bei 230 verfügbaren nicht, deshalb deckt die neue QA-Probe mit 2 pausierten Favoriten das Entfernen im Browser ab.
- `public.spec.ts` „Akzeptanz c“: Vor dem Sitemap-Abruf wird der Cache-Zähler erhöht, dann wird die neue Anzeige erwartet. Die Assertions sind gleich geblieben. Der Test beschreibt jetzt das dokumentierte Verhalten (neue Anzeigen erst mit Zähler oder nach 1 h).
- `29_qa_m5_fixes` (8): sinnvoll, ergänzt durch QA-pgTAP `30` um anon-Rechte, Datenschutz der Antwort und gesperrte Besitzer.
- Ergebnis: keine abgeschwächten Assertions.

### Prüfläufe

| Prüfung | Ergebnis |
|---|---|
| `supabase db reset && supabase test db` | grün, 30 Dateien, **685** (ohne QA-Datei 30). Mit `30_qa_m5_nachpruefung` (28) 31 Dateien, **713**, keine TODO. |
| `supabase test db` ohne Reset nach allen E2E-Läufen | grün (713), keine `@test.local`-Konten übrig |
| `npm run lint`, `npm run typecheck` | grün, auch mit den neuen QA-Dateien |
| `npm test` (Vitest) | **396/396** |
| `npm run test:integration` | **160/160** |
| `npm run test:e2e` (Dev) | **92/92** (79 bestehende plus 13 aus `qa-m5-nachpruefung.spec.ts`, davon 3 erwartete Fehlschläge: N1, 2 × N2) |
| Produktions-Build (3456), `QA_BASE_URL` | `qa-m5.spec.ts` und `qa-m4.spec.ts` **40/40**, `qa-m5-nachpruefung.spec.ts` **13/13** (4 erwartete Fehlschläge: N1, 2 × N2, F8-Rest), `public.spec.ts` mit eigener Konfiguration **14/14** (inkl. „Akzeptanz c“) |
| `npm run build` | grün, ohne Warnungen, `robots.txt` ƒ |
| F10: ein Artefakt, zwei Starts | 3456 ohne Variable: `Disallow`, `noindex`. 3457 mit `true`: `Allow` plus Sitemaps, kein Header auf Seiten mit Status 200. |

### Neue Tests
- `supabase/tests/30_qa_m5_nachpruefung.test.sql` (28, Transaktion mit Rollback): F1 bei `extra_float_digits = 0` mit 37 verschiedenen Rängen und kein Leck in die Sitzung. F2: Grenzen 16/17 Wörter, OR, Phrase, 200 Zeichen. F3: anon-Rechte, nur eigene Favoriten, keine Titel oder Orte nicht verfügbarer Anzeigen, gesperrter Besitzer. F4: pausierte fremde Anzeige. F7: Update.
- `web/e2e/qa-m5-nachpruefung.spec.ts` (13, Konten per `service_role`, Löschung in `afterAll`, lauffähig mit `QA_BASE_URL`): N2 (2), manipulierter `back`, gemischte Favoriten mit Entfernen, F2 in vier Sprachen, F8 Leaf ohne und mit Login, F8-Rest (N3), `X-Robots-Tag` auf allen Statusarten, N1, F5 in vier Sprachen, F6 Gegenprobe, F11 sofort.

### Gesamturteil
F1, F2, F3, F4, F5, F6, F7, F10 und F11 sind behoben. Die beiden Funde mit Priorität hoch (F1, F3) sind auf Dev und im Produktions-Build belegt, F1 mit Gegenprobe. F8 und F9 sind teilweise behoben, die Reste stehen als N2 und N3 oben. N1 ist eine kleine Lücke, die durch den F10-Fix entstanden ist. Die Fixes brechen keine bisherigen Tests und schwächen keine Sicherheitseigenschaft: RLS auf `favorites` ist strenger, die RPCs laufen als Invoker nur für `authenticated`, das Funktionsattribut wirkt nur innerhalb der Funktion, die Admin-CSP bleibt erhalten, und Rücksprünge bleiben auf derselben Origin. **M5 ist abnahmereif.** N1–N3 (alle niedrig) können bei Gelegenheit behoben werden, N2 am einfachsten zusammen mit dem nächsten Favoriten-Thema.
