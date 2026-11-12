-- QA M9b – Nachprüfung (docs/QA-REPORT.md, „M9b – Nachprüfung“): Korrekturen F1–F6 aus 20261112160000_qa_m9b_fixes.
-- - F1: resolution_id nicht lesbar; mehrere Meldende einer Bearbeitung werden gemeinsam wieder geöffnet, frühere Zyklen
--   und andere Bearbeitungen nicht; Server-Pfad ohne RPC setzt keine resolution_id und erzeugt keine Entscheidung.
-- - F2: drei Admins: Ausweichregel greift nicht, solange ein Dritter verfügbar ist.
-- - F3: Kartenpunkt nur mit Anzeigen-Grund und Begründung; Audit, Mail mit Frist; direkter Weg ohne RPC.
-- - F4: je Meldendem und Bearbeitung eine Mail, Details aus dem Audit.
-- - F5: Codes je Maßnahme mit hint.
-- - F6: keine Admin-Policy im Dokument-Bucket, Rechte der RPC, Definer.
begin;
\ir _helpers.psql
select plan(30);

select s.decrypted_secret as secret from vault.decrypted_secrets s where s.name = 'search_notifications_secret' \gset

create function tests.q57_err(stmt text) returns text language plpgsql as $$
declare s text; h text;
begin
  execute stmt;
  return 'ok';
exception when others then
  get stacked diagnostics s = returned_sqlstate, h = pg_exception_hint;
  return s || coalesce(' ' || nullif(h, ''), '');
end;
$$;
grant execute on all functions in schema tests to authenticated;

select tests.create_user('q57-o@test.local', 'Olaf57') as o \gset
select tests.create_user('q57-r1@test.local', 'Rita57') as r1 \gset
select tests.create_user('q57-r2@test.local', 'Rolf57') as r2 \gset
select tests.create_user('q57-a@test.local', 'Ada57') as a \gset
select tests.create_user('q57-b@test.local', 'Ben57') as b \gset
select tests.create_user('q57-c@test.local', 'Cem57') as c \gset
select tests.make_admin(:'a');
select tests.make_admin(:'b');
select tests.make_admin(:'c');
insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at, secret)
values (gen_random_uuid(), :'a', 'q57a', 'totp', 'verified', now(), now(), 'x'),
       (gen_random_uuid(), :'b', 'q57b', 'totp', 'verified', now(), now(), 'x'),
       (gen_random_uuid(), :'c', 'q57c', 'totp', 'verified', now(), now(), 'x');
select id as dd from regions where code = 'DE-14612' \gset
insert into listings (owner_id, kind, direction, title, content_language, region_id, status, expires_at)
values (:'o', 'helper', 'offer', 'Q57 Ziel', 'de', :'dd', 'active', now() + interval '30 days') returning id as l \gset
select tests.make_ready(:'l');

-- ---------------------------------------------------------------------------
-- F1: resolution_id
-- ---------------------------------------------------------------------------
select ok(not has_column_privilege('authenticated', 'public.reports', 'resolution_id', 'select'), 'resolution_id per API nicht lesbar');
-- Zyklus 1: nur r1; Zyklus 2: r1 und r2 gemeinsam
select tests.authenticate_as(:'r1');
insert into reports (target_type, target_id, reason) values ('listing', :'l', 'scam') returning id as c1 \gset
select tests.authenticate_as(:'a', 'aal2');
select resolve_reports('listing', :'l', 'no_action', null, 'Zyklus 1');
select tests.authenticate_as(:'r1');
insert into reports (target_type, target_id, reason) values ('listing', :'l', 'scam') returning id as c2a \gset
select tests.authenticate_as(:'r2');
insert into reports (target_type, target_id, reason) values ('listing', :'l', 'weapons') returning id as c2b \gset
select tests.authenticate_as(:'a', 'aal2');
select resolve_reports('listing', :'l', 'no_action', null, 'Zyklus 2');
select tests.as_postgres();
select ok((select resolution_id from reports where id = :'c2a') = (select resolution_id from reports where id = :'c2b')
          and (select resolution_id from reports where id = :'c1') <> (select resolution_id from reports where id = :'c2a'),
  'Eine Bearbeitung = eine resolution_id, je Zyklus eine neue');
select decision_audit_id as d2b from reports where id = :'c2b' \gset
select tests.authenticate_as(:'r2');
select submit_appeal(:'d2b', 'Waffen im Bild, bitte erneut prüfen.') as ap \gset
select tests.authenticate_as(:'b', 'aal2');
select is(decide_appeal(:'ap', 'reversed', 'Neu prüfen'), 'reversed', 'Beschwerde von Rolf: reversed');
select tests.as_postgres();
select is((select array_agg(status::text order by created_at) from reports where target_id = :'l'), array['handled', 'open', 'open'],
  'Beide Meldungen der angefochtenen Bearbeitung offen (auch die von Rita), Zyklus 1 bleibt erledigt');
select ok((select bool_and(resolution_id is null and decision_audit_id is null) from reports where id in (:'c2a', :'c2b')),
  'Wiedereröffnet: resolution_id und Audit-Verweis zurückgesetzt');
-- Server-Pfad ohne RPC: keine resolution_id, keine Entscheidung
select count(*) as audits_before from audit_log where action = 'report.handled' \gset
update reports set status = 'handled', outcome = 'no_action' where id = :'c2a';
select ok((select resolution_id is null and decision_audit_id is null from reports where id = :'c2a')
          and (select count(*) from audit_log where action = 'report.handled') = :'audits_before'::bigint,
  'Server-Pfad (SQL): ohne resolution_id und ohne Entscheidung (nichts anfechtbar)');
update reports set status = 'open', outcome = null, handled_at = null where id = :'c2a';

-- ---------------------------------------------------------------------------
-- F4: je Meldendem eine Ergebnis-Mail, Details aus dem Audit
-- ---------------------------------------------------------------------------
update private.account_notifications set done_at = now() where done_at is null;
select tests.authenticate_as(:'c', 'aal2');
select resolve_reports('listing', :'l', 'account_warned', 'scam', 'Verwarnt nach Beschwerde');
select tests.as_postgres();
select is((select count(*)::int from private.account_notifications where kind = 'report_resolved' and done_at is null and user_id in (:'r1', :'r2')), 2,
  'Neue Bearbeitung: je Meldendem eine Mail');
select ok((select bool_and(n.ref_id = r.decision_audit_id) from private.account_notifications n join reports r on r.reporter_id = n.user_id and r.status = 'handled'
           and r.target_id = :'l' and r.outcome = 'account_warned' where n.kind = 'report_resolved' and n.done_at is null),
  'ref_id = Audit der Bearbeitung');
select claim_account_notifications(:'secret', 50) as claims \gset
select is((select array_agg(distinct e -> 'details' ->> 'outcome') from jsonb_array_elements(:'claims'::jsonb) e where e ->> 'kind' = 'report_resolved'),
  array['account_warned'], 'Mail nennt das neue Ergebnis');
select is((select array_agg(distinct k order by k) from jsonb_array_elements(:'claims'::jsonb) e, jsonb_object_keys(e -> 'details') k where e ->> 'kind' = 'report_resolved'),
  array['appeal_until', 'decided_at', 'listing_title', 'outcome', 'target_type'], 'Details weiter nur Ziel und Ergebnis');
select ok(not ((select jsonb_agg(e) from jsonb_array_elements(:'claims'::jsonb) e where e ->> 'kind' = 'report_resolved')::text
              ~ 'Verwarnt nach Beschwerde|Cem57|q57-c@|Olaf57'), 'Ergebnis-Mail ohne Begründung, Admin und Betroffenen');

-- ---------------------------------------------------------------------------
-- F2: drei Admins
-- ---------------------------------------------------------------------------
insert into listings (owner_id, kind, direction, title, content_language, region_id, status, expires_at)
values (:'b', 'helper', 'offer', 'Q57 Admin-Anzeige', 'de', :'dd', 'active', now() + interval '30 days') returning id as lb \gset
select tests.make_ready(:'lb');
select tests.authenticate_as(:'r1');
insert into reports (target_type, target_id, reason) values ('listing', :'lb', 'weapons');
select tests.authenticate_as(:'a', 'aal2');
select resolve_reports('listing', :'lb', 'content_removed', 'weapons', 'Q57 entfernt', (admin_report_target('listing', :'lb') -> 'listing' ->> 'version'));
select tests.as_postgres();
select id as d_lb from audit_log where action = 'listing.removed' and target_id = :'lb' \gset
select tests.authenticate_as(:'b');
select submit_appeal(:'d_lb', 'Meine Anzeige war in Ordnung, bitte prüfen.') as ap_b \gset
select tests.authenticate_as(:'a', 'aal2');
select is(tests.q57_err(format($$ select decide_appeal(%L, 'reversed', 'x') $$, :'ap_b')), '42501 {"reason":"same_reviewer"}',
  'Drei Admins: Ada (ursprünglich) darf nicht, Cem ist verfügbar');
select tests.authenticate_as(:'c', 'aal2');
select is(decide_appeal(:'ap_b', 'upheld', 'Bleibt entfernt'), 'upheld', 'Cem entscheidet');
select tests.as_postgres();
select ok(not (select same_reviewer from appeals where id = :'ap_b'), 'ohne same_reviewer');
select ok(not has_function_privilege('authenticated', 'private.other_admin_available(uuid)', 'execute')
          and not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                          where n.nspname = 'private' and p.proname = 'other_admin_available' and p.pronargs = 0),
  'other_admin_available(uuid) nicht für Nutzer, alte Signatur entfernt');

-- ---------------------------------------------------------------------------
-- F3/F5: Kartenpunkt und Codes
-- ---------------------------------------------------------------------------
select id as big from regions where code = 'DE-14628' \gset
insert into listings (owner_id, kind, direction, title, content_language, region_id) values (:'o', 'helper', 'offer', 'Q57 Punkt', 'de', :'big')
returning id as lp \gset
select tests.make_ready(:'lp');
select tests.authenticate_as(:'o');
select set_listing_location(:'lp', :'big', (select postal_code from listing_places where listing_id = :'lp'), 'Testort', 'set', 50.95, 13.95);
update listings set status = 'pending_review' where id = :'lp';
select tests.authenticate_as(:'a', 'aal2');
select moderate_listing(:'lp', 'approve', admin_listing_version(:'lp'));
select tests.authenticate_as(:'r2');
insert into reports (target_type, target_id, reason) values ('listing', :'lp', 'other');
select tests.authenticate_as(:'a', 'aal2');
select is(tests.q57_err(format($$ select resolve_reports('listing', %L, 'point_removed', 'scam', 'x') $$, :'lp')), '23514 {"fields":["code"]}',
  'Kartenpunkt mit Konto-Code: 23514 fields code');
select is(tests.q57_err(format($$ select resolve_reports('listing', %L, 'point_removed', 'other', '  ') $$, :'lp')), '23514 {"fields":["note"]}',
  'Kartenpunkt ohne Begründung: 23514 fields note');
select is(tests.q57_err(format($$ select resolve_reports('listing', %L, 'account_warned', 'incomplete', 'x') $$, :'lp')), '23514 {"fields":["code"]}',
  'Verwarnen mit Anzeigen-Code: 23514 fields code');
select is(tests.q57_err(format($$ select resolve_reports('listing', %L, 'content_removed', 'harassment', 'x', 'v') $$, :'lp')), '23514 {"fields":["code"]}',
  'Entfernen mit Konto-Code: 23514 fields code (vor der Versionsprüfung)');
select is(resolve_reports('listing', :'lp', 'point_removed', 'contact_in_text', 'Q57 Hochsitz erkennbar'), 'point_removed', 'Kartenpunkt entfernt');
select tests.as_postgres();
select is((select details ->> 'code' || '|' || (details ->> 'reason') from audit_log where action = 'listing.point_removed' and target_id = :'lp'),
  'contact_in_text|Q57 Hochsitz erkennbar', 'Audit mit Code und Begründung');
select is((select decision || '|' || reject_code || '|' || reason from private.moderation_notifications where listing_id = :'lp' and decision = 'point_removed'),
  'point_removed|contact_in_text|Q57 Hochsitz erkennbar', 'Moderations-Mail point_removed angelegt');
select claim_moderation_notifications(:'secret', 50) as mclaims \gset
select ok((select (e ->> 'appeal_until')::timestamptz > now() + interval '182 days' from jsonb_array_elements(:'mclaims'::jsonb) e
           where e ->> 'decision' = 'point_removed'), 'Mail mit Frist zum Anfechten');
select tests.authenticate_as(:'o');
select is((select code || '|' || reason from my_decisions() where action = 'listing.point_removed'), 'contact_in_text|Q57 Hochsitz erkennbar',
  'Besitzer sieht Grund und Begründung');
select is(current_setting('revier.point_code', true) || current_setting('revier.point_note', true), '', 'Flags nach der RPC zurückgesetzt');
-- Direkter Weg ohne RPC: Admin setzt display_location wie per PostgREST (Spaltenrecht für set_listing_location)
select tests.as_postgres();
set local session_replication_role = replica;
update listings set display_location = extensions.st_setsrid(extensions.st_makepoint(13.95, 50.95), 4326)::extensions.geography where id = :'lp';
set local session_replication_role = origin;
select tests.authenticate_as(:'a', 'aal2');
-- N1 behoben (Migration 20261112170000_qa_m9b_recheck): ohne Flag aus resolve_reports kein Entfernen durch Admins.
select set_config('revier.point_code', '', true);
select is(tests.q57_err(format($$ update listings set display_location = null where id = %L $$, :'lp')), '42501',
  'Admin entfernt den Punkt nicht am RPC vorbei (sonst Mail ohne Begründung)');

select tests.as_postgres();
select is((select count(*)::int from private.moderation_notifications where listing_id = :'lp' and decision = 'point_removed' and reason is null), 0,
  'N1: keine Mail point_removed ohne Begründung');

-- ---------------------------------------------------------------------------
-- F6: Bucket und RPC
-- ---------------------------------------------------------------------------
select tests.as_postgres();
select is((select count(*)::int from pg_policies where schemaname = 'storage' and tablename = 'objects' and cmd in ('SELECT', 'ALL')
           and coalesce(qual, '') like '%verification-docs%' and coalesce(qual, '') ~ 'is_admin'), 0,
  'Keine Admin-Select-Policy im Dokument-Bucket');
select ok(not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'private' and p.proname = 'verification_document_viewed'),
  'verification_document_viewed entfernt');
select ok(not has_function_privilege('anon', 'public.admin_open_verification_document(uuid)', 'execute')
          and (select prosecdef from pg_proc where oid = 'public.admin_open_verification_document(uuid)'::regprocedure),
  'admin_open_verification_document: Definer, nicht für anon');

select * from finish();
rollback;
