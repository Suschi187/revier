-- ADR 022 S3: eine einzige Quelle für die Ablehnungsgründe von Anzeigen. Bisher standen die Codes im Check von
-- listings.reject_code und noch einmal in resolve_reports; ein neuer Code musste an beiden Stellen nachgezogen werden.
-- Jetzt prüft nur die Domain. Ein neuer Code ändert nur sie (alter domain … drop/add constraint) und die Liste in
-- web/lib/moderation.ts (moderation.test.ts liest die jüngste Definition aus den Migrationen).
-- Eigener Name statt `reject_code`, weil verifications.reject_code andere Codes hat (unreadable, expired, …).

create domain public.listing_reject_code as text
  constraint listing_reject_code_check check (value in ('incomplete', 'wrong_category', 'weapons', 'prohibited_content',
                                                        'duplicate', 'contact_in_text', 'implausible', 'killed_game', 'other'));

alter table public.listings drop constraint listings_reject_code_check;
alter table public.listings alter column reject_code type public.listing_reject_code;
-- Kopie für die Moderations-Mail; dieselben Werte wie an der Anzeige.
alter table private.moderation_notifications alter column reject_code type public.listing_reject_code;

-- Vollständige gültige Fassung (vorher verteilt auf qa_m9b_fixes und reject_code_killed_game). Änderungen an der
-- Funktion beginnen ab jetzt hier bzw. mit pg_get_functiondef aus der aktuellen Datenbank.
create or replace function public.resolve_reports(p_target_type report_target, p_target_id uuid, p_outcome text, p_code text DEFAULT NULL::text, p_note text DEFAULT NULL::text, p_expected_version text DEFAULT NULL::text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $$
declare
  v_outcome text := p_outcome;
  note text := nullif(private.trim_all(coalesce(p_note, '')), '');
  account uuid;
  open_ids uuid[];
  r record;
  previous_flag text := coalesce(current_setting('revier.report', true), '');
begin
  if not private.is_admin() then
    raise exception 'Nur für Admins mit Zwei-Faktor' using errcode = '42501';
  end if;
  if v_outcome is null or v_outcome not in ('no_action', 'content_removed', 'point_removed', 'account_warned', 'account_blocked') then
    raise exception 'Unbekanntes Ergebnis' using errcode = '22023';
  end if;
  if not exists (select 1 from public.reports x where x.target_type = p_target_type and x.target_id = p_target_id) then
    raise exception 'Ziel nicht gefunden' using errcode = 'P0002';
  end if;
  select array_agg(x.id order by x.created_at) into open_ids
  from (select x.id, x.created_at from public.reports x
        where x.target_type = p_target_type and x.target_id = p_target_id and x.status = 'open' for update) x;
  if open_ids is null then
    raise exception 'already_handled' using errcode = 'RV003';
  end if;
  if v_outcome in ('content_removed', 'point_removed') and p_target_type <> 'listing' then
    raise exception 'Maßnahme passt nicht zum Ziel' using errcode = '22023';
  end if;
  -- F5: Code passend zur Maßnahme; F3: Kartenpunkt mit Code und Begründung wie Entfernen.
  if v_outcome in ('content_removed', 'point_removed') then
    -- Gültige Codes nur aus der Domain (ADR 022 S3); Web und iOS bekommen weiter dieselbe Feldmeldung.
    if p_code is null then
      raise exception 'Grund fehlt' using errcode = '23514', hint = '{"fields":["code"]}';
    end if;
    begin
      perform p_code::public.listing_reject_code;
    exception when check_violation then
      raise exception 'Grund fehlt' using errcode = '23514', hint = '{"fields":["code"]}';
    end;
    if note is null then
      raise exception 'Begründung fehlt' using errcode = '23514', hint = '{"fields":["note"]}';
    end if;
  end if;

  if private.report_target_gone(p_target_type, p_target_id) and v_outcome <> 'no_action' then
    v_outcome := 'target_gone';
  else
    account := private.report_target_account(p_target_type, p_target_id);
    if v_outcome in ('account_warned', 'account_blocked') then
      perform private.check_account_action(account);
      perform private.check_action_code(p_code, note, true);
    elsif account = (select auth.uid()) then
      raise exception 'Meldungen zum eigenen Konto entscheidet ein anderer Admin' using errcode = '42501';
    end if;
    case v_outcome
      when 'content_removed' then
        perform public.moderate_listing(p_target_id, 'remove', p_expected_version, p_code, note);
      when 'point_removed' then
        if not exists (select 1 from public.listings l where l.id = p_target_id and l.display_location is not null) then
          raise exception 'Kein Kartenpunkt' using errcode = 'RV003';
        end if;
        perform set_config('revier.point_code', p_code, true);
        perform set_config('revier.point_note', note, true);
        update public.listings set display_location = null where id = p_target_id;
        perform set_config('revier.point_code', '', true);
        perform set_config('revier.point_note', '', true);
      when 'account_warned' then
        perform private.warn_account(account, p_code, note);
      when 'account_blocked' then
        -- Schon gesperrt: Ergebnis bleibt, keine zweite Sperre und keine zweite Mail.
        if not (select p.is_blocked from public.profiles p where p.user_id = account) then
          perform private.set_account_blocked(account, true, p_code, note);
        end if;
      else
        null;
    end case;
  end if;

  perform set_config('revier.report', 'on', true);
  perform set_config('revier.report_resolution', gen_random_uuid()::text, true);
  perform set_config('revier.report_code', coalesce(p_code, ''), true);
  perform set_config('revier.report_note', coalesce(note, ''), true);
  update public.reports set status = 'handled', outcome = v_outcome where id = any (open_ids);
  perform set_config('revier.report', previous_flag, true);
  perform set_config('revier.report_code', '', true);
  perform set_config('revier.report_note', '', true);
  perform set_config('revier.report_resolution', '', true);

  -- Meldende erfahren nur das Ergebnis (Art. 16 Abs. 5).
  -- F4: je Bearbeitung eine Mail (ref_id = Audit der Bearbeitung).
  for r in select x.decision_audit_id, x.reporter_id from public.reports x
           where x.id = any (open_ids) and x.reporter_id is not null and x.decision_audit_id is not null loop
    insert into private.account_notifications (kind, user_id, ref_id) values ('report_resolved', r.reporter_id, r.decision_audit_id)
    on conflict do nothing;
  end loop;
  return v_outcome;
end;
$$;
