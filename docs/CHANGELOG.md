# Changelog

Pro Backlog-Schritt ein Eintrag: was geändert wurde, wie man es testet, bekannte Lücken.

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
- 170 pgTAP-Tests unter `supabase/tests/`, dazu ein Meta-Test: jede Tabelle hat RLS und eine Policy, `private` ist gesperrt
- CI `supabase.yml`: `db reset`, `test db`, Prüfung der generierten Typen, `db lint`
- `web/lib/supabase/database.types.ts` (`npm run gen:types`), Server-Client typisiert

### Wie testen
```sh
supabase stop && supabase start      # Neustart nötig: config.toml (Hook, auto_expose) wurde geändert
supabase db reset                    # alle Migrationen inkl. Regionendaten
supabase test db                     # 170 Tests
supabase db lint -s public,private --level warning
cd web && npm run gen:types && git diff --exit-code lib/supabase/database.types.ts
```

### Akzeptanz
- [x] Nutzer A liest keine Nachrichten von B (`06_chat_blocks`)
- [x] Nutzer A liest keine Verifizierungsdokumente von B, weder in der Tabelle (`07_trust_audit`) noch im Bucket (`08_storage`, zusätzlich über die Storage-API geprüft)
- [x] Nutzer A liest keine Entwürfe von B (`04_listings`)
- [x] Migrationen für alle Tabellen aus SPEC 3, Enums, Indizes, Regionen DE/AT und Wildarten
- [x] RLS-Policies mit automatisierten Tests

### Bekannte Lücken
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
