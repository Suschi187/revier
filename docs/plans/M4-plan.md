# Plan M4 – Admin-Bereich (Freigabe)

Stand: 2026-10-30, Architekt-Review eingearbeitet (Abschnitte 10 und 11 gehen den Abschnitten 3–8 vor).

## 0. Auftrag und Akzeptanz (SPEC 6)
- `/admin` mit Admin-Rolle und 2FA, Freigabe/Ablehnung inkl. Grund, Audit-Log
- **Akzeptanz:**
  - a) Freigegebene Anzeige wird sichtbar (Status `active`, für anon über RLS lesbar; öffentliche Seiten kommen in M5, Nachweis per API/pgTAP)
  - b) Abgelehnte Anzeige zeigt den Grund in „Meine Anzeigen“
  - c) Nicht-Admins erhalten 403 (echter HTTP-Status)

## 1. Entscheidungen des Nutzers (2026-10-30)
1. **Grund:** feste Vorlagen (in der Sprache des Besitzers angezeigt) plus optionaler Freitext.
2. **„Bearbeitung anfordern“** gehört zu M4: `pending_review → draft` mit Grund (die DB kann das schon).
3. **2FA:** TOTP mit Authenticator-App im Web (Supabase MFA), Einrichtung beim ersten Öffnen von `/admin`.
4. **Admins ernennen:** per UI im Admin-Bereich (nicht nur SQL). Der erste Admin entsteht per SQL (Runbook).

## 2. Umfang
- **Drin:** Zugang `/admin` (Rolle + aal2, sonst 403), TOTP einrichten und bestätigen, Warteschlange „Anzeigen zur Freigabe“ mit Detailansicht (alle Felder, Fotos, PLZ/Ort, Wildarten, Waffenbegriff-Hinweise), Entscheidungen Freigeben / Bearbeitung anfordern / Ablehnen, Audit-Log ansehen (Filter, Paging), Admins ernennen und entziehen, Grund in „Meine Anzeigen“ in der Sprache des Besitzers.
- **Nicht drin (spätere Schritte):** Verifizierungen (Jagdschein), Meldungen, Nutzer suchen/sperren, Entfernen aktiver Anzeigen (Meldungs-Workflow), Benachrichtigung per Mail/Push an den Besitzer (M8; bis dahin sieht er den Status im Konto), iOS (Admin ist laut SPEC 5 nur Web; iOS zeigt den Grund ab I4).

## 3. Datenmodell (Migrationen)
### 3.1 `moderation_reasons` (Grund als Vorlage)
- Neue Spalte `listings.reject_code text null` mit Check auf eine feste Liste: `incomplete`, `wrong_category`, `weapons`, `prohibited_content`, `duplicate`, `contact_in_text`, `implausible`, `other`. Die Liste spiegelt eine TS-Konstante; ein Meta-Test vergleicht beide (wie Attribut-Fixtures).
- `reject_reason` bleibt der **optionale Freitext** (1–1000, `trim_all`). Bei `other` ist der Freitext Pflicht.
- Guard: Ablehnen und Zurückgeben brauchen einen **neuen** `reject_code` (statt heute neuen `reject_reason`). Freigabe leert beide. Der Besitzer setzt keines der beiden (wie heute).
- Bestand: bisherige Ablehnungen mit nur `reject_reason` → `reject_code = 'other'` (Datenmigration; lokal nur Testdaten).
- Audit-Trigger schreibt `code` und `reason` in `details`.
- Grund bleibt beim Zurückgeben am Entwurf sichtbar, bis der Besitzer erneut absendet (heute schon: Owner `draft → pending_review` leert den Grund; prüfen und testen).

### 3.2 Moderation per RPC statt Roh-UPDATE
- `public.moderate_listing(p_listing_id uuid, p_decision text, p_code text default null, p_note text default null)` – `security invoker`, prüft `private.is_admin()`, setzt Status und Grund in **einem** UPDATE, damit Guard, Bereitschaftsprüfung (Freigabe verlangt verarbeitete Fotos, A1) und Audit unverändert greifen. Entscheidungen: `approve` (→ `active`), `request_changes` (→ `draft`), `reject` (→ `rejected`). Nur aus `pending_review`, sonst `42501`/`P0002`-artiger Fehler mit klarem Code (Konflikt: zwei Admins gleichzeitig → der zweite bekommt „bereits entschieden“).
- Vorteil gegenüber direktem UPDATE: ein Vertrag für Web (und später iOS/Tools), Konfliktbehandlung an einer Stelle, Spaltenrechte bleiben eng.
- Ein Admin moderiert nie die eigene Anzeige (heute: Admin am eigenen Objekt = Besitzer, QA M3 F1) → RPC liefert `42501`.

### 3.3 Admins ernennen (`private.user_roles` per RPC)
- `public.grant_admin(p_user_id uuid)` und `public.revoke_admin(p_user_id uuid)` – `security definer`, nur für `private.is_admin()` (aal2), schreiben Audit (`role.granted` / `role.revoked`).
- Schutz:
  - Letzten Admin nicht entziehen (`23514`); sich selbst entziehen nur, wenn ein anderer Admin bleibt.
  - Nur bestehende, nicht gesperrte Konten.
  - Rate-Limit (z. B. 10 Rollenänderungen je Admin in 24 h) gegen Missbrauch eines gekaperten Admin-Kontos.
- **Suche nach dem Konto:** per exakter E-Mail-Adresse über RPC `public.admin_find_user(p_email text)` (nur Admins, liefert id, Anzeigename, ob schon Admin; keine Teiltreffer, kein Auflisten aller Nutzer).
- Wirkung: Rechte sofort (Policies lesen `user_roles`), UI-Claim `app_role` erst beim nächsten Token (ADR 005).
- Neuer Admin muss TOTP einrichten, bevor er etwas darf (aal2).

### 3.4 Audit-Log lesen
- Gibt es schon (`audit_log_select_admin`). Neue Aktionen: `role.granted`, `role.revoked`, `listing.draft` (Bearbeitung anfordern) bleibt wie heute.
- Anzeige mit Akteursname (über `profiles_select_admin`), Filter nach Aktion und Ziel-ID, Paging per Keyset (`created_at, id`).

### 3.5 Lesen für die Detailansicht
- Bestehende Policies reichen (Admin mit aal2 liest Anzeigen, Orte, verarbeitete Fotos und Wildarten über `listings`-RLS). pgTAP-Nachweis wird ergänzt, inklusive: **unverarbeitete** Fotos sieht der Admin nicht (Freigabe ist dann ohnehin gesperrt), Admin ohne aal2 sieht nichts.
- Fotos im privaten Bucket über signierte URLs (kurz, 10 min).

## 4. Web
### 4.1 Zugang und 2FA
- `next.config.ts`: `experimental.authInterrupts = true`, Datei `app/[locale]/forbidden.tsx` (lokalisiert, `noindex`).
- Admin-Seiten rendern **blockierend** (`instant = false`), sonst ist der 200-Status schon gesendet, bevor `forbidden()` greift (Lehre aus QA M3 F1).
- Gate `requireAdmin()` in `lib/services/admin.ts`:
  - nicht angemeldet → Login mit Rücksprung
  - angemeldet, keine Rolle → `forbidden()` (403)
  - Rolle, aber `aal1` → `/admin/mfa` (einrichten, wenn kein Faktor, sonst Code eingeben)
  - Rolle und `aal2` → weiter
  - Die Rolle wird serverseitig geprüft (`has_admin_role()`/`is_admin()` per RPC bzw. Query), nicht über den Claim.
- `supabase/config.toml`: `[auth.mfa.totp] enroll_enabled = true, verify_enabled = true`. Cloud-Checkliste (ADR 005) hat den Punkt schon.
- `/admin/mfa`: Faktor anlegen (`mfa.enroll`, QR-Code als SVG von Supabase, zusätzlich das Secret als Text zum Abtippen), dann `challenge`/`verify`. Code-Eingabe funktioniert ohne JS (Server Action); die Einrichtung selbst braucht kein Client-JS, weil der QR als `<img src="data:image/svg+xml…">` kommt.
- Fehler und Sperren lokalisiert; nach 2FA wird die Session auf `aal2` angehoben (Supabase setzt neue Cookies, Proxy erneuert).

### 4.2 Seiten
- `/admin` – Übersicht: Anzahl in Prüfung, Links.
- `/admin/listings` – Warteschlange `pending_review`, älteste zuerst (Wartezeit sichtbar), Paging.
- `/admin/listings/[id]` – Detail mit allen Feldern in der Sprache des Admins (Feldnamen) und dem Inhalt in Originalsprache, Fotos, PLZ/Ort, Wildarten, Waffenbegriff-Hinweise (`listing_content_hints`), Besitzer (Anzeigename, Konto seit, Anzahl früherer Ablehnungen), Formular „Entscheidung“: Freigeben / Bearbeitung anfordern / Ablehnen, Grund-Vorlage (Pflicht bei den beiden letzten), Freitext optional (Pflicht bei `other`).
- `/admin/audit` – Audit-Log mit Filter.
- `/admin/admins` – Liste der Admins, ernennen per exakter E-Mail, entziehen (mit Bestätigungsschritt ohne JS: `<details>` wie „Entwurf löschen“).
- Alle Seiten `noindex`, nicht in der Sitemap (M5), Navigation „Admin“ im Header nur bei Rolle (Claim nur als UI-Hinweis).

### 4.3 „Meine Anzeigen“ und Assistent
- Grund als Vorlage in der Sprache des Besitzers plus Freitext („Hinweis der Moderation: …“), bei `rejected` und bei zurückgegebenen Entwürfen; im Assistenten oben ein Hinweis mit dem Grund, solange er besteht.

### 4.4 Texte
- Neue Namespaces `Admin` (de/en/cs/pl) und `Moderation.reasons` (Vorlagen, Besitzer-Sicht). Glossar: Freigeben, Bearbeitung anfordern, Ablehnen, Gründe.

## 5. Tests
- **pgTAP:**
  - `moderate_listing`: Matrix (Admin aal2 / aal1 / Nicht-Admin / Besitzer-Admin), alle drei Entscheidungen, nur aus `pending_review`, Code-Pflicht, `other` ohne Text, Konflikt zweite Entscheidung, Bereitschaft bei Freigabe (unverarbeitetes Foto, fehlende Pflichtfelder), Audit-Einträge mit Code.
  - `grant_admin`/`revoke_admin`/`admin_find_user`: nur aal2-Admin, letzter Admin, gesperrtes Konto, Rate-Limit, Audit, keine Teiltreffer.
  - Admin-Lesbarkeit der Detaildaten (3.5).
  - Meta: Allowlist der public RPCs um die neuen Funktionen; `reject_code`-Liste = TS-Konstante.
- **Integration (PostgREST):** Freigabe macht die Anzeige für anon lesbar (Akzeptanz a), Ablehnung zeigt Code/Grund dem Besitzer (b), Fremde sehen beides nicht.
- **Vitest:** Gate-Logik (Zustände → Ziel), Formular-Validierung der Entscheidung.
- **E2E:**
  - Nicht-Admin auf `/de/admin` → Status 403 (Akzeptanz c); Admin ohne 2FA → MFA-Seite.
  - Admin-Flow: TOTP einrichten (Code im Test aus dem Secret berechnen, siehe 7), Warteschlange, Freigeben → Besitzer sieht „Aktiv“; Ablehnen mit Vorlage + Text → Besitzer sieht Grund auf Polnisch (Sprache des Besitzers); Bearbeitung anfordern → Entwurf mit Hinweis im Assistenten.
  - Admin ernennen per E-Mail → zweites Konto sieht „Admin“ nach 2FA; letzten Admin entziehen scheitert.
  - Audit-Log zeigt die Entscheidungen.
  - Aufräumen über `e2e/cleanup.ts` (inklusive Rollen und MFA-Faktoren).

## 6. Doku
- ADR 014 „Moderation und Admin-Verwaltung“ (RPC-Vertrag, Grund-Codes, Admin-Ernennung, Konflikte), ADR 005 ergänzt (UI-Ernennung, TOTP lokal an, Runbook erster Admin), SPEC v0.6 (3.1 `reject_code`, 5 Umfang M4), Glossar, CHANGELOG.

## 7. Neue Abhängigkeiten
- **Keine für die App.** QR-Code liefert Supabase als SVG.
- **Nur Tests:** TOTP-Code im E2E erzeugen. Vorschlag: kleine eigene Funktion mit `node:crypto` (HMAC-SHA1 nach RFC 6238, ca. 20 Zeilen) statt eines Pakets.

## 8. Commits (je grün)
1. ADR 014, Plan, SPEC v0.6 (Entwurf), Glossar-Begriffe
2. Migration `reject_code` + Guard-Anpassung + Datenmigration; pgTAP (Status-Matrix angepasst)
3. Migration RPC `moderate_listing`; pgTAP
4. Migration Admin-Verwaltung (`grant_admin`, `revoke_admin`, `admin_find_user`, Rate-Limit, Audit); pgTAP; Meta-Allowlist
5. Integration: Freigabe/Ablehnung/Ernennung über PostgREST
6. Web: `authInterrupts`, `forbidden.tsx`, Gate `requireAdmin`, TOTP lokal an, `/admin/mfa`
7. Web: Warteschlange und Detail mit Entscheidung
8. Web: Grund in „Meine Anzeigen“ und im Assistenten
9. Web: Audit-Log
10. Web: Admins ernennen/entziehen
11. E2E (TOTP-Helfer, Flows, 403)
12. CHANGELOG, QA-Hinweise

## 9. Offene Fragen an den Architekten
- RPC `moderate_listing` als `security invoker` (Rechte über Policies + Guard) oder `definer`? Vorschlag invoker, damit Guard/RLS die einzige Wahrheit bleiben.
- Rate-Limit und „letzter Admin“ für Rollenänderungen ausreichend? Braucht Ernennen eine zweite Bestätigung (z. B. frischer TOTP-Code, „step-up“)?
- `admin_find_user` per exakter E-Mail: vertretbar (Datensparsamkeit), oder lieber per Nutzer-ID aus dem Audit-Log/Anzeigen-Detail?
- Reicht `forbidden()` mit blockierendem Rendern für den 403, oder zusätzlich im Proxy für `/admin/*` ohne Rolle (frühe Ablehnung, kein Rendern)?

## 10. Architekt-Review

Stand: 2026-10-30. Geprüft gegen CLAUDE.md, SPEC 5/6, ADR 005, 010, 013 und die Migrationen `foundation`, `listings`, `review_medium`, `trust_audit`, `listing_rules`, `listing_content_hints`, `listing_whitespace` sowie `web/proxy.ts`, `web/lib/auth/paths.ts`, `web/lib/security/csp.ts`, `web/next.config.ts`.

**Ergebnis: Freigabe unter Auflagen.** Mit der Umsetzung darf begonnen werden, sobald B1 bis B3 in Plan und ADR 014 eingearbeitet sind (Commit 1). Die A-Auflagen sind Teil der Definition of Done von M4.

### 10.1 Antworten auf die offenen Fragen (Abschnitt 9)
1. **`moderate_listing`: `security invoker`, verbindlich.** Ein Definer-RPC (Eigentümer `postgres`) macht `private.is_server()` (`current_user in ('postgres', …)`) wahr. Der Guard springt dann vor allen Moderationsregeln zurück: kein Vier-Augen-Prinzip, keine Übergangsprüfung, und vor allem setzt er kein `expires_at`. Die Anzeige wäre `active` ohne Ablaufdatum und für anon trotzdem unsichtbar (`expires_at > now()`). Die Bereitschaftsprüfung liefe dagegen weiter, weil `is_server_caller()` den JWT-Claim liest. Die Pfade wären also uneinheitlich. Für den Versions-Vergleich (B1) braucht der Invoker-RPC genau einen kleinen Definer-Helfer, sonst nichts.
2. **Rate-Limit und „letzter Admin“ reichen nicht.** Ein Step-up ist Pflicht (B2). Begründung: Die Session-Cookies sind nicht `httpOnly` und enthalten das Refresh-Token (ADR 010). Ein XSS oder ein gestohlenes Gerät liefert damit eine dauerhafte `aal2`-Session, und ohne Step-up kann diese Session weitere Admins anlegen, die der Angreifer selbst kontrolliert (eigenes TOTP). Die Rechte blieben auch nach dem Entzug des gekaperten Kontos bestehen.
3. **`admin_find_user` per exakter E-Mail ist vertretbar.** Admins sind vertrauenswürdig, und eine Ernennung braucht ohnehin einen Kontaktweg außerhalb der Plattform, über den die Adresse bekannt ist. Bedingungen in A9. Eine Ernennung per Nutzer-ID aus Anzeigen-Detail oder Audit-Log wird **nicht** angeboten: Sie macht beliebige Inserenten zu naheliegenden Kandidaten per Klick und erhöht die Fehlbedienung. Nur E-Mail.
4. **Proxy zusätzlich, ja (A1).** `forbidden()` bleibt die autoritative Prüfung in jeder Seite und jeder Server Action. Den verlässlichen HTTP-Status liefert aber der Proxy, unabhängig von Streaming, `cacheComponents` und `partialPrefetching`. Die Entscheidung im Proxy fällt per RPC an die DB, **nicht** über den Claim `app_role`: Ein frisch ernannter Admin hat den Claim bis zum nächsten Token (bis 1 h) nicht und käme sonst nicht bis `/admin/mfa`. Fehlt in der Cloud der Access Token Hook, wären außerdem alle Admins ausgesperrt.

### 10.2 Blockierend
- **B1 Freigabe nur für den gesehenen Stand.** Der Besitzer darf eine Anzeige in `pending_review` weiter ändern, ohne dass sich der Status ändert (Guard: Inhaltsänderungen in der Prüfung bleiben `pending_review`; Kinder-Guard ebenso). Öffnet ein Admin das Detail und der Besitzer tauscht danach Text, Fotos oder Ort aus, gibt der Admin ungesehene Inhalte frei. Das umgeht die Moderation.
  - `moderate_listing` bekommt einen Pflichtparameter `p_expected_version text`.
  - Definer-Helfer `private.listing_review_version(p_listing_id uuid) returns text`: liefert `encode(private.listing_content_hash(id), 'hex')` nur, wenn `private.is_admin()` und der Aufrufer nicht der Besitzer ist, sonst `null`. Lesbar über eine öffentliche, read-only RPC `admin_listing_version(p_listing_id)` für die Detailseite (Admins sehen die PLZ ohnehin; für alle anderen ist das Ergebnis `null`, also kein Orakel). Rechte: `revoke … from public, anon`; Meta-Allowlist ergänzen.
  - Ablauf im RPC: `select … for update` auf die Anzeige (der Kinder-Guard sperrt dieselbe Zeile, das serialisiert), Status prüfen, Version vergleichen, dann das eine UPDATE. Abweichung → neuer Code `RV004` (`listing_changed`), Status nicht mehr `pending_review` → `RV003` (`already_decided`), nicht sichtbar oder unbekannt → `P0002`. Codes in die Vertragstabelle von ADR 014 (für iOS-Tools später gleich).
  - Die Detailseite liest die Version **vor** den Inhalten (sonst kann sie zu einem neueren Stand passen als dem angezeigten) oder beides in einer RPC. Gilt für alle drei Entscheidungen.
  - Tests: pgTAP (Besitzer ändert Beschreibung, Foto, Wildart, Ort nach Lesen der Version → `RV004`; gleiche Version → Erfolg), E2E optional.
- **B2 Kompensation für die Admin-Ernennung per UI** (Nutzer-Entscheidung 4 steht, deshalb sind diese Gegenmaßnahmen Pflicht):
  - **Step-up:** `grant_admin` und `revoke_admin` verlangen eine TOTP-Bestätigung der letzten 10 Minuten. Prüfung in der DB über `auth.jwt() -> 'amr'` (Eintrag `method = 'totp'` mit `timestamp >= now() - 10 min`), nicht nur im Web. Das Web holt dazu im Formular einen frischen Code und ruft `mfa.challenge`/`verify` auf, bevor es die RPC aufruft. Fehler `RV005` (`step_up_required`).
  - **Rate-Limit enger:** höchstens 3 Rollenänderungen je Admin in 24 h und 10 insgesamt in 24 h (Werte in `private.app_settings`). Gezählt über `audit_log` (`role.*`), serialisiert per `pg_advisory_xact_lock`.
  - **Karenz:** Ein Admin darf erst 7 Tage nach seiner eigenen Ernennung Rollen ändern (`app_settings`). Damit kann ein gekapertes Konto keine Kette eigener Admins aufbauen, die sofort weiter ernennen. Der erste Admin (Runbook) ist per Datum der Rolle ebenso betroffen; das Runbook setzt `created_at` deshalb bewusst zurück oder nennt die Wartezeit.
  - **Letzter Admin, nebenläufig:** `revoke_admin` sperrt per `pg_advisory_xact_lock(hashtext('user_roles'))`, bevor gezählt wird. Sonst entziehen sich zwei Admins gleichzeitig gegenseitig und es bleibt keiner. „Letzter Admin“ zählt nur Konten, die aktiv sind (`is_active_user`).
  - **Audit per Trigger auf `private.user_roles`** (insert/delete) statt nur im RPC, damit auch Runbook-SQL und Dashboard-Änderungen protokolliert werden (`actor_id` dann `null`, `details.via = 'sql'`). `target_type = 'profile'`, `target_id = user_id`.
  - Runbook „Admin-Konto kompromittiert“ in ADR 005: Rolle per SQL entziehen, MFA-Faktoren und Sessions des Kontos löschen (`auth.mfa_factors`, `auth.sessions`), Audit-Log der letzten Tage auf `role.*` und Moderationsentscheidungen prüfen.
- **B3 MFA-Einrichtung nicht per GET.** `mfa.enroll` beim Rendern von `/admin/mfa` legt bei jedem Aufruf, Reload und Link-Prefetch einen neuen, unbestätigten Faktor an (Supabase begrenzt die Zahl der Faktoren je Konto, danach ist die Einrichtung blockiert).
  - Einrichtung startet per Server Action (POST, Button „Authenticator einrichten“). Davor werden unbestätigte TOTP-Faktoren des Kontos entfernt (`mfa.unenroll` ist für unbestätigte Faktoren bei `aal1` erlaubt).
  - Das Secret und der QR-Code erscheinen nur in der Antwort dieser Action, nie in URL, Logs, Cookies oder einem Cache (`Cache-Control: no-store`). Zur Bestätigung wird nur die `factorId` zurückgegeben, nie das Secret.
  - Ein Konto mit bestätigtem Faktor sieht keine Einrichtung mehr, nur die Code-Eingabe.

### 10.3 Auflagen
- **A1 403 im Proxy und im Gate.**
  - `proxy.ts`: Für `/{locale}/admin` und Unterpfade ohne Session → Login-Redirect (wie heute). Mit Session → RPC `admin_access()` (A2). Ohne Rolle → `NextResponse.rewrite` auf eine statische, lokalisierte 403-Seite mit Status 403, `X-Robots-Tag: noindex`, `Cache-Control: private, no-store`. Mit Rolle → weiter, auch bei `aal1` (die Seite leitet zu `/admin/mfa`).
  - Der Proxy ist eine zusätzliche Schicht. `requireAdmin()` in jeder `page.tsx` und **jeder** Server Action unter `/admin` bleibt Pflicht und nutzt `getUser()` (ADR 010, sicherheitskritisch), nicht `getClaims()`.
  - `admin` in `PROTECTED_SECTIONS` aufnehmen (Login-Redirect, `next`-Allowlist) und den Vitest `guards.test.ts` so erweitern, dass er `requireAdmin` als Prüfung erkennt und für `/admin` **nur** `requireAdmin` akzeptiert.
  - E2E prüft den Status der Dokument-Antwort (nicht nur den sichtbaren Text) für `/de/admin`, `/de/admin/listings`, `/de/admin/listings/<id>`, `/de/admin/audit`, `/de/admin/admins` als Nicht-Admin (403) und anonym (Redirect), sowie einen Server-Action-POST als Nicht-Admin (abgelehnt).
  - Das blockierende Rendern bleibt trotzdem nötig, damit `forbidden()` nach Entzug der Rolle zwischen Proxy und Seite keinen 200 mit Hülle liefert. Die genaue Next-Option (`instant = false` o. ä.) in ADR 014 mit Quelle belegen.
- **A2 Öffentliche RPC für den Zugangsstatus.** `private` ist nicht über die API erreichbar; `has_admin_role()`/`is_admin()` lassen sich vom Web nicht direkt aufrufen. Neue RPC `public.admin_access() returns table (has_role boolean, aal2 boolean)`, `security invoker`, nur `authenticated`, Meta-Allowlist. Gehört in Commit 4 (vor dem Web).
- **A3 Nonce-CSP für `/admin`.** ADR 010 sagt zu: „Eine Nonce-CSP mit `strict-dynamic` kommt zuerst für `/admin` in M4.“ Admin-Seiten rendern fremde Inhalte (UGC) und sind das wertvollste XSS-Ziel. Weil sie ohnehin dynamisch rendern, ist die Nonce dort ohne Nachteil möglich: Der Proxy setzt für `/admin/*` eine eigene CSP mit Nonce (`script-src 'nonce-…' 'strict-dynamic'`, ohne `'unsafe-inline'`), `next.config.ts` nimmt `/admin` aus der festen CSP aus. `img-src` behält `data:` (QR-Code) und die Supabase-Origin (signierte URLs). Test: Vitest für die CSP, E2E ohne CSP-Verletzungen auf `/admin`. Wenn das technisch scheitert, ausdrücklich in ADR 014 mit Grund verschieben und im CHANGELOG als offene Lücke führen.
- **A4 Moderation nur über den RPC.** Heute erlauben `listings_update_admin` und die Spalten-GRANTs dasselbe als Roh-UPDATE, ohne Versions-Vergleich (B1). Der RPC setzt `set_config('revier.moderation', 'on', true)`; der Guard lässt Moderations-Übergänge nur zu, wenn das Flag gesetzt ist, sonst `42501`. Über PostgREST ist `set_config` nicht aufrufbar (Schema `pg_catalog` nicht exponiert). pgTAP: Roh-UPDATE als aal2-Admin auf fremde Anzeige → `42501`.
- **A5 Keine Inhaltsänderung durch Moderatoren.** Der Guard lässt heute zu, dass ein Admin fremde Inhalte ändert, ohne dass die Anzeige in die Prüfung geht (`content_changed and not moderator`). Dafür gibt es keinen Anwendungsfall, und ein gekapertes Admin-Konto könnte aktive Anzeigen unbemerkt umschreiben (z. B. Betrugs-Kontaktdaten). Inhaltsänderungen an fremden Anzeigen → `42501`, auch für Admins; Kinder-Guard entsprechend (`privileged` nur noch für Server-Pfade). Im selben Zuge entscheiden und in ADR 014 festhalten, ob `listings_delete_admin` bleibt. Empfehlung: entfernen. Entfernen läuft über den Status `removed` (DSA, Aufbewahrung); ein hartes Löschen durch Admins hinterlässt heute keinen Audit-Eintrag.
- **A6 `reject_code` sauber durch alle Pfade ziehen.**
  - `private.listing_content_hash` schließt `reject_code` (und `submitted_at`, A8) aus. Sonst ändert die neue Spalte den Hash **jeder** bereits freigegebenen Anzeige, und alle pausierten Anzeigen müssten nach der Migration neu geprüft werden (die Formel nimmt neue Spalten automatisch als Inhalt). pgTAP: Hash vor und nach der Migration gleich bzw. `paused → active` bleibt ohne Änderung möglich.
  - Alle Stellen, die heute `reject_reason = null` setzen, leeren auch `reject_code`: Guard (Insert, Absenden, Inhaltsänderung an aktiver Anzeige, Freigabe) und die Kinder-/Foto-Pfade (`listing_children_guard`, `complete_photo_processing` u. a.; per grep alle Vorkommen).
  - Absicherung per Check-Constraints (nach der Datenmigration, `validate`): `reject_reason is null or reject_code is not null`, `reject_code is null or status in ('draft', 'rejected')`, `reject_code <> 'other' or reject_reason is not null`. Damit fällt ein vergessener Pfad sofort auf.
  - `reject_reason`-Check auf `char_length(private.trim_all(…)) between 1 and 1000` umstellen; der RPC normalisiert (trimmen, leer → `null`).
  - Spalten-GRANT: `reject_code` braucht UPDATE für `authenticated` (Invoker-RPC). Der Meta-Test „Inhaltsspalten = UPDATE-GRANT außer status und reject_reason“ nimmt `reject_code` mit auf; der Guard verbietet dem Besitzer das Setzen wie bei `reject_reason`.
  - **Audit-Trigger:** Die Bedingung für `pending_review → draft` prüft heute `new.reject_reason is not null`. Weil der Freitext optional wird, fehlte „Bearbeitung anfordern“ ohne Text im Audit. Bedingung auf `reject_code` umstellen; `details` = `{from, code, reason}`.
  - Datenmigration: alle Zeilen mit `reject_reason is not null` und `reject_code is null` → `'other'`; Zeilen mit Grund in einem Status außer `draft`/`rejected` → Grund leeren. Reihenfolge: Spalte, Daten, Constraints.
- **A7 `listing_content_hints` für Admins öffnen.** Die Funktion liefert heute nur für den Besitzer Treffer (`l.owner_id = auth.uid()`); der Admin bekäme eine leere Liste, der Plan setzt aber Hinweise in der Detailansicht voraus. Bedingung um `or (select private.is_admin())` erweitern; pgTAP (Admin aal2 sieht Treffer, aal1 nicht). Laut ADR 013 markiert der Abgleich Anzeigen auch in der Warteschlange: Spalte „Hinweise“ (ja/Anzahl) in der Liste, ohne N+1-Aufrufe (eine Admin-RPC für die Seite oder ein Aggregat).
- **A8 Wartezeit braucht einen Zeitpunkt.** `listings` hat weder `updated_at` noch einen Einreichzeitpunkt; `created_at` ist der Entwurf. Neue Spalte `submitted_at`, gesetzt von einem eigenen BEFORE-UPDATE-Trigger bei jedem Wechsel nach `pending_review` (auch auf Server-/Definer-Pfaden, die der Guard über `is_server()` überspringt, z. B. Kinder-Guard). Kein GRANT, nicht im Hash. Warteschlange sortiert nach `(submitted_at, id)` per Keyset; Index `where status = 'pending_review'`.
- **A9 `admin_find_user`.** Definer, nur `is_admin()`; Eingabe normalisiert (`lower(trim)`), exakter Vergleich, keine Wildcards. Treffer nur für aktive, bestätigte Konten mit Profil; das eigene Konto ist kein Treffer. Rückgabe: `user_id`, Anzeigename, Konto seit, `is_admin`, nie die E-Mail und keine weiteren Profildaten. Rate-Limit (z. B. 30 Abfragen je Admin und Stunde, `54000`). Treffer protokollieren (`user.looked_up`, nur `target_id`, keine E-Mail in `details`).
- **A10 Signierte URLs.** Mit dem Client des Admins (seine Session, Storage-RLS greift) erzeugen, nie mit `service_role`. 10 Minuten reichen. Signierte URLs nicht in `use cache` oder anderen geteilten Caches ablegen; Admin-Seiten `Cache-Control: private, no-store`.
- **A11 Gesperrte und gelöschte Admins.** `private.is_admin()` prüft heute weder `is_blocked` noch `deleted_at`. Ergänzen um `private.is_active_user(auth.uid())` (eine Zeile, im Initplan gecacht). Sonst behält ein gesperrtes Admin-Konto bis zur manuellen Rollenpflege alle Rechte. pgTAP.
- **A12 Testplan ergänzen.**
  - Integration (Commit 5) läuft gegen echtes Auth und braucht echtes `aal2`. TOTP in `config.toml` und der TOTP-Helfer müssen deshalb **vor** Commit 5 kommen (Reihenfolge siehe A13). Helfer an einer Stelle für Integration und E2E.
  - pgTAP zusätzlich: B1 (Version), B2 (Step-up per `amr`, Karenz, Limits, gleichzeitiges Entziehen soweit in pgTAP darstellbar, Trigger-Audit bei SQL-Grant), A4, A5, A6 (Constraints, Hash, Audit ohne Freitext), A7, A11; Admin liest Entwürfe fremder Nutzer nur als aal2.
  - `moderate_listing` mit `event_date` in der Vergangenheit: Freigabe scheitert mit `listing_not_ready`, Ablehnen/Zurückgeben gelingt (UI zeigt den Feldcode verständlich).
  - E2E: MFA-Seite zweimal laden erzeugt keinen zweiten Faktor (B3); falscher Code zeigt lokalisierten Fehler; Ernennen ohne frischen Code scheitert (B2); Admin sieht eigene Anzeige in der Warteschlange nicht entscheidbar.
  - TOTP im E2E: Wird derselbe Code zweimal im gleichen 30-s-Fenster gebraucht (Enroll, dann Step-up), auf das nächste Fenster warten statt auf Wiederverwendung zu bauen.
  - Aufräumen der MFA-Faktoren über die Admin-API nur im Testcode (service_role nur in Node, nie im Browser).
- **A13 Commit-Reihenfolge.**
  1. ADR 014, Plan, SPEC v0.6, Glossar
  2. Migration `reject_code`, `submitted_at`, Hash-Ausschluss, Constraints, Audit-Bedingung, Guard (A4, A5, A6, A8), `is_admin` (A11); pgTAP
  3. Migration `moderate_listing` mit Version (B1), `admin_listing_version`, `listing_content_hints` (A7); pgTAP
  4. Migration Admin-Verwaltung (B2, A9), `admin_access` (A2), Trigger-Audit `user_roles`; pgTAP; Meta-Allowlist
  5. `config.toml` TOTP an, TOTP-Helfer, Integrationstests
  6. Web: Proxy-403, `PROTECTED_SECTIONS`, Gate, `authInterrupts`, `forbidden.tsx`, Nonce-CSP `/admin` (A1, A3), `/admin/mfa` (B3)
  7. bis 12. wie geplant
- **A14 Doku.**
  - ADR 014: RPC-Vertrag mit Fehlercodes (`RV003` bereits entschieden, `RV004` Inhalt geändert, `RV005` Step-up nötig, `P0002`, `42501`, `23514 listing_not_ready`), Grund-Codes, Ernennung mit Step-up/Karenz/Limits, Proxy-403, Nonce-CSP, Begründung invoker.
  - ADR 005: Ernennung per UI, Runbook erster Admin und kompromittierter Admin (B2), `is_admin` prüft aktives Konto (A11), Folgen-Satz „Admins anlegen geht nur per SQL“ korrigieren.
  - ADR 010: Nonce-CSP für `/admin` als umgesetzt (oder verschoben) vermerken.
  - ADR 013: Hash-Ausschlüsse ergänzen (`reject_code`, `submitted_at`), Moderator ändert keine Inhalte mehr.
  - CHANGELOG: iOS zeigt den Grund erst ab I4 (Lücke vermerken); iOS braucht die Grund-Codes im String Catalog mit denselben Glossar-Begriffen.
  - **Cloud-Checkliste ergänzen:** TOTP enroll/verify aktiv (steht schon) **und** nach dem Deploy geprüft; `max_enrolled_factors`; Rate-Limit für Token-/MFA-Verifizierungen geprüft; Custom Access Token Hook aktiv (sonst kein `app_role` für die UI); erster Admin per SQL-Editor nach Runbook; Session-Timeouts (`inactivity_timeout`, `timebox`) gesetzt, weil `aal2` sonst so lange gilt wie das Refresh-Token; MFA-Faktoren werden beim Löschen von `auth.users` per Kaskade entfernt (M9: im Test für Account löschen nachweisen, ebenso `user_roles`).

### 10.4 Hinweise
- **H1 Brute-Force auf TOTP:** Wer per Magic Link (kompromittierte Mailbox) eine `aal1`-Session hat, kann Codes raten. Schutz sind die Supabase-Limits je IP; die Server Action läuft über die Server-IP, die Limits teilen sich dann alle Admins (klein, akzeptabel). Restrisiko in ADR 014 festhalten; optional eigener Zähler fehlgeschlagener Versuche je Konto.
- **H2 Re-Auth nach Zeit:** `requireAdmin()` kann bei TOTP-`amr` älter als 12 h erneut einen Code verlangen. Nur UI, kein Ersatz für B2.
- **H3 Zweiter Faktor als Ersatz:** Erlauben, bei `aal2` einen zweiten TOTP-Faktor anzulegen (Geräteverlust). Sonst hilft nur das Runbook.
- **H4 DSA Art. 17:** Eine Ablehnung ist eine Einschränkung mit Begründungspflicht (Tatsachen, Grundlage in den AGB, Hinweis auf Rechtsbehelf). Die Grund-Codes sollten später auf AGB-Klauseln zeigen, der Hinweis auf eine Beschwerde (Art. 20) folgt mit dem Meldungs-Schritt. Anwaltlich klären (SPEC 7.2), Texte bleiben Platzhalter.
- **H5 Audit-Log:** `actor_id … on delete set null` verliert den Akteur, wenn ein Admin sein Konto löscht. Für M9 bewerten (z. B. Akteur zusätzlich als Pseudonym in `details`). Für das Keyset-Paging Index `(created_at desc, id desc)` ergänzen; Freitext-Gründe im Audit unterliegen der Frist `audit_log_months`.
- **H6 Datensparsamkeit Admin-Lesen:** `listings_select_admin` zeigt Admins auch fremde Entwürfe. Für M4 nicht nötig, aber die Admin-UI liest nur `pending_review` (und für den Besitzer-Zähler aggregierte Werte), keine Entwürfe.
- **H7** Header-Link „Admin“ und `forbidden.tsx` verraten nichts über andere Konten. `robots.txt` bekommt keinen `Disallow: /*/admin` (verrät den Pfad nicht zusätzlich), `noindex` per Meta und `X-Robots-Tag` reicht.
- **H8** Abgelehnte Anzeigen kann der Besitzer sofort unverändert erneut einreichen (`rejected → pending_review`). Die Warteschlange zeigt deshalb die Zahl früherer Ablehnungen der Anzeige und des Besitzers; ein Limit für Wiedereinreichungen kann mit den Meldungen kommen.

## 11. Eingearbeitet (2026-10-30)
- **B1, B2, B3** stehen verbindlich in ADR 014 (Version beim Freigeben, Schutz der Admin-Ernennung, TOTP-Einrichtung per POST).
- **Nutzer-Entscheidung zu B2 (2026-10-30):** alle Schutzregeln wie vorgeschlagen (Step-up ≤ 10 min, 3 je Admin / 10 gesamt in 24 h, 7 Tage Karenz, letzter Admin geschützt, Audit per Trigger).
- **A5 korrigiert:** Eine Policy `listings_delete_admin` gibt es nicht (nur `listings_delete_own`); es bleibt bei „Moderatoren ändern keine fremden Inhalte“.
- **Commit-Reihenfolge** nach A13 (ersetzt Abschnitt 8):
  1. ADR 014, Plan, SPEC v0.6, Glossar
  2. Migration `reject_code`, `submitted_at`, Hash-Ausschluss, Constraints, Audit-Bedingung, Guard (A4–A6, A8), `is_admin` (A11); pgTAP
  3. Migration `moderate_listing` mit Version (B1), `admin_listing_version`, `listing_content_hints` für Admins (A7); pgTAP
  4. Migration Admin-Verwaltung (B2, A9), `admin_access` (A2), Trigger-Audit `user_roles`; pgTAP; Meta-Allowlist
  5. `config.toml` TOTP an, TOTP-Helfer, Integrationstests
  6. Web: Proxy-403, `PROTECTED_SECTIONS`, Gate, `authInterrupts`, `forbidden.tsx`, Nonce-CSP `/admin`, `/admin/mfa`
  7. Web: Warteschlange und Detail mit Entscheidung
  8. Web: Grund in „Meine Anzeigen“ und im Assistenten
  9. Web: Audit-Log
  10. Web: Admins ernennen/entziehen mit Step-up
  11. E2E
  12. CHANGELOG, ADR 005/010/013 nachgezogen, QA-Hinweise
