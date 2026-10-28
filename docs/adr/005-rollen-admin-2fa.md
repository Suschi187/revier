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
- Admins anlegen geht nur per SQL bzw. Service-Rolle. Eine UI folgt in M4.
- Der Hook muss in der Cloud aktiviert werden (M2). Lokal ist er in `supabase/config.toml` aktiv.
- In lokalen Tests wird `aal` über `request.jwt.claims` gesetzt.
