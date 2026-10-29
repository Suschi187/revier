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
