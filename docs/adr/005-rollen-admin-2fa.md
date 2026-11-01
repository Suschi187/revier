# ADR 005: Rollen, Admin und Zwei-Faktor

Status: angenommen (M1)

## Kontext
SPEC 3.4: Die Admin-Rolle kommt über einen Custom Claim, nie über Felder, die der Client setzen kann. SPEC 5: Der Admin-Bereich verlangt 2FA. Web und iOS müssen dieselben Rechte haben.

## Entscheidung
- Rollen stehen in `private.user_roles (user_id, role)`. Das Schema `private` ist nicht über die API erreichbar.
- Ein Custom Access Token Hook (`private.custom_access_token_hook`) schreibt den Claim `app_role` ins JWT. Nur `supabase_auth_admin` darf ihn ausführen. Der Claim dient der UI, z. B. um `/admin` anzuzeigen.
- Policies prüfen `private.is_admin()`:
  - Ein Eintrag in `private.user_roles` muss existieren. Ein Entzug wirkt dadurch sofort, nicht erst beim nächsten Token.
  - **Und** der Token hat `aal = 'aal2'` (2FA bestätigt).
  - `private.has_admin_role()` prüft nur die Rolle, ohne 2FA. Es ist für Hinweise in der UI gedacht und nie für Rechte.
- `user_metadata`/`raw_user_meta_data` werden für Rechte nie gelesen.
- Hilfsfunktionen sind `security definer` mit `set search_path = ''`. Policies rufen `(select auth.uid())` auf, damit der Planner den Wert cacht.

## Alternativen
- Rolle in `app_metadata`: Sie wird erst beim Token-Refresh wirksam, ein Entzug wäre also verzögert.
- Rolle in `profiles`: Die Spalte wäre schreibbar und fehleranfällig.

## Folgen
- Seit M4 (ADR 014) ernennen und entziehen Admins andere Admins im Admin-Bereich: frischer TOTP-Code (≤ 10 min, Claim `amr`), höchstens 3 Änderungen je Admin und 10 insgesamt in 24 h, 7 Tage Karenz nach der eigenen Ernennung, letzter aktiver Admin nicht entziehbar. Jede Rollenänderung protokolliert ein Trigger auf `private.user_roles`, auch per SQL.
- `private.is_admin()` verlangt seit M4 zusätzlich ein aktives Konto (nicht gesperrt, nicht gelöscht).
- TOTP ist lokal in `supabase/config.toml` eingeschaltet (M4).

### Runbook: erster Admin
1. Das Konto meldet sich normal an und schließt das Onboarding ab.
2. Im SQL-Editor (Cloud: Studio, lokal: `supabase db query --local`): `insert into private.user_roles (user_id, role, created_at) values ('<user-id>', 'admin', now() - interval '7 days');` Das Zurückdatieren hebt die Karenz für den ersten Admin auf; der Trigger schreibt `role.granted` mit `via = sql` ins Audit-Log.
3. Der Admin öffnet `/de/admin`, richtet TOTP ein und ist danach mit aal2 im Admin-Bereich.
- Lokal erledigt Schritt 2 das Skript `cd web && npm run admin:local -- <e-mail>` (nur `supabase db query --local`, zurückdatiert; `--remove` entzieht die Rolle). Mails der lokalen Anmeldung landen in Mailpit unter http://127.0.0.1:54324 (höchstens 2 je Stunde, `email_sent` in `config.toml`). Adressen auf `@test.local` löschen die E2E-Tests beim Aufräumen.

### Runbook: Admin-Konto kompromittiert
1. Rolle per SQL entziehen: `delete from private.user_roles where user_id = '<user-id>';` (auch der letzte Admin; danach per Runbook einen neuen anlegen).
2. MFA-Faktoren und Sessions löschen: `delete from auth.mfa_factors where user_id = '<user-id>'; delete from auth.sessions where user_id = '<user-id>';`
3. Audit-Log der letzten Tage prüfen: `role.*`, `user.looked_up`, `listing.*` mit diesem Akteur; von ihm ernannte Admins ebenso entziehen und Entscheidungen nachprüfen.
- Checkliste Cloud-Projekt (M2, Review M1):
  - Custom Access Token Hook aktivieren.
  - „Expose new tables“ deaktivieren (entspricht `auto_expose_new_tables = false`).
  - Nur das Schema `public` über die API exponieren, GraphQL abschalten.
  - TOTP-MFA aktivieren, sonst entsteht nie `aal2` und es gibt faktisch keine Admins.
  - `enable_confirmations = true`, Passwortlänge mindestens 10.
  - Kein Logging von Statement-Parametern (ADR 006).
  - Signed URLs für Dokumente kurz halten (M9).
- Lokal sind Hook und Exposure in `supabase/config.toml` gesetzt.
- In lokalen Tests wird `aal` über `request.jwt.claims` gesetzt.
