begin;
\ir _helpers.psql
select plan(30);

-- QA M6 Nachprüfung (docs/QA-REPORT.md „M6 – Nachprüfung“): F4–F7 nach Migration 20261104100000, dazu Regressions-
-- proben zur Guard-Änderung (F7) an allen Pfaden, zu extra_float_digits (Paging) und zum Zod/DB-Gleichstand der
-- 30°-Grenze. Bekannte Abweichungen als TODO (N-Nummern).
set constraints all immediate;

create function tests.qa7_err(statement text) returns text language plpgsql as $$
declare h text; s text;
begin
  execute statement;
  return 'ok';
exception when others then
  get stacked diagnostics h = pg_exception_hint, s = returned_sqlstate;
  return s || coalesce(' ' || case when h !~ ' ' then nullif(h, '') end, '');
end;
$$;
grant execute on function tests.qa7_err(text) to anon, authenticated, service_role;
grant usage on schema tests to service_role;

select tests.create_user('qa7-o@test.local') as o \gset
select tests.create_user('qa7-fan@test.local') as fan \gset
select tests.create_user('qa7-adm@test.local') as adm \gset
select tests.make_admin(:'adm');
select id as big from regions where code = 'DE-14628' \gset
select id as big2 from regions where code = 'DE-14625' \gset

-- Anzeige mit Punkt, über die Moderation freigegeben (Freigabe-Hash wie im Betrieb).
create function tests.qa7_listing(owner uuid, adm uuid, title text, region uuid, approve boolean default true) returns uuid
language plpgsql as $$
declare
  listing uuid;
  version text;
begin
  perform tests.authenticate_as(owner);
  insert into public.listings (kind, direction, title, content_language, region_id) values ('helper', 'offer', title, 'de', region)
  returning id into listing;
  perform tests.as_postgres();
  perform tests.make_ready(listing);
  perform tests.authenticate_as(owner);
  perform public.set_listing_location(listing, region, (select postal_code from public.listing_places where listing_id = listing),
    'Testort', 'set', 50.95, 13.95);
  update public.listings set status = 'pending_review' where id = listing;
  if approve then
    perform tests.authenticate_as(adm, 'aal2');
    version := public.admin_listing_version(listing);
    perform public.moderate_listing(listing, 'approve', version);
  end if;
  perform tests.as_postgres();
  return listing;
end;
$$;

select tests.qa7_listing(:'o', :'adm', 'QA7 aktiv', :'big') as la \gset
select tests.qa7_listing(:'o', :'adm', 'QA7 Inhalt', :'big') as lb \gset
select tests.qa7_listing(:'o', :'adm', 'QA7 pausiert', :'big') as lp \gset
select tests.qa7_listing(:'o', :'adm', 'QA7 Prüfung', :'big', false) as lq \gset
select tests.qa7_listing(:'o', :'adm', 'QA7 Besitzer', :'big') as lo \gset
select tests.qa7_listing(:'o', :'adm', 'QA7 Server', :'big') as lsv \gset
select tests.qa7_listing(:'o', :'adm', 'QA7 Liste 1', :'big') as lf1 \gset
select tests.qa7_listing(:'o', :'adm', 'QA7 Liste 2', :'big') as lf2 \gset
select is((select count(*)::int from listings where id in (:'la', :'lb', :'lp', :'lo', :'lsv', :'lf1', :'lf2') and status = 'active'
           and display_location is not null), 7, 'Vorbereitung: sieben aktive Anzeigen mit Punkt');

-- F7: Moderation entfernt den Punkt an aktiver, pausierter und eingereichter Anzeige
select submitted_at as la_sub from listings where id = :'la' \gset
select tests.authenticate_as(:'adm', 'aal2');
update listings set display_location = null where id = :'la';
select tests.as_postgres();
select is((select status::text from listings where id = :'la'), 'active', 'F7: aktiv bleibt aktiv');
select is((select submitted_at::text from listings where id = :'la'), :'la_sub', 'F7: submitted_at unverändert');
select is((select details ->> 'status' from audit_log where target_id = :'la' and action = 'listing.point_removed' and actor_id = :'adm'), 'active',
  'F7: genau ein Audit-Eintrag mit Status');

select tests.authenticate_as(:'o');
update listings set status = 'paused' where id = :'lp';
select tests.authenticate_as(:'adm', 'aal2');
update listings set display_location = null where id = :'lp';
select tests.as_postgres();
select is((select status::text from listings where id = :'lp'), 'paused', 'F7: pausiert bleibt pausiert');
select tests.authenticate_as(:'o');
update listings set status = 'active' where id = :'lp';
select tests.as_postgres();
select todo('N2: Punktentfernung durch die Moderation macht den Freigabe-Hash ungültig, Fortsetzen geht in die Prüfung', 1);
select is((select status::text from listings where id = :'lp'), 'active', 'Besitzer setzt nach Punktentfernung fort: wieder aktiv');

select submitted_at as lq_sub from listings where id = :'lq' \gset
select tests.authenticate_as(:'adm', 'aal2');
update listings set display_location = null where id = :'lq';
select tests.as_postgres();
select is((select status::text || '|' || submitted_at::text from listings where id = :'lq'), 'pending_review|' || :'lq_sub',
  'F7: eingereicht bleibt eingereicht, submitted_at unverändert');

-- F7: Die Ausnahme erlaubt nichts anderes
select tests.authenticate_as(:'adm', 'aal2');
select is(tests.qa7_err(format($$ update listings set display_location = null, title = 'QA7 neu' where id = %L $$, :'lb')), '42501',
  'Moderator: Punkt entfernen plus Titel 42501');
select is(tests.qa7_err(format($$ update listings set display_location = null, region_id = %L where id = %L $$, :'big2', :'lb')), '42501',
  'Moderator: Punkt entfernen plus Kreiswechsel 42501');
select is(tests.qa7_err(format($$ update listings set display_location = null, status = 'paused' where id = %L $$, :'lb')), '42501',
  'Moderator: Punkt entfernen plus Statuswechsel 42501');
select is(tests.qa7_err(format($$ update listings set display_location = null, reject_code = 'other' where id = %L $$, :'lb')), '42501',
  'Moderator: Punkt entfernen plus reject_code 42501');
select tests.as_postgres();
select is((select status::text || '|' || (display_location is not null)::text from listings where id = :'lb'), 'active|true',
  'Nach den Versuchen: Anzeige unverändert');

-- Admin ohne 2FA ist kein Moderator
select tests.authenticate_as(:'adm', 'aal1');
update listings set display_location = null where id = :'lb';
select tests.as_postgres();
select ok((select display_location is not null from listings where id = :'lb'), 'Admin mit aal1: Punkt bleibt');
select is((select count(*)::int from audit_log where target_id = :'lb' and action = 'listing.point_removed'), 0, 'Admin mit aal1: kein Audit');

-- Entfernte Anzeige bleibt gesperrt
-- (Entfernen läuft im Betrieb über die Admin-Aktion; hier als Server gesetzt.)
update listings set status = 'removed', reject_code = 'other', reject_reason = 'QA7' where id = :'lb';
select tests.authenticate_as(:'adm', 'aal2');
select is(tests.qa7_err(format($$ update listings set display_location = null where id = %L $$, :'lb')), '42501',
  'Moderator: Punkt an entfernter Anzeige 42501');

-- Besitzerpfad unverändert: eigenes Entfernen an aktiver Anzeige geht in die Prüfung, ohne Audit
select tests.authenticate_as(:'o');
select set_listing_location(:'lo', :'big', (select postal_code from listing_places where listing_id = :'lo'), 'Testort', 'clear');
select tests.as_postgres();
select is((select status::text from listings where id = :'lo'), 'pending_review', 'Besitzer entfernt Punkt: Prüfung wie bisher');
select is((select count(*)::int from audit_log where target_id = :'lo' and action = 'listing.point_removed'), 0, 'Besitzer: kein Audit');

-- Besitzer ohne aktuelle Zustimmung: Legal-Gate greift weiter
update legal_acceptances set version = 'alt' where user_id = :'o';
select tests.authenticate_as(:'o');
select is(tests.qa7_err(format($$ update listings set display_location = null where id = %L $$, :'lf2')), 'RV001',
  'Besitzer ohne Zustimmung: RV001');
select tests.as_postgres();
update legal_acceptances set version = private.setting_text('legal_terms_version') where user_id = :'o' and document = 'terms';
update legal_acceptances set version = private.setting_text('legal_privacy_version') where user_id = :'o' and document = 'privacy';

-- Serverpfad: kein Audit, Status bleibt
set local role service_role;
select is(tests.qa7_err(format($$ update listings set display_location = null where id = %L $$, :'lsv')), 'ok', 'service_role entfernt Punkt');
reset role;
select is((select status::text from listings where id = :'lsv'), 'active', 'service_role: Status bleibt');
select is((select count(*)::int from audit_log where target_id = :'lsv' and action = 'listing.point_removed'), 0, 'service_role: kein Audit');

-- F5
select tests.authenticate_as(:'o');
select is(tests.qa7_err(format($$ select set_listing_location(%L, %L, null, null, 'set', 50.9, null) $$, :'lf1', :'big')), '22023 point', 'F5: set ohne lng 22023');
select is(tests.qa7_err(format($$ select set_listing_location(%L, %L, null, null, 'set', null, null) $$, :'lf1', :'big')), '22023 point', 'F5: set ohne beide 22023');
select is(tests.qa7_err(format($$ select set_listing_location(%L, %L, null, null, 'set', 'NaN', 13.9) $$, :'lf1', :'big')), '22023 point', 'NaN weiter 22023');

-- F6 und Gleichstand der 30°-Grenze
select tests.as_anon();
select is(tests.qa7_err($$ select search_listings('{"v":1,"bbox":[-1e-400,45,10,50]}', null, 5) $$), '22023 bbox', 'F6: -1e-400 in der Suche 22023');
select is(array[private.search_filters_error('{"v":1,"bbox":[1e-310,45,10,50]}'), coalesce(private.search_filters_error('{"v":1,"bbox":[1e-300,45,10,50]}'), 'null'),
                coalesce(private.search_filters_error('{"v":1,"bbox":[-0,45,10,50]}'), 'null')],
  array['bbox', 'null', 'null'], 'F6: Grenze 1e-300 (subnormal abgelehnt, 1e-300 und -0 gültig)');
-- Zod lässt 30 + 1e-9 zu (web/lib/qa-m6-nachpruefung.test.ts, N1); die DB rechnet exakt.
select is(private.search_filters_error('{"v":1,"bbox":[0,0,30.0000000005,10]}'), 'bbox', 'DB: 30,0000000005° ist zu breit');

-- F4 mit Paging unter extra_float_digits = 0
select tests.as_postgres();
insert into favorites (user_id, listing_id) values (:'fan', :'lf1');
set local extra_float_digits = 0;
select tests.authenticate_as(:'fan');
select is((select (c -> 'point' ->> 'lng')::float8 = (select extensions.st_x(map_point) from public.listings where id = :'lf1')
               and (c -> 'point' ->> 'lat')::float8 = (select extensions.st_y(map_point) from public.listings where id = :'lf1')
           from jsonb_array_elements(my_favorites() -> 'items') c), true, 'F4: my_favorites bitgenau');
select tests.as_anon();
select provider_listings(:'o', null, 1) as p1 \gset
select is((select count(*)::int from (
             select e ->> 'id' from jsonb_array_elements((:'p1'::jsonb) -> 'items') e
             union all
             select e ->> 'id' from jsonb_array_elements(provider_listings(:'o', (:'p1'::jsonb) ->> 'next_cursor', 50) -> 'items') e) t),
  (select count(*)::int from listings where owner_id = :'o' and status = 'active'), 'provider_listings: Paging vollständig');
select ok((select bool_and((e -> 'point' ->> 'lng')::float8 = extensions.st_x(l.map_point))
           from jsonb_array_elements(provider_listings(:'o', null, 50) -> 'items') e join public.listings l on l.id = (e ->> 'id')::uuid),
  'F4: provider_listings bitgenau');
reset extra_float_digits;

select * from finish();
rollback;
