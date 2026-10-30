begin;
\ir _helpers.psql
select plan(34);

-- M4 Commit 3 (ADR 014): RPC moderate_listing mit Version (B1), admin_listing_version, Hinweise und
-- Warteschlange für Admins (A7, A8). Fehlercodes laut Vertrag in ADR 014.
set constraints all immediate;

create function tests.state_of(statement text) returns text language plpgsql as $$
begin
  execute statement;
  return 'ok';
exception when others then
  return sqlstate;
end;
$$;
grant execute on function tests.state_of(text) to authenticated, anon;

select tests.create_user('owner@test.local') as owner_id \gset
select tests.create_user('mod@test.local') as mod_id \gset
select tests.create_user('mod2@test.local') as mod2_id \gset
select tests.create_user('user@test.local') as user_id \gset
select tests.make_admin(:'mod_id');
select tests.make_admin(:'mod2_id');
select id as dd from regions where code = 'DE-14612' \gset

-- Drei eingereichte Anzeigen des Besitzers, eine eigene des Admins
create function tests.submitted(owner uuid, title text, region uuid) returns uuid language plpgsql as $$
declare
  listing uuid;
begin
  perform tests.as_postgres();
  insert into public.listings (owner_id, kind, direction, title, content_language, region_id)
  values (owner, 'helper', 'offer', title, 'de', region) returning id into listing;
  perform tests.make_ready(listing);
  update public.listings set status = 'pending_review' where id = listing;
  return listing;
end;
$$;
select tests.submitted(:'owner_id', 'Erste Anzeige mit Büchse', :'dd') as l1 \gset
select tests.submitted(:'owner_id', 'Zweite Anzeige', :'dd') as l2 \gset
select tests.submitted(:'owner_id', 'Dritte Anzeige', :'dd') as l3 \gset
select tests.submitted(:'mod_id', 'Eigene des Admins', :'dd') as own \gset

-- Version: nur Admins an fremden Anzeigen
select tests.authenticate_as(:'user_id');
select is(admin_listing_version(:'l1'), null, 'Nutzer bekommt keine Version');
select tests.authenticate_as(:'mod_id', 'aal1');
select is(admin_listing_version(:'l1'), null, 'Admin ohne 2FA bekommt keine Version');
select tests.authenticate_as(:'owner_id');
select is(admin_listing_version(:'l1'), null, 'Besitzer bekommt keine Version (Orakel)');
select tests.authenticate_as(:'mod_id', 'aal2');
select admin_listing_version(:'l1') as v1 \gset
select admin_listing_version(:'l2') as v2 \gset
select admin_listing_version(:'l3') as v3 \gset
select ok(:'v1' ~ '^[0-9a-f]{64}$', 'Admin bekommt die Version als hex');
select is(admin_listing_version(:'own'), null, 'Keine Version für die eigene Anzeige');

-- Rechte
select tests.authenticate_as(:'user_id');
select is(tests.state_of(format($$ select moderate_listing(%L, 'approve', %L) $$, :'l1', :'v1')), '42501', 'Nutzer moderiert nicht');
select tests.authenticate_as(:'mod_id', 'aal1');
select is(tests.state_of(format($$ select moderate_listing(%L, 'approve', %L) $$, :'l1', :'v1')), '42501', 'Admin ohne 2FA moderiert nicht');
select tests.authenticate_as(:'mod_id', 'aal2');
select is(tests.state_of(format($$ select moderate_listing(%L, 'approve', 'x') $$, :'own')), '42501', 'Admin moderiert die eigene Anzeige nicht');
select is(tests.state_of(format($$ select moderate_listing(%L, 'approve', 'x') $$, gen_random_uuid())), 'P0002', 'Unbekannte Anzeige');
select is(tests.state_of(format($$ select moderate_listing(%L, 'publish', %L) $$, :'l1', :'v1')), '22023', 'Unbekannte Entscheidung');

-- Gesehener Stand (B1): Änderungen des Besitzers nach dem Lesen der Version
select is(tests.state_of(format($$ select moderate_listing(%L, 'approve', %L) $$, :'l1', :'v2')), 'RV004', 'Fremde Version passt nicht');
select tests.authenticate_as(:'owner_id');
update listings set description = 'Neue Beschreibung mit mehr als dreißig Zeichen, nachträglich.' where id = :'l1';
select tests.authenticate_as(:'mod_id', 'aal2');
select is(tests.state_of(format($$ select moderate_listing(%L, 'approve', %L) $$, :'l1', :'v1')), 'RV004', 'Geänderte Beschreibung: RV004');
select tests.authenticate_as(:'owner_id');
insert into listing_species (listing_id, species_code) values (:'l2', 'red_deer');
select tests.authenticate_as(:'mod_id', 'aal2');
select is(tests.state_of(format($$ select moderate_listing(%L, 'reject', %L, 'incomplete') $$, :'l2', :'v2')), 'RV004', 'Neue Wildart: RV004 auch beim Ablehnen');
select tests.authenticate_as(:'owner_id');
select set_listing_location(:'l3', :'dd', (select postal_code from listing_places where listing_id = :'l3'), 'Anderer Ort');
select tests.authenticate_as(:'mod_id', 'aal2');
select is(tests.state_of(format($$ select moderate_listing(%L, 'approve', %L) $$, :'l3', :'v3')), 'RV004', 'Geänderter Ort: RV004');
select is((select count(*)::int from listings where id in (:'l1', :'l2', :'l3') and status = 'pending_review'), 3, 'Nichts entschieden');

-- Freigeben mit frischer Version
select admin_listing_version(:'l1') as v1 \gset
select is(moderate_listing(:'l1', 'approve', :'v1', 'weapons', 'wird ignoriert'), 'active'::listing_status, 'Freigabe');
select tests.as_postgres();
select is((select (status, reject_code, reject_reason, expires_at > now())::text from listings where id = :'l1'), '(active,,,t)',
  'Aktiv, ohne Grund, mit Ablaufdatum');
select ok(exists (select 1 from private.listing_approvals where listing_id = :'l1'), 'Freigabe-Hash gespeichert');
select is((select details ->> 'from' from audit_log where target_id = :'l1' and action = 'listing.active'), 'pending_review', 'Audit der Freigabe');
select tests.as_anon();
select is((select count(*)::int from listings where id = :'l1'), 1, 'Freigegebene Anzeige ist öffentlich (Akzeptanz a)');

-- Zweite Entscheidung
select tests.authenticate_as(:'mod2_id', 'aal2');
select is(tests.state_of(format($$ select moderate_listing(%L, 'reject', %L, 'duplicate') $$, :'l1', :'v1')), 'RV003', 'Bereits entschieden: RV003');

-- Ablehnen und Zurückgeben
select admin_listing_version(:'l2') as v2 \gset
select is(tests.state_of(format($$ select moderate_listing(%L, 'reject', %L) $$, :'l2', :'v2')), '23514', 'Ablehnen ohne Code');
select is(tests.state_of(format($$ select moderate_listing(%L, 'reject', %L, 'other', E'  \n ') $$, :'l2', :'v2')), '23514',
  '„anderer Grund“ mit leerem Text');
select is(tests.state_of(format($$ select moderate_listing(%L, 'reject', %L, 'nonsense') $$, :'l2', :'v2')), '23514', 'Unbekannter Code');
select is(moderate_listing(:'l2', 'reject', :'v2', 'contact_in_text', '  Bitte Telefonnummer entfernen.  '), 'rejected'::listing_status, 'Ablehnen');
select tests.authenticate_as(:'owner_id');
select is((select (reject_code, reject_reason)::text from listings where id = :'l2'), '(contact_in_text,"Bitte Telefonnummer entfernen.")',
  'Besitzer sieht Code und getrimmten Freitext (Akzeptanz b)');
select tests.authenticate_as(:'mod2_id', 'aal2');
select admin_listing_version(:'l3') as v3 \gset
select is(moderate_listing(:'l3', 'request_changes', :'v3', 'incomplete'), 'draft'::listing_status, 'Bearbeitung anfordern');
select tests.as_postgres();
select is((select details ->> 'code' from audit_log where target_id = :'l3' and action = 'listing.draft'), 'incomplete', 'Audit mit Code');

-- Freigabe scheitert, wenn die Anzeige nicht bereit ist (Termin in der Vergangenheit)
select tests.submitted(:'owner_id', 'Drückjagd alt', :'dd') as l4 \gset
update listings set kind = 'driven_hunt', attributes = '{"event_date": "2020-01-10", "spots_available": 3}' where id = :'l4';
select tests.authenticate_as(:'mod_id', 'aal2');
select admin_listing_version(:'l4') as v4 \gset
select is(tests.state_of(format($$ select moderate_listing(%L, 'approve', %L) $$, :'l4', :'v4')), '23514', 'Nicht bereit: listing_not_ready');
select is(moderate_listing(:'l4', 'reject', :'v4', 'implausible'), 'rejected'::listing_status, 'Ablehnen geht trotzdem');

-- Hinweise und Warteschlange
select tests.as_postgres();
select tests.submitted(:'owner_id', 'Mit Munition', :'dd') as l5 \gset
select tests.authenticate_as(:'mod_id', 'aal2');
select is((select count(*)::int from listing_content_hints(:'l5')), 1, 'Admin sieht Waffenbegriff-Hinweise');
select is((select array_agg(title order by submitted_at, id) from admin_review_queue()), array['Mit Munition'],
  'Warteschlange: nur pending_review, ohne eigene Anzeigen');
select is((select (hint_count, owner_rejections) from admin_review_queue()), (1, 2), 'Hinweise und frühere Ablehnungen des Besitzers');
select tests.authenticate_as(:'mod_id', 'aal1');
select is((select count(*)::int from admin_review_queue()), 0, 'Ohne 2FA leer');

select * from finish();
rollback;
