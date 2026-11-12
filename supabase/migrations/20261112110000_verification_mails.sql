-- M9b Commit 7 (ADR 020, Mailtexte): Die Dienstmails zu Ablehnung und Widerruf nennen die Frist zum Anfechten
-- (appeal_window_days, DSA Art. 20 Abs. 1: mindestens 6 Monate; Platzhalter). Die Frist zählt ab der Entscheidung.

insert into private.app_settings (key, value, description) values
  ('appeal_window_days', '183', 'Frist zum Anfechten einer Entscheidung in Tagen (ADR 020, DSA Art. 20, Platzhalter)');

create or replace function private.account_notification_details(p_kind text, p_ref_id uuid, p_user_id uuid, p_payload jsonb)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_kind in ('verification_verified', 'verification_rejected', 'verification_revoked') then (
      select jsonb_build_object(
        'document_type', v.document_type,
        'code', case p_kind when 'verification_rejected' then v.reject_code when 'verification_revoked' then v.revoke_code end,
        'reason', case p_kind when 'verification_rejected' then v.reject_reason when 'verification_revoked' then v.revoke_reason end,
        'decided_at', d.at,
        'appeal_until', case when p_kind <> 'verification_verified'
                             then d.at + make_interval(days => private.setting_int('appeal_window_days')) end)
      from public.verifications v
      cross join lateral (select case p_kind when 'verification_revoked' then v.revoked_at else v.decided_at end as at) d
      where v.id = p_ref_id and v.user_id = p_user_id
        and case p_kind
              when 'verification_verified' then v.status = 'verified'
              when 'verification_rejected' then v.status = 'rejected'
              else v.revoked_at is not null
            end)
  end;
$$;
