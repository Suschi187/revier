-- M9b Commit 8 (ADR 020, Review A7, A8, A9): Meldungen mit Ergebnis, Maßnahmen (Entfernen, Kartenpunkt, Verwarnen,
-- Sperren), Konto suchen, Entscheidungen der Betroffenen und Meldenden, Beschwerden mit Rücknahme, Ausweichregel,
-- Dienstmails und Export.
begin;
\ir _helpers.psql
select plan(98);

select s.decrypted_secret as secret from vault.decrypted_secrets s where s.name = 'search_notifications_secret' \gset

create function tests.err(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlstate;
end;
$$;
create function tests.hint(stmt text) returns text language plpgsql as $$
declare h text;
begin
  execute stmt;
  return null;
exception when others then
  get stacked diagnostics h = pg_exception_hint;
  return h;
end;
$$;
create function tests.notes(u uuid) returns text[] language sql security definer as $$
  select coalesce(array_agg(n.kind order by n.kind), '{}') from private.account_notifications n where n.user_id = u;
$$;
create function tests.decision(u uuid, act text) returns uuid language sql security definer as $$
  select d.id from private.decisions_for(u) d where d.action = act order by d.created_at desc limit 1;
$$;
grant execute on all functions in schema tests to authenticated;

select tests.create_user('m9r-owner@test.local', 'Olaf') as o \gset
select tests.create_user('m9r-r1@test.local', 'Rita') as r1 \gset
select tests.create_user('m9r-r2@test.local', 'Rolf') as r2 \gset
select tests.create_user('m9r-adm@test.local', 'Ada') as adm \gset
select tests.create_user('m9r-adm2@test.local', 'Ben') as adm2 \gset
select tests.make_admin(:'adm');
select tests.make_admin(:'adm2');
insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at, secret)
values (gen_random_uuid(), :'adm2', 'app', 'totp', 'verified', now(), now(), 'x') returning id as adm2_factor \gset
select id as dd from regions where code = 'DE-14612' \gset
insert into listings (owner_id, kind, direction, title, content_language, region_id, status, expires_at, attributes)
values (:'o', 'helper', 'offer', 'M9r Revierhilfe', 'de', :'dd', 'active', now() + interval '30 days', '{"tasks": ["Ansitz"]}')
returning id as l \gset
select tests.make_ready(:'l');
-- Anzeige mit Kartenpunkt (großer Kreis, wie QA M6): Punkt setzt der Besitzer, Freigabe per RPC.
select id as big from regions where code = 'DE-14628' \gset
insert into listings (owner_id, kind, direction, title, content_language, region_id)
values (:'o', 'helper', 'offer', 'M9r Punkt', 'de', :'big') returning id as lp \gset
select tests.make_ready(:'lp');
select tests.authenticate_as(:'o');
select set_listing_location(:'lp', :'big', (select postal_code from listing_places where listing_id = :'lp'), 'Testort', 'set', 50.95, 13.95);
update listings set status = 'pending_review' where id = :'lp';
select tests.authenticate_as(:'adm', 'aal2');
select moderate_listing(:'lp', 'approve', admin_listing_version(:'lp'));
select tests.as_postgres();
-- Einreichungszeit zurückdatieren (die Trigger halten submitted_at sonst fest).
set local session_replication_role = replica;
update listings set submitted_at = now() - interval '20 days' where id = :'l';
set local session_replication_role = origin;

-- ---------------------------------------------------------------------------
-- 1. Melden und Rechte
-- ---------------------------------------------------------------------------
select ok(not has_table_privilege('authenticated', 'public.reports', 'update')
          and not exists (select 1 from pg_policies where tablename = 'reports' and cmd = 'UPDATE'), 'Kein Roh-UPDATE an reports');
select ok(has_column_privilege('authenticated', 'public.reports', 'outcome', 'select')
          and not has_column_privilege('authenticated', 'public.reports', 'handled_by', 'select')
          and not has_column_privilege('authenticated', 'public.reports', 'decision_audit_id', 'select'),
  'Meldende lesen outcome, nicht handled_by und decision_audit_id');
select tests.authenticate_as(:'r1');
insert into reports (target_type, target_id, reason, note) values ('listing', :'l', 'scam', 'Vorkasse') returning id as rep1 \gset
select is(tests.err(format($$ insert into reports (target_type, target_id, reason) values ('listing', %L, 'other') $$, :'l')), '23505',
  'Zweite offene Meldung zum selben Ziel: 23505');
select tests.authenticate_as(:'r2');
insert into reports (target_type, target_id, reason) values ('listing', :'l', 'weapons') returning id as rep2 \gset
insert into reports (target_type, target_id, reason) values ('profile', :'o', 'harassment') returning id as rep_p \gset
insert into reports (target_type, target_id, reason) values ('listing', :'lp', 'other') returning id as rep_lp \gset
-- Nachricht von o an r1, von r1 gemeldet
select tests.authenticate_as(:'r1');
select start_conversation(:'l', 'Ist die Stelle noch frei?') as c \gset
select tests.authenticate_as(:'o');
select send_message(:'c', 'Zahle bitte vorab per Gutschein') as m_o \gset
select tests.authenticate_as(:'r1');
insert into reports (target_type, target_id, reason) values ('message', :'m_o', 'scam') returning id as rep_m \gset

-- ---------------------------------------------------------------------------
-- 2. Warteschlange, Ziel, Kopie
-- ---------------------------------------------------------------------------
select is(tests.err($$ select * from admin_report_queue() $$), '42501', 'Nutzer sehen die Warteschlange nicht');
select tests.authenticate_as(:'adm', 'aal1');
select is(tests.err($$ select * from admin_report_queue() $$), '42501', 'Admin ohne aal2 auch nicht');
select tests.authenticate_as(:'adm', 'aal2');
select is((select report_count from admin_report_queue() q where q.target_type = 'listing' and q.target_id = :'l'), 2, 'Gruppiert je Ziel');
select is((select reasons::text[] from admin_report_queue() q where q.target_type = 'listing' and q.target_id = :'l'), array['scam', 'weapons'],
  'Gründe je Ziel');
select is((select label from admin_report_queue() q where q.target_type = 'message'), 'Olaf', 'Nachricht: nur der Absender als Label, kein Text');
select is((select count(*)::int from admin_report_queue()), 4, 'Vier Ziele');
select is(tests.err(format($$ select admin_report_target('listing', %L) $$, gen_random_uuid())), 'P0002', 'Unbekanntes Ziel: P0002');
select admin_report_target('listing', :'l') as tgt \gset
select ok((:'tgt'::jsonb -> 'listing' ->> 'version') ~ '^[0-9a-f]{64}$', 'Version für aktive Anzeigen');
select is(jsonb_array_length(:'tgt'::jsonb -> 'open'), 2, 'Offene Meldungen');
select ok(not ((:'tgt'::jsonb -> 'open' -> 0) ? 'reporter_id'), 'Ohne Meldende');
select is((:'tgt'::jsonb -> 'account' ->> 'display_name'), 'Olaf', 'Betroffenes Konto');
select is(admin_listing_version(:'l'), null, 'admin_listing_version bleibt auf pending_review (QA M4 F4)');
select is(tests.err(format($$ select admin_report_message(%L) $$, :'rep_m')), null, 'Kopie lesbar');
select is((admin_report_message(:'rep_m') ->> 'body'), 'Zahle bitte vorab per Gutschein', 'Text der Kopie');
select tests.as_postgres();
select is((select count(*)::int from audit_log where action = 'report.message_viewed' and target_id = :'rep_m'), 2, 'Jeder Abruf auditiert');
select tests.authenticate_as(:'adm', 'aal1');
select is(tests.err(format($$ select admin_report_message(%L) $$, :'rep_m')), '42501', 'Kopie nur mit aal2');

-- ---------------------------------------------------------------------------
-- 3. Anzeige entfernen
-- ---------------------------------------------------------------------------
select tests.authenticate_as(:'adm', 'aal2');
select (admin_report_target('listing', :'l') -> 'listing' ->> 'version') as v \gset
select is(tests.err(format($$ select resolve_reports('listing', %L, 'content_removed', 'weapons', 'Waffen', %L) $$, :'l', repeat('0', 64))), 'RV004',
  'Abweichende Version: RV004');
select is(tests.err(format($$ select resolve_reports('listing', %L, 'content_removed', 'weapons', null, %L) $$, :'l', :'v')), '23514',
  'Entfernen braucht eine Begründung');
select is(tests.err(format($$ select resolve_reports('profile', %L, 'content_removed', 'weapons', 'x', %L) $$, :'o', :'v')), '22023',
  'Inhalt entfernen nur bei Anzeigen');
select public_cache_epoch() as e0 \gset
select is(resolve_reports('listing', :'l', 'content_removed', 'weapons', 'Waffen im Angebot', :'v'), 'content_removed', 'Entfernt');
select tests.as_postgres();
select is((select status::text from listings where id = :'l'), 'removed', 'Anzeige removed');
select is((select array_agg(outcome order by created_at) from reports where id in (:'rep1', :'rep2')), array['content_removed', 'content_removed'],
  'Beide Meldungen mit Ergebnis');
select ok((select bool_and(decision_audit_id is not null and handled_by = :'adm'::uuid) from reports where id in (:'rep1', :'rep2')),
  'decision_audit_id und Bearbeiter');
select is((select details ->> 'outcome' from audit_log where id = (select decision_audit_id from reports where id = :'rep1')), 'content_removed',
  'Audit report.handled mit Ergebnis');
select is((select details ->> 'code' from audit_log where action = 'listing.removed' and target_id = :'l'), 'weapons', 'Audit listing.removed mit Code');
select is((select decision from private.moderation_notifications where listing_id = :'l'), 'removed', 'Mail an den Besitzer');
select ok(public_cache_epoch() > :'e0'::bigint, 'Cache-Zähler steigt');
select is(tests.notes(:'r1'), array['report_resolved'], 'Mail an Meldende 1');
select is(tests.notes(:'r2'), array['report_resolved'], 'Mail an Meldende 2');
select tests.authenticate_as(:'adm', 'aal2');
select is(tests.err(format($$ select resolve_reports('listing', %L, 'no_action') $$, :'l')), 'RV003', 'Schon erledigt: RV003');
select tests.authenticate_as(:'r1');
select is((select outcome from reports where id = :'rep1'), 'content_removed', 'Meldende sehen das Ergebnis');
select is((select outcome || ':' || target_label from my_decisions() where action = 'report.handled'), 'content_removed:M9r Revierhilfe',
  'my_decisions der Meldenden');
select tests.authenticate_as(:'o');
select is((select code || ':' || reason from my_decisions() where action = 'listing.removed'), 'weapons:Waffen im Angebot',
  'my_decisions des Besitzers mit Code und Begründung');
select ok((select appealable and appeal_until > now() + interval '182 days' from my_decisions() where action = 'listing.removed'),
  'anfechtbar, Frist 183 Tage');
select ok(coalesce(tests.err(format($$ update listings set status = 'pending_review' where id = %L $$, :'l')), 'none') in ('none', '42501'),
  'Besitzer ändert die entfernte Anzeige nicht …');
select tests.as_postgres();
select is((select status::text from listings where id = :'l'), 'removed', '… die Anzeige bleibt removed');
select is(tests.err(format($$ update listings set status = 'pending_review' where id = %L $$, :'l')), '42501',
  'Ohne Flag revier.appeal verlässt keine Anzeige removed, auch nicht der Server');

-- ---------------------------------------------------------------------------
-- 4. Kartenpunkt, Nachricht ohne Maßnahme
-- ---------------------------------------------------------------------------
select tests.authenticate_as(:'adm', 'aal2');
select is(resolve_reports('listing', :'lp', 'point_removed', null, 'Lage zu genau'), 'point_removed', 'Kartenpunkt entfernt');
select tests.as_postgres();
select ok((select display_location is null and status = 'active' from listings where id = :'lp'), 'Punkt weg, Anzeige aktiv');
select is((select count(*)::int from audit_log where action = 'listing.point_removed' and target_id = :'lp'), 1, 'Audit listing.point_removed');
select tests.authenticate_as(:'adm', 'aal2');
select is(resolve_reports('message', :'m_o', 'no_action', null, 'Kein Verstoß erkennbar'), 'no_action', 'Nachricht: keine Maßnahme');

-- ---------------------------------------------------------------------------
-- 5. Konto: suchen, verwarnen, sperren
-- ---------------------------------------------------------------------------
select is((select display_name from admin_find_account('m9r-owner@test.local')), 'Olaf', 'Suche nach exakter E-Mail');
select is((select display_name from admin_find_account(:'o')), 'Olaf', 'Suche nach UUID');
select is((select count(*)::int from admin_find_account('m9r-adm@test.local')), 0, 'Nie das eigene Konto');
select tests.as_postgres();
select ok(not exists (select 1 from audit_log where action = 'user.looked_up' and details::text like '%@%'), 'Audit ohne gesuchte Adresse');
update private.app_settings set value = '3' where key = 'admin_lookup_limit_per_hour';
select tests.authenticate_as(:'adm', 'aal2');
select is(tests.err($$ select * from admin_find_account('x@test.local') $$), '54000', 'Gemeinsames Limit mit admin_find_user');
select tests.as_postgres();
update private.app_settings set value = '30' where key = 'admin_lookup_limit_per_hour';
select tests.authenticate_as(:'adm', 'aal2');
select is(tests.err(format($$ select admin_warn_account(%L, null) $$, :'o')), '23514', 'Verwarnung braucht einen Code');
select is(tests.err(format($$ select admin_warn_account(%L, 'other') $$, :'o')), '23514', 'other braucht Freitext');
select is(tests.err(format($$ select admin_warn_account(%L, 'spam') $$, :'adm')), '42501', 'Nicht das eigene Konto');
select is(tests.hint(format($$ select admin_set_account_blocked(%L, true, 'spam') $$, :'adm2')), '{"reason":"admin_role"}',
  'Kein Konto mit Rolle sperren');
select is(tests.err(format($$ select admin_warn_account(%L, 'spam') $$, gen_random_uuid())), 'P0002', 'Unbekanntes Konto: P0002');
select admin_warn_account(:'o', 'spam', 'Bitte keine Wiederholungen') as warn \gset
select tests.authenticate_as(:'adm', 'aal2');
select is(resolve_reports('profile', :'o', 'account_blocked', 'harassment', 'Beleidigungen in Nachrichten'), 'account_blocked', 'Sperre über Meldung');
select tests.as_postgres();
select ok((select is_blocked from profiles where user_id = :'o'), 'Konto gesperrt');
select is((select details ->> 'code' from audit_log where action = 'profile.blocked' and target_id = :'o'), 'harassment', 'Audit mit Code');
select is((select count(*)::int from audit_log where action = 'profile.blocked' and target_id = :'o'), 1, 'Genau ein Audit (profiles_audit schweigt)');
select is(tests.notes(:'o'), array['account_blocked', 'account_warned'], 'Mails an das Konto');
select tests.authenticate_as(:'adm', 'aal2');
select is(tests.err(format($$ select admin_set_account_blocked(%L, true, 'spam') $$, :'o')), 'RV003', 'Schon gesperrt: RV003');

-- ---------------------------------------------------------------------------
-- 6. Beschwerden
-- ---------------------------------------------------------------------------
select tests.authenticate_as(:'o');
select tests.decision(:'o', 'profile.blocked') as d_block \gset
select tests.decision(:'o', 'listing.removed') as d_rem \gset
select tests.decision(:'o', 'profile.warned') as d_warn \gset
select is(tests.err(format($$ select submit_appeal(%L, 'zu kurz') $$, :'d_block')), '23514', 'Text mindestens 10 Zeichen');
select submit_appeal(:'d_block', 'Ich habe niemanden beleidigt, bitte prüfen.') as ap_block \gset
select ok(:'ap_block' is not null, 'Gesperrtes Konto legt Beschwerde ein (ohne Legal-Gate)');
select is(tests.err(format($$ select submit_appeal(%L, 'Noch einmal dieselbe Beschwerde.') $$, :'d_block')), '23505', 'Eine Beschwerde je Entscheidung');
select submit_appeal(:'d_rem', 'Es waren keine Waffen, nur ein Foto vom Hochsitz.') as ap_rem \gset
select is(tests.err(format($$ select submit_appeal(%L, 'Fremde Entscheidung anfechten.') $$, (select tests.decision(:'r1', 'report.handled')))),
  'P0002', 'Fremde Entscheidung: P0002');
select is(tests.err(format($$ select submit_appeal(%L, 'Unbekannte Entscheidung anfechten.') $$, gen_random_uuid())), 'P0002', 'Unbekannt: P0002');
select tests.as_postgres();
update audit_log set created_at = now() - interval '184 days' where id = :'d_warn';
select tests.authenticate_as(:'o');
select is(tests.err(format($$ select submit_appeal(%L, 'Zu spät angefochten, bitte prüfen.') $$, :'d_warn')), 'P0002', 'Abgelaufen: P0002');
select ok((select not appealable and appeal_id is not null from my_decisions() where id = :'d_block'), 'my_decisions zeigt die Beschwerde');
select is((select count(*)::int from appeals), 2, 'Nur eigene Beschwerden lesbar');
select tests.authenticate_as(:'r1');
select is((select count(*)::int from appeals), 0, 'Fremde Beschwerden unsichtbar');

select tests.authenticate_as(:'adm', 'aal2');
select is((select count(*)::int from admin_appeal_queue()), 2, 'Warteschlange der Beschwerden');
select ok((select same_reviewer_only from admin_appeal_queue() q where q.id = :'ap_block'), 'Markiert: eigene ursprüngliche Entscheidung');
select is((admin_appeal(:'ap_block') -> 'decision' ->> 'action'), 'profile.blocked', 'Detail mit Entscheidung');
select ok(not ((admin_appeal(:'ap_block') -> 'decision') ? 'actor_id'), 'Ohne Admin-Identität');
select is(tests.err(format($$ select decide_appeal(%L, 'reversed', 'Geprüft') $$, :'ap_block')), '42501',
  'Nicht der ursprüngliche Admin, solange ein anderer verfügbar ist');
select is(tests.err(format($$ select decide_appeal(%L, 'reversed', '') $$, :'ap_block')), '23514', 'Begründung Pflicht');
select tests.authenticate_as(:'adm2', 'aal2');
select is(decide_appeal(:'ap_block', 'reversed', 'Die Nachrichten waren keine Beleidigung.'), 'reversed', 'Rücknahme durch einen anderen Admin');
select is(tests.err(format($$ select decide_appeal(%L, 'upheld', 'Doch nicht') $$, :'ap_block')), 'RV003', 'Schon entschieden: RV003');
select tests.as_postgres();
select ok(not (select is_blocked from profiles where user_id = :'o'), 'Sperre aufgehoben');
select is((select count(*)::int from audit_log where action = 'appeal.reversed' and target_id = :'ap_block'), 1, 'Audit appeal.reversed');
select is(tests.notes(:'o'), array['account_blocked', 'account_unblocked', 'account_warned', 'appeal_decided'], 'Mails zu Entsperrung und Beschwerde');

-- Entfernte Anzeige zurück in die Prüfung, vorne in der Warteschlange
select tests.authenticate_as(:'adm2', 'aal2');
select decide_appeal(:'ap_rem', 'reversed', 'Kein Waffenangebot.');
select tests.as_postgres();
select is((select status::text from listings where id = :'l'), 'pending_review', 'removed → pending_review');
select ok((select submitted_at < now() - interval '19 days' from listings where id = :'l'), 'Alte Einreichungszeit: vorne');
select tests.authenticate_as(:'adm', 'aal2');
select is((select id from admin_review_queue() limit 1), :'l'::uuid, 'Steht vorne in der Warteschlange');

-- Ausweichregel: ohne anderen verfügbaren Admin entscheidet der ursprüngliche Admin (markiert).
select tests.as_postgres();
delete from auth.mfa_factors where id = :'adm2_factor';
select decision_audit_id as d_msg from reports where id = :'rep_m' \gset
select tests.authenticate_as(:'r1');
select submit_appeal(:'d_msg', 'Die Nachricht war eindeutig Betrug.') as ap_r1 \gset
select tests.authenticate_as(:'adm', 'aal2');
select is(decide_appeal(:'ap_r1', 'reversed', 'Neu geprüft.'), 'reversed', 'Ausweichregel greift');
select tests.as_postgres();
select ok((select same_reviewer from appeals where id = :'ap_r1'), 'same_reviewer markiert');
select ok((select (details ->> 'same_reviewer')::boolean from audit_log where action = 'appeal.reversed' and target_id = :'ap_r1'),
  'same_reviewer im Audit');
select is((select status::text || ':' || coalesce(outcome, '-') from reports where id = :'rep_m'), 'open:-',
  'Beschwerde einer Meldenden: Meldung wieder offen');
select ok((select count(*) = 1 from audit_log where action = 'report.reopened' and target_id = :'rep_m'), 'Audit report.reopened');

-- ---------------------------------------------------------------------------
-- 7. Dienstmails, Export, Fristen
-- ---------------------------------------------------------------------------
select claim_account_notifications(:'secret', 50) as claims \gset
select is((select e -> 'details' ->> 'code' from jsonb_array_elements(:'claims'::jsonb) e where e ->> 'kind' = 'account_blocked'), 'harassment',
  'account_blocked: Code');
select ok((select (e -> 'details' ->> 'appeal_until') is not null from jsonb_array_elements(:'claims'::jsonb) e where e ->> 'kind' = 'account_warned'),
  'account_warned: Frist');
select is((select array_agg(distinct k order by k) from jsonb_array_elements(:'claims'::jsonb) e, jsonb_object_keys(e -> 'details') k
           where e ->> 'kind' = 'report_resolved' and e ->> 'email' = 'm9r-r2@test.local'),
  array['appeal_until', 'decided_at', 'listing_title', 'outcome', 'target_type'], 'report_resolved: nur Ziel und Ergebnis');
select is((select e -> 'details' ->> 'status' from jsonb_array_elements(:'claims'::jsonb) e
           where e ->> 'kind' = 'appeal_decided' and e ->> 'email' = 'm9r-owner@test.local' limit 1), 'reversed', 'appeal_decided: Ergebnis');
select ok(not (:'claims'::jsonb::text ~ 'm9r-adm'), 'Keine Admin-Adresse in den Mails');
select tests.authenticate_as(:'o');
select export_my_data() as ex \gset
select tests.as_postgres();
select is(jsonb_array_length(:'ex'::jsonb -> 'appeals'), 2, 'Export: Beschwerden');
select ok(jsonb_array_length(:'ex'::jsonb -> 'decisions') >= 3, 'Export: Entscheidungen');
select ok(not (:'ex'::jsonb::text ~ :'adm'), 'Export ohne Admin-ID');
update appeals set decided_at = now() - interval '25 months', created_at = now() - interval '26 months' where id = :'ap_block';
select ok((private.purge_trust_records() ->> 'appeals')::int >= 1, 'Beschwerden nach 24 Monaten gelöscht');
select is((select count(*)::int from appeals where id = :'ap_block'), 0, '… weg');

select * from finish();
rollback;
