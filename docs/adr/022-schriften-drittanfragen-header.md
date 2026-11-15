# ADR 022: Schriften, Drittanfragen und Sicherheitsheader (Review M10a Schritt 8)

Status: angenommen (Architektur-Review 2026-11-13, Stand `e30fb5a`). Ergänzt ADR 010, 014, 015, 016 und 021.
Ergebnis: **Freigabe ja**, kein blockierender Befund. Auflagen S1 bis S3 vor M10.

## Kontext

SPEC M10a Schritt 8 verlangt eine Prüfung von Schriften, Drittanfragen und Sicherheitsheadern, bevor das Web-Release (M10) kommt. Seit Schritt 5 bis 7 gibt es neu: die Teilmenge `inter-czech-wght-normal.woff2`, Font-Preload im Layout, die Route `/api/locale` (Sprachwechsel ohne JavaScript), das DeepL-Skript und die Migration `20261113100000_reject_code_killed_game.sql`.
Befunde haben eine Schwere: **blockierend** (vor Abschluss von M10a beheben), **sollte** (vor M10 beheben), **kann** (Verbesserung).

## Befunde

### 1. Schriften

In Ordnung:
- Alle Schriften liegen unter `web/public/static/fonts/` (Montserrat und Inter, je Latin und Latin Extended, dazu die Teilmenge). Lizenztexte daneben: `Inter-OFL.txt`, `Montserrat-OFL.txt`; Kartenschrift Noto Sans mit `web/public/static/map/fonts/OFL.txt`.
- `@font-face` in `web/app/globals.css:7-51`: `font-display: swap` überall, variable Achse `100 900`. Die Teilmenge steht nach der Latin-Extended-Datei von Inter (`globals.css:28-35` nach `:7-14`). Nach CSS Fonts 4 wird bei überlappendem `unicode-range` die zuletzt definierte Regel zuerst geprüft; Č č Š š kommen also aus der 2-KB-Datei. Die Reihenfolge ist richtig.
- Preload in `web/app/[locale]/layout.tsx:33-34` über `react-dom` `preload` mit `as: "font"`, `type: "font/woff2"`, `crossOrigin: "anonymous"`. Das ist nötig, weil Schriften immer im CORS-Modus laden; ohne das Attribut lüde der Browser die Datei doppelt. Pfade sind eigene Origin.
- SIL OFL 1.1: Keine der beiden Lizenzdateien nennt einen Reserved Font Name (`Inter-OFL.txt:1`, `Montserrat-OFL.txt:1`, nur Copyright-Zeile; `:33` ist die Definition im Lizenztext). Eine Teilmenge ist eine „Modified Version“ (OFL Abschnitt 3) und darf deshalb weiter „Inter“ heißen. Bedingung 2 (Copyright und Lizenz bei jeder Kopie) ist mit der Lizenzdatei als eigener Textdatei im selben Verzeichnis erfüllt. Verkauft wird die Schrift nicht (Bedingung 1).

Befunde:
- **S1 (sollte), Cache-Header für Schriften fehlen.** Der Kommentar `web/next.config.ts:77` nennt „Kartenstil, Schriften und Worker“, die Regel in `:78` gilt aber nur für `/static/map/:path*`. Unter `public/` liefert Next `Cache-Control: public, max-age=0`: Jeder Seitenaufruf prüft die vorgeladenen Schriften neu (304), auf dem Handy mit einem Round-Trip je Datei. **Auflage:** Dateinamen versionieren (z. B. `inter-latin-wght-normal.v4-1.woff2`, Pfade in `globals.css` und `layout.tsx:34` mitziehen) und eine Regel `/static/fonts/:path*` mit `public, max-age=31536000, immutable` ergänzen. Nicht `immutable` ohne Versionierung setzen: Eine geänderte Teilmenge käme sonst ein Jahr lang nicht an. Die Lizenztexte (`*.txt`) dürfen mit in die Regel.
- **K1 (kann), Teilmenge auch vorladen.** „Čeština“ steht auf jeder Seite in der Sprachwahl; die 2-KB-Datei wird aber erst nach dem CSS entdeckt (`layout.tsx:33`). Mit Preload auf allen Seiten entfällt der kurze Schriftwechsel in der Kopfleiste. Kosten: 2 KB.
- **K2 (kann), Kommentar falsch:** `globals.css:5` sagt „unter /fonts“, richtig ist `/static/fonts`.
- **K3 (kann), Teilmenge reproduzierbar machen.** `docs/DESIGN.md:59` nennt fonttools, aber nicht den Befehl. Befehl mit Quelldatei und Version in DESIGN.md festhalten und beim Schneiden `--name-IDs='*'` setzen, damit Copyright- und Lizenz-URL auch in der Datei stehen (pyftsubset behält standardmäßig nur die Namen 0 bis 6; rechtlich reicht die Textdatei, das ist nur zur Sicherheit).
- **K4 (kann), Lizenztabelle unvollständig:** `docs/DESIGN.md:89-96` führt Noto Sans (Kartenbeschriftung, `public/static/map/fonts/`) nicht auf. Die Seite `/sources` nennt die OFL (`web/app/[locale]/sources/page.tsx:15`); eine Zeile in DESIGN.md §7 ergänzen.

### 2. Drittanfragen

In Ordnung, keine Anfrage an fremde Origins beim Seitenaufruf:
- Kein Verweis auf Google Fonts, CDNs, Tag-Manager oder externe Kacheln im Web-Code (Suche nach `fonts.googleapis`, `fonts.gstatic`, `cdn.`, `unpkg`, `jsdelivr`, `cdnjs`, `googletagmanager`, `gravatar`, `tile.openstreetmap`: kein Treffer).
- Die CSP erzwingt das zusätzlich: `default-src 'self'`, `font-src 'self'`, `worker-src 'self'`, `frame-src 'none'`; `img-src` und `connect-src` nur zusätzlich für die eigene Supabase-Origin (`web/lib/security/csp.ts:11-24`). Kartenstil, Glyphen und Kacheln kommen von der eigenen Origin (`public/static/map/style-*.json`: `"glyphs":"/static/map/fonts/…"`, ADR 016).
- Der Supabase-Browser-Client wird nur in Login, Re-Auth, Foto-Upload, Verifizierungs-Upload und Chat-Realtime erzeugt (`web/lib/supabase/browser.ts`, genutzt in `components/auth/LoginForm.tsx`, `components/auth/ReauthForm.tsx`, `components/listings/PhotoUploader.tsx`, `components/account/VerificationUpload.tsx`, `lib/chat/realtime.ts`), nicht auf öffentlichen Seiten. Anzeigenfotos kommen über die eigene Foto-Route (ADR 015).
- Externe Links laden nichts: Shop-Link `web/components/SiteHeader.tsx:15,65` (`<a>`, gleiches Fenster, kein Prefetch; mit `strict-origin-when-cross-origin` erfährt der Shop nur die Origin), OSM-Vermerk `components/listings/steps/LocationStep.tsx:90` (`noopener noreferrer`). `https://schema.org` in JSON-LD ist nur ein Bezeichner.
- Der E2E-Test `web/e2e/cookie-inventory.spec.ts:28-35,93` meldet jede Anfrage an eine fremde Origin (auch gegen Stage/Prod über `QA_BASE_URL`).

Befund:
- **K5 (kann):** `/api/locale` in die API-Liste von `cookie-inventory.spec.ts:138` aufnehmen (mit und ohne Referer), damit kein späteres `NEXT_LOCALE`-Cookie unbemerkt dazukommt (ADR 021).

### 3. Sicherheitsheader

In Ordnung:
- Basis-Header für alle Pfade außer den bewusst ausgenommenen (`web/next.config.ts:7-26,56`): CSP, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY` plus `frame-ancestors 'none'`, `Permissions-Policy` (Kamera, Mikrofon, Standort, Payment, USB aus). `poweredByHeader: false` (`:36`).
- `/auth/*` und Abbestellen mit `no-referrer` (`next.config.ts:80`, `web/proxy.ts:144-148`), Foto-Export und Verifizierungsdokument mit eigener CSP bzw. `no-referrer` (`next.config.ts:59-73`). 410-Seite mit eigener strenger CSP (`proxy.ts:50`).
- Nonce-CSP mit `'strict-dynamic'` für `/admin` und Chat aus dem Proxy (`web/proxy.ts:110-125,184-188`, `csp.ts:14-15`), dazu `noindex` und `no-store`. Abgesichert in `e2e/admin.spec.ts:110-116`, `e2e/chat.spec.ts:143`, `e2e/qa-m7.spec.ts:61`. Der Font-Preload ist ein `<link>`, kein Skript, und braucht keine Nonce.
- HSTS nur in Produktion, `max-age=63072000; includeSubDomains`, ohne `preload` (`next.config.ts:23-25`). Das ist die richtige Vorbereitung: `preload` erst, wenn Domain (SPEC 7.1) und alle Subdomains feststehen und HTTPS sicher läuft; die Aufnahme in die Preload-Liste ist schwer rückgängig zu machen.
- `upgrade-insecure-requests` nur bei HTTPS-Site-URL (`csp.ts:33`).

Bekanntes Restrisiko (bewusst, ADR 010): Öffentliche Seiten haben `script-src 'self' 'unsafe-inline'` (`csp.ts:16`), weil die vorgerenderte Hülle unter `cacheComponents` Inline-Skripte ohne Nonce enthält. Schutz bleibt Reacts Escaping, kein `dangerouslySetInnerHTML` mit Nutzerdaten, Zod an den Eingängen und die Nonce-CSP auf den Seiten mit fremdem Text in Echtzeit (Chat) und mit Rechten (Admin). Bei jedem Next-Update prüfen, ob Nonces mit vorgerenderter Hülle möglich werden.

Befunde:
- **K6 (kann), für M10:** `Cross-Origin-Opener-Policy: same-origin` ergänzen (trennt fremde Fenster vom Browsing-Kontext, keine Popups im Einsatz), `Permissions-Policy` um `browsing-topics=()` erweitern, CSP-Berichte (`report-to` an eine eigene Route) erst mit Prod-Hosting entscheiden. HSTS-`preload` als Punkt in `docs/WEB-RELEASE.md` aufnehmen.

### 4. Route `/api/locale`

Geprüft: `web/app/api/locale/route.ts:17-31`, `web/lib/public/locale-switch.ts:13-24`, Tests `web/lib/public/locale-switch.test.ts`.

In Ordnung:
- **Open Redirect:** Kein Risiko. `Location` beginnt immer mit `/{target}`, und `target` kommt nur aus der festen Liste `routing.locales` (`route.ts:19`, sonst `defaultLocale`). Vom Referer zählen nur `pathname` und `search`, nie Host oder Schema (`route.ts:24-25`); getestet mit fremdem Referer (`locale-switch.test.ts:45-47`). `canonicalPath` (`web/lib/auth/paths.ts:67-83`) dekodiert mehrfach, entfernt Steuerzeichen, macht `\` zu `/` und fasst `//` zusammen. Ein protokollrelatives Ziel wie `//evil` kann deshalb auch im Zweig für statische Seiten (`locale-switch.ts:22`) nicht entstehen; getestet in `locale-switch.test.ts:25`.
- **Header-Injection:** Kein Risiko. `pathname` kommt aus `canonicalPath` (Steuerzeichen entfernt, URL-kodiert), `search` aus dem WHATWG-URL-Parser (der entfernt Tab, LF und CR und kodiert C0-Zeichen). Zusätzlich lehnt `Headers` CR/LF ab; die Folge wäre ein 500, keine Injection.
- **Caching:** `private, no-store` und `noindex` (`route.ts:8-11`), dazu `rel="nofollow"` am Link (`components/LocaleSwitcher.tsx:67`). Da nichts gespeichert wird, braucht es kein `Vary: Referer`. Die Route setzt kein Cookie (ADR 021) und ändert keinen Zustand; GET ohne CSRF-Schutz ist hier richtig.
- **Ohne Referer** (z. B. von `/auth/*` mit `no-referrer`, Browser-Einstellungen): zur Startseite der Zielsprache (`route.ts:20`); ungültiger Referer ebenso (`:26-28`). Getestet in `locale-switch.test.ts:49-53`.
- **Länge:** Query über 1000 Zeichen fällt weg (`locale-switch.ts:6,19`). Der Pfad ist nicht begrenzt, aber Browser kürzen lange Referer (Chrome ab 4096 Byte auf die Origin) und Node begrenzt die Header-Größe; ein langer Pfad führt höchstens zu einer langen, eigenen `Location`.

Befund:
- **K7 (kann):** Die Query wird roh übernommen (`locale-switch.ts:18-20`), während Rücksprungziele sonst aus den geprüften Filtern neu gebaut werden (`lib/auth/paths.ts:89-92`, ADR 015 Review A9). Ein Sicherheitsrisiko ist das nicht (das Ziel ist dieselbe öffentliche Seite, die man auch direkt aufrufen kann), aber fremde Parameter (`utm_*`, Müll) wandern mit in die neue URL. Für Einheitlichkeit die Query aus `parsed.page` neu bauen; Suchtext darf hier bleiben, weil er nicht in Login-Links oder Auth-Logs landet. Optional den Pfad auf z. B. 2000 Zeichen begrenzen und sonst zur Startseite leiten.

### 5. DeepL-Skript

In Ordnung:
- Der Schlüssel kommt nur aus der Umgebung (`web/scripts/translate-deepl.mjs:19`), geladen über `node --env-file-if-exists=.env.local` (`web/package.json:24`). `.env*` ist ignoriert (`web/.gitignore:34-35`, Repo-Wurzel `.gitignore:5-7`), `.env.example:21-22` enthält nur den leeren Namen mit Hinweis.
- Nicht im Bundle: kein `NEXT_PUBLIC_`-Präfix, Verweise auf `DEEPL_API_KEY` nur im Skript, in `.env.example` und im Changelog; nicht in `lib/env.ts`.
- Nicht geloggt: Ausgegeben werden Fortschritt und Zählwerte (`:129,180`). Fehlermeldungen enthalten Pfad, Status und Antworttext von DeepL (`:91`), nicht den Header. Der Bericht `scripts/.deepl-report.json` (Nutzung, Schlüssel der Texte) ist ignoriert (`web/.gitignore:53`).
- Das temporäre Glossar wird in `finally` gelöscht (`:154-158`).
- An DeepL gehen nur Oberflächentexte, keine Nutzerdaten. Deshalb kein Auftragsverarbeitungsthema nach DSGVO. Mit einem Free-Schlüssel (`:fx`, `:24`) darf DeepL die Texte zur Verbesserung nutzen. Bei unveröffentlichten Texten ist das hinnehmbar, ein Hinweis in `.env.example` genügt (kann).

Keine Auflage.

### 6. Migration `20261113100000_reject_code_killed_game.sql`

Geprüft: `supabase/migrations/20261113100000_reject_code_killed_game.sql:12-24`, Vorlage `supabase/migrations/20261112160000_qa_m9b_fixes.sql:200-241`, Test `supabase/tests/58_killed_game.test.sql`.

In Ordnung:
- **Rechte und Eigentümer:** `pg_get_functiondef` liefert `CREATE OR REPLACE FUNCTION` samt `SECURITY DEFINER` und `SET search_path TO ''` (Vorlage `qa_m9b_fixes.sql:203-204`). `CREATE OR REPLACE` behält Eigentümer und ACL (Postgres-Doku: „ownership and permissions of the function do not change“). `SECURITY DEFINER` und der leere `search_path` bleiben damit erhalten, ein `GRANT` an `anon` kommt nicht dazu.
- **Fehlschlag sichtbar:** Ändert `replace` nichts, bricht die Migration ab (`:19-21`). Der gesuchte Text steht in der Vorlage auf einer Zeile (`qa_m9b_fixes.sql:235`) und kommt nur einmal vor.
- `execute` läuft nur mit dem Text aus dem Katalog, ohne Eingaben von außen.

Befunde:
- **S2 (sollte), Test prüft nur einen Text.** `58_killed_game.test.sql:27-28` sucht `'killed_game'` im Funktionstext. Das beweist weder, dass `resolve_reports` den Code annimmt, noch dass die Attribute erhalten blieben. **Auflage:** (a) eine Meldung zu einer Anzeige anlegen und `resolve_reports(..., 'content_removed', 'killed_game', 'Begründung', …)` als Admin (aal2) erfolgreich ausführen, (b) `select prosecdef, proconfig from pg_proc` auf `true` und `{search_path=""}` prüfen, (c) `has_function_privilege('anon', 'public.resolve_reports(report_target, uuid, text, text, text, text)', 'execute')` ist `false` (bzw. so wie vor der Migration).
- **S3 (sollte), eine einzige Quelle für die Codes.** Die gültige Fassung von `resolve_reports` steht jetzt in keiner Migrationsdatei mehr vollständig. Wer die Funktion das nächste Mal mit `create or replace` aus `qa_m9b_fixes.sql` kopiert, verliert `killed_game` ohne Warnung. Test 58 fängt das zwar ab, aber erst nachträglich. Die Codes stehen außerdem doppelt (Check `:7-8` und Funktion). Auch `web/lib/moderation.test.ts:11` liest einen festen Migrationsnamen und muss bei jedem neuen Code angepasst werden. **Auflage (vor dem nächsten neuen Code, spätestens M10):** eine Domain `public.reject_code as text check (value in (…))` für `listings.reject_code` einführen. `resolve_reports` prüft dann mit einem Cast `p_code::public.reject_code` in einem eigenen `begin … exception when check_violation` und wirft weiter den bisherigen Fehler „Grund fehlt“ mit Hinweis `{"fields":["code"]}`, damit Web und iOS dieselbe Feldmeldung bekommen. Alternativ eine kleine Tabelle `private.reject_codes` mit Fremdschlüssel aus `listings.reject_code` und `exists`-Prüfung in der Funktion. Danach betrifft ein neuer Code nur noch die Domain (bzw. eine Zeile in der Tabelle), nicht mehr die Funktion. Bis dahin gilt: Änderungen an `resolve_reports` beginnen mit `pg_get_functiondef` aus der aktuellen Datenbank, nicht mit der alten Migrationsdatei; als Kommentar über `qa_m9b_fixes.sql:200` vermerken.
- Bewertung des Musters: Für eine einmalige, kleine Änderung ist `pg_get_functiondef` + `replace` + `execute` vertretbar und sicher. Als Standard taugt es nicht, weil der Diff im Review den neuen Funktionstext nicht zeigt und die Änderung vom genauen Wortlaut der alten Fassung abhängt. Künftig entweder die ganze Funktion als `create or replace` in die Migration schreiben (lang, aber lesbar) oder die Codes wie oben auslagern.

## Entscheidung

- Schriften bleiben selbst gehostet und werden versioniert mit `immutable` ausgeliefert (S1). Teilmengen sind erlaubt, solange die Lizenzdatei daneben liegt und die Quelle in DESIGN.md steht.
- Drittanfragen beim Seitenaufruf bleiben ausgeschlossen. Die CSP (`default-src 'self'`) ist die technische Grenze, `cookie-inventory.spec.ts` die Prüfung. Neue externe Ressourcen brauchen ein ADR und eine Zeile im Cookie-/Dienste-Inventar (ADR 021).
- `/api/locale` ist freigegeben.
- Grund-Codes bekommen vor dem nächsten neuen Code eine einzige Quelle in der Datenbank (S3).

## Alternativen

- Schriften über `next/font/local`: Das liefert Hash-Dateinamen und `immutable` von selbst. Es erzeugt aber eigene `@font-face`-Regeln mit generierten Familiennamen, und die feste Reihenfolge der `unicode-range` für die Teilmenge wäre schwerer zu steuern. Bleibt eine Option, falls S1 sonst unhandlich wird.
- Teilmenge weglassen und die Sprachnamen als Bild oder in Systemschrift zeigen: schlechter für Barrierefreiheit und Einheitlichkeit.
- Grund-Codes als Postgres-`enum`: Neue Werte sind leicht anzulegen, aber nicht wieder zu entfernen und nicht transaktional mit ihrer Nutzung. Die Domain ist flexibler.

## Folgen

- S1 bis S3 vor M10 erledigen. K1 bis K7 nach Aufwand.
- `docs/WEB-RELEASE.md` (M10) braucht zusätzlich: Header-Prüfung gegen Prod (z. B. `curl -I`), HSTS-`preload`-Entscheidung, `cookie-inventory.spec.ts` mit `QA_BASE_URL` gegen Prod.
- `docs/QA-REPORT.md` bleibt unverändert; dort steht die Abnahme durch QA.

## Umsetzung (2026-11-13, nach dem Review)
- **S1 umgesetzt:** Schriftdateien heißen `*.v1.woff2`; `/static/fonts/:path*` mit `public, max-age=31536000, immutable` (`web/next.config.ts`). Bei jeder Änderung einer Datei die Version hochzählen.
- **S2 umgesetzt:** `58_killed_game.test.sql` führt `resolve_reports` mit `killed_game` aus und prüft SECURITY DEFINER, leeren `search_path` und kein EXECUTE für anon.
- **K1–K5 umgesetzt:** Teilmenge vorgeladen; Kommentar in `globals.css`; Befehl mit `--name-IDs='*'` in `docs/DESIGN.md` (Datei neu geschnitten); Noto Sans und weitere Lizenzen in DESIGN.md; `/api/locale` in der Cookie-Inventur.
- **S3 umgesetzt (2026-11-14):** Domain `public.listing_reject_code` (Migration `20261114100000_listing_reject_code_domain.sql`) für `listings.reject_code` und `private.moderation_notifications.reject_code`; der Check an der Tabelle ist entfernt. `resolve_reports` steht vollständig in dieser Migration und prüft per Cast in `begin … exception when check_violation`, Fehler weiter „Grund fehlt“ mit `{"fields":["code"]}`. Name mit `listing_`, weil `verifications.reject_code` andere Codes hat. `moderation.test.ts` liest die jüngste Definition der Domain aus allen Migrationen statt aus einem festen Dateinamen. Hinweis über der alten Fassung in `qa_m9b_fixes.sql`. Tests: `60_listing_reject_code_domain.test.sql`, `58` prüft die Domain.
- **K6 umgesetzt (2026-11-15):** `Cross-Origin-Opener-Policy: same-origin` und `browsing-topics=()` in der `Permissions-Policy`, für alle Routen mit Basis-Headern (`web/next.config.ts`). Geprüft: keine Popups mit Opener; Links in neuen Tabs sind eigene Seiten oder haben `noopener`. Tests: `auth.spec.ts`, `qa-m8-nachpruefung.spec.ts`. CSP-Berichte und HSTS-`preload` bleiben Entscheidungen für M10 (Liste oben unter „Folgen“, kommt in `docs/WEB-RELEASE.md`, sobald es das Dokument gibt).
- **K7 umgesetzt (2026-11-15):** `switchLocaleHref` (`web/lib/public/locale-switch.ts`) baut die Query aus `filtersFromParams` neu, ohne die Filter, die der Pfad festlegt (Art, Region); `view=map` bleibt, fremde Parameter und `cursor` fallen weg. Gilt für `/api/locale` und die Sprachwahl im Kopf. Eine eigene Pfadgrenze ist nicht nötig: `parsePath` kennt nur kurze Pfade, überlange führen schon zur Startseite (Test). Kein zusätzlicher Code im Browser, `filters.ts` war über `canonicalPath` schon im Bundle.
- **Damit sind S1–S3 und K1–K7 erledigt.** Für M10 bleiben CSP-Berichte und HSTS-`preload` (siehe „Folgen“).
