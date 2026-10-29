# Changelog

Pro Backlog-Schritt ein Eintrag: was geändert wurde, wie man es testet, bekannte Lücken.

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
