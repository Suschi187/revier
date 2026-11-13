begin;
\ir _helpers.psql
select plan(4);

-- M10a Schritt 6: Grund „Foto zeigt erlegtes Wild“ (killed_game) für Ablehnen und für das Entfernen nach Meldungen.
set constraints all immediate;

select tests.create_user('owner58@test.local') as owner_id \gset
select tests.create_user('mod58@test.local') as mod_id \gset
select tests.make_admin(:'mod_id');
select id as dd from regions where code = 'DE-14612' \gset

select tests.as_postgres();
insert into public.listings (owner_id, kind, direction, title, content_language, region_id)
values (:'owner_id', 'helper', 'offer', 'Q58 Anzeige mit Streckenfoto', 'de', :'dd') returning id as l1 \gset
select tests.make_ready(:'l1');
update public.listings set status = 'pending_review' where id = :'l1';

select tests.authenticate_as(:'mod_id', 'aal2');
select admin_listing_version(:'l1') as v1 \gset
select is(moderate_listing(:'l1', 'reject', :'v1', 'killed_game'), 'rejected'::listing_status, 'Ablehnen mit Grund killed_game');

select tests.authenticate_as(:'owner_id');
select is((select reject_code from listings where id = :'l1'), 'killed_game', 'Besitzer sieht den Code');

select tests.as_postgres();
select ok(pg_get_functiondef('public.resolve_reports(report_target, uuid, text, text, text, text)'::regprocedure) like '%''killed_game''%',
  'resolve_reports kennt killed_game');
select is((select count(*)::int from pg_constraint where conname = 'listings_reject_code_check'
           and pg_get_constraintdef(oid) like '%killed_game%'), 1, 'Check auf listings.reject_code kennt killed_game');

select * from finish();
rollback;
