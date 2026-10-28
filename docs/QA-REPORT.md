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
