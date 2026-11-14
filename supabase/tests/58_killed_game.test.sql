begin;
\ir _helpers.psql
select plan(9);

-- M10a Schritt 6: Grund „Foto zeigt erlegtes Wild“ (killed_game) für Ablehnen und für das Entfernen nach Meldungen.
-- Die Migration ersetzt in resolve_reports nur die Code-Liste (ADR 022, S2): Funktion muss weiter SECURITY DEFINER mit
-- leerem search_path sein und darf für anon nicht ausführbar werden.
set constraints all immediate;

create function tests.state_of_58(statement text) returns text language plpgsql as $$
begin
  execute statement;
  return 'ok';
exception when others then
  return sqlstate;
end;
$$;

select tests.create_user('owner58@test.local') as owner_id \gset
select tests.create_user('mod58@test.local') as mod_id \gset
select tests.create_user('reporter58@test.local') as reporter_id \gset
select tests.make_admin(:'mod_id');
select id as dd from regions where code = 'DE-14612' \gset

select tests.as_postgres();
insert into public.listings (owner_id, kind, direction, title, content_language, region_id)
values (:'owner_id', 'helper', 'offer', 'Q58 Anzeige mit Streckenfoto', 'de', :'dd') returning id as l1 \gset
select tests.make_ready(:'l1');
update public.listings set status = 'pending_review' where id = :'l1';
insert into public.listings (owner_id, kind, direction, title, content_language, region_id, status, expires_at)
values (:'owner_id', 'helper', 'offer', 'Q58 Öffentliche Anzeige', 'de', :'dd', 'active', now() + interval '30 days') returning id as l2 \gset
select tests.make_ready(:'l2');

-- Ablehnen in der Prüfung
select tests.authenticate_as(:'mod_id', 'aal2');
select admin_listing_version(:'l1') as v1 \gset
select is(moderate_listing(:'l1', 'reject', :'v1', 'killed_game'), 'rejected'::listing_status, 'Ablehnen mit Grund killed_game');
select tests.authenticate_as(:'owner_id');
select is((select reject_code from listings where id = :'l1'), 'killed_game', 'Besitzer sieht den Code');

-- Entfernen nach Meldung
select tests.authenticate_as(:'reporter_id');
insert into reports (target_type, target_id, reason) values ('listing', :'l2', 'other');
select tests.authenticate_as(:'mod_id', 'aal2');
select is(resolve_reports('listing', :'l2', 'content_removed', 'killed_game', 'Q58 Streckenfoto',
  (admin_report_target('listing', :'l2') -> 'listing' ->> 'version')), 'content_removed', 'Entfernen nach Meldung mit killed_game');
select tests.as_postgres();
select is((select (status, reject_code)::text from listings where id = :'l2'), '(removed,killed_game)', 'Anzeige entfernt, Code gespeichert');

-- Funktion nach dem Ersetzen unverändert abgesichert
select ok((select prosecdef from pg_proc where oid = 'public.resolve_reports(report_target, uuid, text, text, text, text)'::regprocedure),
  'resolve_reports bleibt SECURITY DEFINER');
select ok((select proconfig @> array['search_path=""'] from pg_proc where oid = 'public.resolve_reports(report_target, uuid, text, text, text, text)'::regprocedure),
  'resolve_reports behält search_path leer');
select ok(not has_function_privilege('anon', 'public.resolve_reports(report_target, uuid, text, text, text, text)', 'execute'),
  'anon darf resolve_reports nicht ausführen');
select is((select count(*)::int from pg_constraint where contypid = 'public.listing_reject_code'::regtype
           and pg_get_constraintdef(oid) like '%killed_game%'), 1, 'Domain listing_reject_code kennt killed_game (ADR 022 S3)');
select is(tests.state_of_58($$ update public.listings set reject_code = 'nonsense' where id = '$$ || :'l1' || $$' $$), '23514', 'Unbekannter Code bleibt verboten');

select * from finish();
rollback;
