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
