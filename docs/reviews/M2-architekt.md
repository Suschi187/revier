# Architektur- und Sicherheits-Review M2 (Auth und Profil, Web)

Datum: 2026-10-29 · Stand: `25bb981` (M2-Commits `068dc36..25bb981`) · Rolle: Architekt

Geprüft: CLAUDE.md, SPEC v0.4, ADR 002/004/005/008/009/010, CHANGELOG M2, QA-REPORT M1, sowie der Code unter
`web/proxy.ts`, `web/lib/supabase/*`, `web/lib/auth/paths.ts`, `web/lib/services/*`, `web/app/[locale]/{login,auth,welcome,account,terms,privacy}`,
`web/components/{auth,profile}`, `web/lib/security/csp.ts`, `web/next.config.ts`, `web/lib/env.ts`,
`supabase/migrations/20261029102000_legal_acceptances.sql`, `supabase/tests/10_legal.test.sql`, `supabase/config.toml`,
`supabase/templates/*.html`, `.github/workflows/web.yml`, `web/playwright.config.ts`, `web/e2e/*`.
Tests habe ich nicht selbst ausgeführt (nur Lesezugriff). Es gab im Repo noch keine Konvention für Architekt-Reviews; diese Datei begründet `docs/reviews/`.

## Abgleich mit der Planfreigabe und ADR 010

Eine schriftliche Liste meiner Auflagen aus der Planfreigabe liegt im Repo nicht vor. ADR 010 hält die Ergebnisse fest; gegen ADR 010 geprüft:

| Thema (ADR 010) | Umsetzung | Ergebnis |
|---|---|---|
| OTP anfordern/prüfen im Browser (Limits pro Nutzer-IP) | `LoginForm.tsx:30-57` | umgesetzt |
| Gleiche Antwort, keine Enumeration | `LoginForm.tsx:40-44` (nur Netzwerkfehler werden gezeigt) | umgesetzt |
| GET auf `/auth/confirm` prüft nichts, POST per Button | `confirm/page.tsx`, `auth/actions.ts:13-21`, E2E `auth.spec.ts:54-57` | umgesetzt und getestet |
| `noindex`, `Referrer-Policy: no-referrer` auf `/auth/*` | `next.config.ts:40`, `confirm/page.tsx:8-11` | umgesetzt |
| Rücksprungziel per Allowlist | `paths.ts:39-67`, Vitest, E2E `auth.spec.ts:136-144` | umgesetzt, sauber |
| Login-CSRF sichtbar machen | `account/page.tsx:34-35` („Angemeldet als …“) | umgesetzt |
| Proxy: Refresh, Cookies in Request und auf Redirects, `no-store` | `lib/supabase/proxy.ts:25-61`, `proxy.ts:18-28` | umgesetzt, **nicht getestet** (Punkt 3) |
| `getClaims` per JWKS, `getUser` für kritische Aktionen | `services/auth.ts:26-56`; JWKS-Cache ist in auth-js global | umgesetzt |
| „autoritativ prüft das **Layout** der geschützten Routen“ | kein Layout, Prüfung je Seite (`gate.ts`) | **Abweichung** (Punkt 2) |
| `legal_acceptances`, `accept_legal`, `legal_status`, DB-Gate | Migration, `10_legal` (21 Tests), Allowlist in `00_meta` | umgesetzt |
| Apple per GET-Route, hinter Flag | `auth/apple/route.ts`, `auth/callback/route.ts` | umgesetzt, ungetestet (bekannt) |
| Feste CSP ohne Nonce | `csp.ts`, `next.config.ts`, E2E prüft CSP-Verstöße | umgesetzt |
| Cloud-Checkliste | ADR 005 + ADR 010:104-110 | **unvollständig** (Punkt 5) |

Positiv hervorzuheben: Open-Redirect-Schutz (Allowlist statt Blocklist, Parse mit fester Basis-Origin, doppelte Kodierung abgefangen), Fail-closed im DB-Gate (fehlende Einstellung ergibt `false`), `search_path = ''` und saubere Grants auf allen neuen Funktionen, `setting_text` nicht für API-Rollen ausführbar, der CSP-Verstoß-Detektor im E2E und die an GitHub-SHAs gepinnten Actions.

## Befunde

### 1. Mail-Vorlagen übernehmen `preferred_language` ungeprüft in die URL – mittel (hoch, falls nicht escaped)
`supabase/templates/confirmation.html:5,8,13,18,23`, `supabase/templates/magic_link.html:5,8,13,18,23`

`$lang` stammt aus `user_metadata` und kann frei gewählt werden. Bei einer Neuanlage (`signInWithOtp` mit `data`) setzt das sogar ein Dritter, der eine fremde Adresse registriert. Der `else`-Zweig nutzt den Rohwert in `{{ .SiteURL }}/{{ $lang }}/auth/confirm`. Folgen: Unbekannte Werte (z. B. `de-DE` aus iOS) führen auf eine 404. Ob HTML-Sonderzeichen in `$lang` oder `{{ .RedirectTo }}` escaped werden, hängt davon ab, ob GoTrue `html/template` nutzt. Nicht escaped wäre das HTML-Injection in eine echte Mail von unserer Domain (Phishing). `redirect_to` mit `**` in der Allowlist lässt beliebige Suffixe auf der eigenen Origin zu. `RedirectTo` wird außerdem nicht als Query-Wert kodiert, was nur dank `first()` in `confirm/page.tsx:30` und `safeNextPath` harmlos bleibt.

Empfehlung:
- In jedem Zweig die Locale als Literal schreiben (`/en/`, `/cs/`, `/pl/`, `/de/`) und `$lang` nur noch in `eq` verwenden.
- `RedirectTo` als Query-Wert kodieren (z. B. `{{ .RedirectTo | urlquery }}`) und dann prüfen, dass `nextFromRedirectTo` weiter funktioniert.
- E2E-Test, der `signInWithOtp` mit `data.preferred_language = '"><b>x'` und einem `redirectTo` mit `"` aufruft und in Mailpit prüft, dass beides escaped ist bzw. abgelehnt wird.

### 2. Gate je Seite statt im Layout, Abweichung von ADR 010 und Risiko des Vergessens – mittel
`web/lib/services/gate.ts:7-15`, `docs/adr/010-auth-web.md:50`

Die Umsetzung (jede Seite und jede Server Action prüft selbst) ist fachlich sogar besser als ein Layout: Layouts schützen keine Server Actions und rendern bei Client-Navigation nicht neu. ADR und Code widersprechen sich aber. Ab M3 kommen viele neue Seiten und Actions, und ein vergessener Aufruf fällt nur auf, weil RLS dahinter steht.

Empfehlung: ADR 010 an die Umsetzung anpassen („jede Seite und jede Server Action ruft `requireOnboardedUser` auf“). Dazu ein Vitest, der alle `page.tsx` und `actions.ts` unter den `PROTECTED_SECTIONS` findet und prüft, dass sie `requireOnboardedUser` (bzw. für `/welcome` `requireSessionUser`) importieren.

### 3. Cookie-Rotation auf Redirects ist nicht getestet – mittel
`web/lib/supabase/proxy.ts:51-58`, `web/proxy.ts:26-27`

Genau dieser Pfad verliert bei Fehlern still Sessions (Refresh-Token-Rotation). Mit `jwt_expiry = 3600` erreicht kein E2E-Lauf je einen Refresh. Außerdem gibt next-intl bei ungültigen Pfaden `NextResponse.next()` ohne die Request-Header zurück (`next-intl/.../middleware.js:20`). Der Server Component sieht das rotierte Token dann nicht. Das ist harmlos, solange die Response-Cookies übertragen werden, sollte aber bekannt sein.

Empfehlung:
- Vitest für `refreshSession().apply`: Cookies und `Cache-Control: private, no-store` landen auf `NextResponse.redirect` und auf `rewrite`.
- E2E: Access-Token-Cookie durch ein abgelaufenes ersetzen (Refresh-Token behalten), `/de/account` öffnen, angemeldet bleiben, neues `Set-Cookie` mit `no-store` prüfen.

### 4. Nicht-`httpOnly`-Cookies: vertretbar, aber die Begründung in ADR 010 stimmt nicht – mittel (vor Go-live hoch)
`web/lib/supabase/cookie-options.ts:3-8`, `docs/adr/010-auth-web.md:54-56`, `web/lib/security/csp.ts:11`

Im Cookie steht auch das **Refresh-Token**. Ein XSS liefert also eine dauerhafte Übernahme bis zum Logout, nicht nur eine Stunde. Die „kurze JWT-Laufzeit“ kompensiert das nicht. Mit `script-src 'unsafe-inline'` bremst die CSP injizierte Inline-Skripte nicht, und Abfluss per Navigation verhindert sie ohnehin nicht. Für M2 (lokal, ohne UGC-Ausgabe) ist das vertretbar, weil der Browser-Client die Session für OTP braucht.

Auflagen:
- ADR 010 korrigieren: Refresh-Token ist per JS lesbar, Hauptschutz ist XSS-Hygiene.
- XSS-Regeln ab M3, sobald UGC gerendert wird: ESLint-Verbot für `dangerouslySetInnerHTML` (Ausnahmen begründet), JSON-LD in M5 nur mit Escaping von `<`, `>` und `&` (Klassiker: `</script>` in Anzeigentext).
- Cloud: `[auth.sessions] inactivity_timeout` und `timebox` setzen (Pro-Plan) und in die Checkliste aufnehmen.
- Vor M7 bewerten: OTP im Browser mit nicht persistierendem Client, Session per POST an den Server übergeben (`setSession`, dann `httpOnly`), Realtime mit kurzlebigem Access-Token vom Server. Ergebnis als ADR.

### 5. Cloud-Checkliste unvollständig, globales Mail-Limit als DoS-Vektor – hoch (vor Go-live, nicht blockierend für M2)
`docs/adr/010-auth-web.md:104-110`, `supabase/config.toml:207-221`

`email_sent` ist ein **projektweites** Stundenlimit. Weil jeder anonym Mails an beliebige Adressen auslösen kann (`shouldCreateUser: true`), kann ein Angreifer ohne Captcha das Kontingent leeren, und dann kann sich niemand mehr anmelden. Er kann außerdem Fremde mit Mails bombardieren, was die Reputation der Absenderdomain schädigt.

Die Checkliste ergänzen um:
- Rate-Limits `email_sent`, `sign_in_sign_ups`, `token_verifications`, `token_refresh` (Werte festlegen)
- `max_frequency = 60s`, `otp_length` (siehe Punkt 6)
- Session-Timeouts (Punkt 4)
- Site URL und Redirect-URLs **je Umgebung** (stage/prod)
- SPF/DKIM/DMARC für die Absenderdomain
- Apple-Provider mit **beiden** Client-IDs (Web: Services ID, iOS: Bundle ID für `signInWithIdToken`)
- JWT-Signing-Keys: Legacy-HS256 nach der Migration widerrufen, sonst fällt `getClaims` still auf `getUser` zurück

Captcha: Supabase unterstützt nur hCaptcha und Turnstile. Beide brauchen CSP-Ausnahmen (`script-src`, `frame-src`) und eine Datenschutzbewertung (Drittlandtransfer, Consent oder berechtigtes Interesse). Dafür vor Go-live ein eigenes ADR.

### 6. OTP-Länge und verteiltes Durchprobieren – mittel (vor I1 entscheiden)
`supabase/config.toml:219,243-245`, SPEC 4.4

6 Ziffern, 10 Minuten, Limit nur pro IP (30 je 5 min). Mit vielen IPs (Botnetz) und erneut ausgelösten Codes ist eine gezielte Kontoübernahme denkbar. Empfehlung: `otp_length = 8` prüfen. Das ändert SPEC 4.4 und die iOS-UI (I1), deshalb **vor I1** entscheiden. Dazu in M10 ein Monitoring auf fehlgeschlagene Verifizierungen je Adresse.

### 7. Fremd registrierte und nie bestätigte Konten – mittel
`supabase/migrations/20261029101100_profiles_privacy.sql:14-21`, `docs/adr/008-retention-loeschung.md`

Jeder kann für eine fremde Adresse ein unbestätigtes Konto samt Profil erzeugen und dabei `display_name` in den Metadaten setzen. Das Onboarding zeigt dem echten Inhaber diesen Namen als Vorbelegung (`welcome/page.tsx:39-40` nimmt `profile.displayName`, wenn es nicht der Platzhalter ist). Nie bestätigte Konten bleiben unbegrenzt liegen (Datensparsamkeit).

Empfehlung:
- `handle_new_user` ignoriert `display_name` aus den Metadaten. Nur der Apple-Name bleibt als Vorbelegung über `metadataName`.
- ADR 008 um einen Löschjob für unbestätigte Konten nach N Tagen ergänzen (M9, Frist in `app_settings`).

### 8. Sign in with Apple: Token-Widerruf bei Account-Löschung fehlt im Design – mittel (Entscheidung jetzt, Umsetzung M9/I6)
`web/app/[locale]/auth/callback/route.ts:13`, `web/lib/services/auth.ts:83-87`

Die App-Store-Regel 5.1.1(v) verlangt, dass bei einer Account-Löschung von Apple-Nutzern die Apple-Tokens über die REST-API widerrufen werden. Supabase speichert `provider_refresh_token` nicht dauerhaft.

Empfehlung (ADR, vor M9): Bei der Löschung erneut über Apple anmelden lassen (Web: OAuth, iOS: `ASAuthorization` mit `authorizationCode`). Eine Edge Function tauscht den Code ein und widerruft das Token. So muss kein Token gespeichert werden. Web und iOS verhalten sich gleich.

### 9. Re-Consent: Signalisierung an die Clients und Rechtstext-Versionierung – mittel
`supabase/migrations/20261029102000_legal_acceptances.sql:50-66,90-111`, `web/app/[locale]/terms/page.tsx:10-19`

- Ab M3/M7 sperrt eine neue Version sofort Inserieren und Chat. Eine RLS-Ablehnung (`42501`) ist für die Clients nicht von anderen Ablehnungen zu unterscheiden. iOS (I1) braucht dieselbe Logik wie das Web.
  Empfehlung: Clients fragen `legal_status()` beim Start bzw. im Vordergrund ab und nach jedem `42501`. Schreibende RPCs ab M3 werfen bei fehlender Zustimmung einen eigenen Fehler (z. B. `errcode 'P0001'`, `hint 'legal_consent_required'`). Beides in ADR 010 festhalten.
- Die Zustimmung bezieht sich auf `2026-10-draft`, aber die Seite zeigt weder die Version, noch ist der Text je Version archiviert. Ein Nachweis „welchem Text wurde zugestimmt“ ist so nicht möglich.
  Empfehlung: Version auf `/terms` und `/privacy` anzeigen, Texte je Version unveränderlich ablegen (Repo oder Tabelle) und mit dem Anwalt klären, ob eine neue Datenschutz-Version überhaupt sperren darf (Information nach Art. 13, keine Einwilligung).
- Wird ab M3 `has_accepted_current_legal()` in Policies genutzt, immer als `(select private.has_accepted_current_legal())`, damit es pro Statement nur einmal läuft.

### 10. Mail-Sprache als doppelter Schreibvorgang im Client – mittel (Plattformparität)
`web/lib/services/profile.ts:56-57`

`auth.updateUser({ data })` wird nach dem Profil-Update aufgerufen, und Fehler werden still verworfen (CLAUDE.md: nie stumm schlucken). iOS müsste das genauso nachbauen, sonst laufen Profil und Mailsprache auseinander.

Empfehlung: Ein `security definer`-Trigger auf `profiles.preferred_language` synchronisiert `auth.users.raw_user_meta_data` (`search_path = ''`, mit pgTAP-Test), oder später der Send-Email-Hook (SPEC 7.11) liest `profiles`. Danach den Client-Aufruf entfernen.

### 11. Impressum, Datenschutz und Nutzungsbedingungen nicht von jeder Seite erreichbar – mittel (vor dem ersten Deploy)
`web/app/[locale]/layout.tsx:36-42`

CLAUDE.md verlangt, dass Impressum und Datenschutz von jeder Seite erreichbar sind. Es gibt keinen Footer und keine Impressum-Seite. `/terms` und `/privacy` sind nur aus `/welcome` verlinkt. Empfehlung: Footer im Layout mit Impressum (Platzhalter), Datenschutz und Nutzungsbedingungen in 4 Sprachen. Das ist mit wenig Aufwand jetzt erledigt.

### 12. Fehlende API-Tests für Storage und Auth (ADR 009) – mittel (vor M3)
`docs/adr/009-rls-tests-supabase-ci.md:18`, QA-REPORT M1 „Vorgeschlagene Tests“

ADR 009 kündigt JS-Tests gegen die lokale API ab M2 an. Gekommen sind nur Playwright-Flows. Vor dem Foto-Upload in M3 fehlen damit die Storage-Prüfungen (Signed URL, `list`, `copy`/`move`, Upsert, Pfadtricks) und die PostgREST-Prüfungen (`Accept-Profile: private`, Embeddings, `count=exact`).

Empfehlung: In M3 als Vitest-Suite gegen die lokale Supabase anlegen (nur publishable Key und Test-Nutzer per OTP über Mailpit, kein `service_role` in den Tests).

### 13. CHANGELOG nennt E2E für Re-Consent, den es nicht gibt – niedrig
`docs/CHANGELOG.md:44`, `web/e2e/auth.spec.ts`

Re-Consent ist nur per pgTAP (`10_legal.test.sql:47-51`) geprüft. Empfehlung: CHANGELOG korrigieren oder einen E2E ergänzen, der die Version per `psql` in einem `globalSetup` hochsetzt (lokale DB-URL, kein Secret).

### 14. CI-Job `e2e`: Robustheit – niedrig
`.github/workflows/web.yml:66-98`, `web/playwright.config.ts:10-14`

- Secrets: in Ordnung. Nur der lokale publishable Key wird übernommen, nicht der `service_role`-Key aus `supabase status`.
- Traces werden erzeugt, aber nicht hochgeladen. Empfehlung: `actions/upload-artifact` (per SHA gepinnt) mit `if: failure()` für `web/test-results`.
- Alle Tests laufen von einer IP. Mit wachsender Suite (M3+) greifen `sign_in_sign_ups` und `token_verifications` (30 je 5 min), dann werden die Läufe zufällig rot. Empfehlung: lokal höhere Limits in `config.toml` (nur lokal, Cloud-Werte in der Checkliste) oder einen Login-Helfer, der pro Datei einmal anmeldet und den `storageState` wiederverwendet.
- `supabase start` und das Herunterladen der Images kosten bei jedem Lauf Zeit. Bei Bedarf einen Docker-Image-Cache nachrüsten.

### 15. Veraltete Version im Onboarding führt in eine Schleife – niedrig
`web/components/profile/WelcomeForm.tsx:31-32`, `web/app/[locale]/welcome/actions.ts:34-36`

Bei `outdated` bleiben die versteckten Versionsfelder alt, und jede erneute Absendung scheitert, bis der Nutzer die Seite neu lädt. Empfehlung: Bei `outdated` per `redirect` auf `/welcome?next=…` umleiten, damit die Versionen neu geladen werden.

### 16. Kleinigkeiten – niedrig
- `ConfirmForm.tsx:21`: „Zurück zum Login“ verliert `next`.
- Token im Query-String landet in Access-Logs des Hosters. In M10 Logging für `/*/auth/*` ohne Query-String konfigurieren (SPEC 8: Logging ohne personenbezogene Inhalte).
- Hinter CDN oder Reverse-Proxy in M10 die Origin-Prüfung der Server Actions verifizieren (`serverActions.allowedOrigins` nur falls nötig).
- `AuthNav` im Root-Layout macht jede Seite teilweise dynamisch. Vor M5 (SEO-Seiten, Core Web Vitals) bewerten, ob die Anzeige clientseitig erfolgen soll (das Cookie ist ohnehin lesbar).
- Der Proxy-Matcher schließt `/api/` aus (`proxy.ts:35-36`). Künftige Route Handler unter `/api` bekommen keinen Session-Refresh und müssen selbst prüfen. In ADR 010 vermerken.

## Offene Punkte aus M1

- **Architekt 9 (Performance `is_active_user` je Zeile):** weiter offen, nicht M3-blockierend. Vor M5 mit realistischen Datenmengen messen (`explain analyze` auf die öffentliche Anzeigen-Policy). Neue Policies in M3 nutzen Initplan-Wrapping (`(select …)`).
- **Architekt 10 (Herausmitteln über mehrere Anzeigen):** muss **in M3** umgesetzt werden (ADR 006). Dazu gehören HMAC(Secret, Besitzer + gerundeter Punkt), das Secret in Vault (lokal per Seed bzw. `config.toml`, Cloud-Checkliste), pgTAP-Tests „gleicher Besitzer und Punkt ergibt gleichen Versatz, anderer Besitzer einen anderen“ und der Nachweis, dass kein Statement-Logging Parameter protokolliert.

## Vorbereitung M3 (zusätzlich)

- **EXIF/GPS in Fotos – hoch:** Fotos aus dem Revier tragen oft GPS-Koordinaten. Das unterläuft den Standortschutz (CLAUDE.md, SPEC 3.3) komplett. Das M3-Planungs-ADR muss festlegen: Neu-Kodierung im Client (Canvas) entfernt die Metadaten, **und** der Server prüft oder bereinigt sie (z. B. Upload in einen privaten Eingangs-Bucket, Edge Function bereinigt und verschiebt). Das gilt für Web und iOS (I4) gleich. E2E-Test mit einem JPEG mit GPS-Tag.
- `PROTECTED_SECTIONS` (`web/lib/auth/paths.ts:5`) um die Inserieren- und „Meine Anzeigen“-Pfade erweitern, mit Vitest.
- DB-Gate in Insert-Policy und Status-Trigger von `listings` einbauen, mit eigenem Fehlersignal (Punkt 9), pgTAP für „ohne Zustimmung kein Entwurf, kein Absenden“.
- Pflichtfelder je Anzeigenart **in der DB** prüfen (Trigger oder Check), nicht nur per Zod, damit iOS (I4) dieselben Regeln bekommt.
- Rate-Limit für das Anlegen von Anzeigen (SPEC 8) in der DB.
- `price_minor` als Ganzzahl mit Plausibilitätsgrenzen je Währung.

## Empfehlung

**M2 abnehmen: ja, mit Auflagen.** Es gibt keinen blockierenden Befund. Die Akzeptanzkriterien sind erfüllt, die Kernentscheidungen (OTP im Browser, POST-Bestätigung, Allowlist für Rücksprungziele, DB-Gate, RLS) sind sauber umgesetzt. Das System läuft bisher nur lokal.

**Vor M3 erledigen:**
1. Punkt 1: Mail-Vorlagen mit Locale-Literalen, `RedirectTo` kodiert, Escaping-Test
2. Punkt 2: ADR 010 an die Gate-Konvention anpassen, Vitest-Guard für geschützte Seiten und Actions
3. Punkt 3: Tests für die Cookie-Rotation (Vitest und E2E)
4. Punkt 4: ADR-Korrektur (Refresh-Token) und ESLint-Verbot für `dangerouslySetInnerHTML`
5. Punkt 9: Signalisierung der fehlenden Zustimmung an die Clients in ADR 010 festlegen
6. Punkt 12: API-Test-Suite für Storage und PostgREST mindestens angelegt (spätestens mit dem Foto-Upload in M3)
7. M1-Punkt 10 und EXIF/GPS als Teil des M3-Plans (ADR), Freigabe durch den Architekten

**Vor dem ersten Deploy bzw. der Cloud-Einrichtung:** Punkte 5 (Checkliste, Captcha-ADR), 7, 10, 11, 14 und die Session-Timeouts aus Punkt 4.
**Vor I1:** Punkt 6 (OTP-Länge), Punkt 9 im iOS-Plan.
**Vor M9/I6:** Punkt 8 (Apple-Widerruf, ADR).
**Niedrig, bei Gelegenheit:** Punkte 13, 15, 16.
