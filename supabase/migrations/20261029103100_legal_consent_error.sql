-- Review M2 (Architekt 9, ADR 010): Fehlt die Zustimmung zur aktuellen Version der Rechtstexte,
-- sollen Web und iOS das von anderen Ablehnungen unterscheiden können. Schreibende RPCs ab M3
-- rufen deshalb private.require_current_legal() auf. Der eigene SQLSTATE 'RV001' kommt über
-- PostgREST als error.code beim Client an (HTTP 400). RLS-Policies können keinen eigenen Fehler
-- werfen; nach einem 42501 fragen die Clients legal_status() ab.

create function private.require_current_legal()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.has_accepted_current_legal() then
    raise exception 'legal_consent_required'
      using errcode = 'RV001', hint = 'Zustimmung zur aktuellen Version per legal_status() und accept_legal() einholen';
  end if;
end;
$$;

revoke execute on function private.require_current_legal() from public, anon, authenticated;
grant execute on function private.require_current_legal() to service_role;
