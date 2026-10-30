# ADR 014: Moderation und Admin-Verwaltung

Status: angenommen (M4, Plan `docs/plans/M4-plan.md` mit Architekt-Review)

## Kontext
SPEC 5/6 M4: Admins geben Anzeigen frei, lehnen sie mit Grund ab oder fordern eine Bearbeitung an. Zugang nur mit Admin-Rolle und 2FA, Nicht-Admins erhalten 403. Nutzer-Entscheidungen 2026-10-30: Grund als Vorlage plus Freitext, „Bearbeitung anfordern“ in M4, TOTP im Web, Admins werden per UI ernannt (mit allen Schutzregeln aus dem Review).

## Entscheidung

### Moderation
- **Nur über die RPC** `public.moderate_listing(p_listing_id uuid, p_decision text, p_expected_version text, p_code text default null, p_note text default null)`.
  - `security invoker`: Rechte über RLS und `listings_guard`, Bereitschaftsprüfung und Audit wie bisher. Ein Definer-RPC machte `private.is_server()` wahr und übersprünge den Guard (kein `expires_at`, keine Übergangsprüfung).
  - Die RPC setzt `set_config('revier.moderation', 'on', true)`; der Guard erlaubt Moderations-Übergänge nur mit diesem Flag. Ein Roh-UPDATE durch einen Admin scheitert mit `42501`.
  - Entscheidungen: `approve` (→ `active`), `request_changes` (→ `draft`), `reject` (→ `rejected`), nur aus `pending_review`.
  - Ein Admin moderiert nie die eigene Anzeige.
- **Gesehener Stand (B1):** `p_expected_version` ist der Inhalts-Hash (`private.listing_content_hash`, hex), den die Detailseite **vor** den Inhalten liest (`public.admin_listing_version`, liefert nur Admins einen Wert, sonst `null`). Die RPC sperrt die Zeile (`for update`), prüft Status und Version und ändert dann in einem UPDATE.
- **Grund:** `listings.reject_code` aus fester Liste (`incomplete`, `wrong_category`, `weapons`, `prohibited_content`, `duplicate`, `contact_in_text`, `implausible`, `other`), Pflicht bei Ablehnen und Zurückgeben; `reject_reason` ist optionaler Freitext (1–1000 Zeichen, `trim_all`), Pflicht bei `other`. Der Besitzer sieht den Code in seiner Sprache. Constraints: Freitext nur mit Code, Code nur bei `draft`/`rejected`, `other` nur mit Freitext.
- **Moderatoren ändern keine fremden Inhalte**, auch nicht ohne Statuswechsel und nicht an Fotos, Wildarten oder Ort (`42501`). Einzige Ausnahme bleibt das Entfernen des Kartenpunkts (ADR 006, schützt die Lage). Entfernen aktiver Anzeigen kommt mit den Meldungen über den Status `removed`.
- **Trigger `listings_zz_moderation_fields`** (läuft auf allen Pfaden, auch Server): setzt `submitted_at` bei jedem Wechsel nach `pending_review` und leert Code und Freitext außerhalb von `draft`, `rejected` und `removed`. Check-Constraints fangen vergessene Pfade.
- **Warteschlange:** `listings.submitted_at`, Sortierung `(submitted_at, id)`. `reject_code` und `submitted_at` gehören nicht zum Inhalts-Hash, sonst müssten alle pausierten Anzeigen nach der Migration neu geprüft werden.

### Fehlervertrag (Web und spätere Tools/iOS gleich)
| Code | Bedeutung |
|---|---|
| `RV003` | bereits entschieden (Status nicht mehr `pending_review`) |
| `RV004` | Inhalt seit dem Lesen geändert (Version weicht ab) |
| `RV005` | Step-up nötig (TOTP-Bestätigung älter als 10 Minuten) |
| `P0002` | Anzeige oder Konto nicht gefunden bzw. nicht sichtbar |
| `42501` | keine Berechtigung (kein Admin, aal1, eigene Anzeige, Roh-UPDATE) |
| `23514` | `listing_not_ready` mit Feldcodes (Freigabe) bzw. Regelverstoß (Code fehlt, letzter Admin) |
| `54000` | Rate-Limit (Rollenänderungen, Kontosuche) |

### Admin-Verwaltung (Ernennung per UI)
- `public.grant_admin(p_user_id)`, `public.revoke_admin(p_user_id)`, `public.admin_find_user(p_email)`, `public.admin_access()`.
- **Step-up:** Rollenänderungen verlangen eine TOTP-Bestätigung der letzten 10 Minuten, geprüft in der DB über `auth.jwt() -> 'amr'`.
- **Limits:** höchstens 3 Rollenänderungen je Admin und 10 insgesamt in 24 h; ein Admin ändert Rollen erst 7 Tage nach seiner eigenen Ernennung (Werte in `private.app_settings`).
- **Letzter Admin:** nicht entziehbar; gezählt unter `pg_advisory_xact_lock`, nur aktive Konten.
- **Audit per Trigger auf `private.user_roles`**, damit auch SQL-Änderungen protokolliert sind.
- **Kontosuche** nur per exakter E-Mail, Ergebnis ohne E-Mail, Rate-Limit, Abfrage im Audit-Log. Keine Ernennung per Klick aus Anzeigen oder Audit-Log.
- `private.is_admin()` verlangt zusätzlich ein aktives Konto (nicht gesperrt, nicht gelöscht).

### Zugang im Web
- Proxy: `/{locale}/admin/*` ohne Session → Login; ohne Rolle (per RPC `admin_access`, nicht per Claim) → 403-Seite mit Status 403. Mit Rolle, aber `aal1` → `/admin/mfa`.
- Der Proxy entscheidet über die **kanonische Form** des Pfads (`canonicalPath`: vollständig dekodiert, Schrägstriche normalisiert). Geschützte Pfade in anderer Schreibweise (`/de/%61dmin`, `/de//admin`, `/de%2Fadmin`) leitet er per 308 auf die kanonische Form um, ungültige Kodierung beantwortet er mit 400. Grund: next-intl dekodiert Pfade vor dem Routing, ohne die Umleitung rendert `/de/%61dmin` die Admin-Seite an der Rollenprüfung und der Nonce-CSP vorbei (QA M4 F1).
- **Status nur aus dem Proxy:** Mit `cacheComponents` ist die Hülle vorgerendert, der Status 200 ist gesendet, bevor die Seite `forbidden()` oder `redirect()` aufruft (Next-Doku `streaming.md`, „The HTTP contract“: Status und Header sind nach Beginn des Streams fest; Ablehnen mit echtem Status nur im Proxy). `export const instant = false` nimmt die Seite nur aus der Instant-Navigation-Prüfung (`instant-navigation.md`, „Opting out“) und erlaubt so das Lesen der Session ohne Suspense-Grenze; es macht das Rendern **nicht** blockierend. Die frühere Aussage in diesem ADR war falsch.
- Jede Seite und jede Server Action unter `/admin` prüft zusätzlich `requireAdmin()` (`getUser()`) und ruft sonst `forbidden()` (`experimental.authInterrupts`). Das ist die Autorisierung, nicht die Status-Quelle: Fällt die Rolle zwischen Proxy und Seite weg (Millisekunden), sieht der Nutzer „Kein Zugriff“ mit `noindex`, aber Status 200. Daten erreicht er nicht.
- **TOTP:** Einrichtung nur per Server Action (POST), vorher werden unbestätigte Faktoren entfernt. Secret und QR erscheinen nur in dieser Antwort (`no-store`). Die Einrichtung braucht JavaScript (QA M4 F2): Supabase liefert das Secret nur beim Anlegen, Next 16 rendert mit `cacheComponents` den Zustand einer Action ohne JS nicht in die Seite, und Secret in Cookie oder URL schließt B3 aus. Ohne JS ist der Knopf gesperrt, `<noscript>` nennt den Grund. Die Code-Eingabe für einen bestehenden Faktor geht ohne JS. Ein falscher Code bei der Ersteinrichtung behält den Faktor.
- **Nonce-CSP** für `/admin` (Zusage aus ADR 010): Der Proxy setzt `script-src 'nonce-…' 'strict-dynamic'` ohne `'unsafe-inline'`. Scheitert das technisch, wird es hier mit Grund verschoben und im CHANGELOG als Lücke geführt.
- Signierte Foto-URLs mit dem Client des Admins, 10 Minuten, nie in geteilten Caches.

## Alternativen
- Roh-UPDATE durch Admins (wie bis M3): kein Versionsvergleich, Konflikte und ungesehene Inhalte möglich.
- Definer-RPC: umgeht den Guard (siehe oben).
- Admins nur per SQL: kleinere Angriffsfläche, vom Nutzer verworfen; die Schutzregeln gleichen das aus.

## Folgen
- Restrisiko: TOTP-Codes lassen sich mit einer `aal1`-Session raten; Schutz sind die Supabase-Limits je IP.
- DSA Art. 17 (Begründung, AGB-Bezug, Rechtsbehelf) klärt der Anwalt; die Grund-Codes zeigen später auf AGB-Klauseln.
- iOS zeigt den Grund ab I4 mit denselben Glossar-Begriffen.
- Cloud-Checkliste: TOTP aktiv und nach dem Deploy geprüft, `max_enrolled_factors`, MFA-Rate-Limits, Access Token Hook, Session-Timeouts, erster Admin per Runbook (ADR 005), Kaskade von MFA-Faktoren und Rollen beim Account löschen (M9-Test).
