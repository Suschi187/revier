begin;
\ir _helpers.psql
select plan(36);

-- QA-Abnahme M4 (docs/QA-REPORT.md, „M4 – Abnahme“): Angriffe auf Moderation und Admin-Verwaltung, die
-- 21–23 nicht abdecken. Alles in dieser Transaktion, Rollback am Ende (keine Reste, keine Zählungen kippen).
set constraints all immediate;
-- Ohne das Sitzungs-Flag aus _helpers: Moderation nur über moderate_listing (A4).
select set_config('revier.moderation', '', true);

create function tests.state_of(statement text) returns text language plpgsql as $$
begin
  execute statement;
  return 'ok';
exception when others then
  return sqlstate;
end;
$$;
grant execute on function tests.state_of(text) to authenticated, anon;

-- Zeilenzahl eines DML-Statements (RLS filtert still, statt zu werfen).
create function tests.rows_of(statement text) returns integer language plpgsql as $$
declare
  n integer;
begin
  execute statement;
  get diagnostics n = row_count;
  return n;
exception when others then
  return -1;
end;
$$;
grant execute on function tests.rows_of(text) to authenticated, anon;

-- Unabhängig von Admins außerhalb dieser Datei (Reste anderer Läufe): in der Transaktion entfernen.
delete from private.user_roles;
delete from public.audit_log where action like 'role.%';

select tests.create_user('qa4-owner@test.local') as owner_id \gset
select tests.create_user('qa4-mod@test.local') as mod_id \gset
select tests.create_user('qa4-mod2@test.local') as mod2_id \gset
select tests.create_user('qa4-cand@test.local') as cand_id \gset
select tests.make_admin(:'mod_id');
select tests.make_admin(:'mod2_id');
update private.user_roles set created_at = now() - interval '30 days' where user_id in (:'mod_id', :'mod2_id');
select id as dd from regions where code = 'DE-14612' \gset

create function tests.submitted4(owner uuid, title text, region uuid) returns uuid language plpgsql as $$
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
select tests.submitted4(:'owner_id', 'QA Foto neu', :'dd') as p1 \gset
select tests.submitted4(:'owner_id', 'QA Alt-Text', :'dd') as p2 \gset
select tests.submitted4(:'owner_id', 'QA Zurückgeben', :'dd') as p3 \gset
select tests.submitted4(:'owner_id', 'QA Aktiv', :'dd') as act \gset
-- Ein Foto an p2 (Server-Pfad, verarbeitet), damit der Besitzer danach den Alt-Text ändern kann.
insert into public.listing_photos (listing_id, sort_order, alt_text) values (:'p2', 0, 'Hochsitz') returning id as photo \gset

-- ---------------------------------------------------------------------------
-- B1: Fotos und Alt-Text nach dem Lesen der Version (22 prüft Text, Wildart, Ort)
-- ---------------------------------------------------------------------------
select tests.authenticate_as(:'mod_id', 'aal2');
select admin_listing_version(:'p1') as v1 \gset
select admin_listing_version(:'p2') as v2 \gset
select admin_listing_version(:'p3') as v3 \gset
select tests.authenticate_as(:'owner_id');
insert into listing_photos (listing_id, sort_order) values (:'p1', 0);
update listing_photos set alt_text = 'Kanzel am Waldrand' where id = :'photo';
select set_listing_location(:'p3', :'dd', (select postal_code from listing_places where listing_id = :'p3'), 'Neuer Ort');
select tests.authenticate_as(:'mod_id', 'aal2');
select is(tests.state_of(format($$ select moderate_listing(%L, 'approve', %L) $$, :'p1', :'v1')), 'RV004', 'B1: neues Foto nach dem Lesen → RV004');
select is(tests.state_of(format($$ select moderate_listing(%L, 'reject', %L, 'incomplete') $$, :'p2', :'v2')), 'RV004', 'B1: geänderter Alt-Text → RV004');
select is(tests.state_of(format($$ select moderate_listing(%L, 'request_changes', %L, 'incomplete') $$, :'p3', :'v3')), 'RV004',
  'B1: Bearbeitung anfordern mit altem Stand → RV004');
select is(tests.state_of(format($$ select moderate_listing(%L, 'approve', null) $$, :'p3')), 'RV004', 'B1: ohne Version → RV004');
select is(tests.state_of(format($$ select moderate_listing(%L, 'approve', '') $$, :'p3')), 'RV004', 'B1: leere Version → RV004');

-- ---------------------------------------------------------------------------
-- A4/A5: am RPC vorbei (Roh-UPDATE, Kinder-Tabellen, Löschen)
-- ---------------------------------------------------------------------------
select admin_listing_version(:'act') as va \gset
select is(moderate_listing(:'act', 'approve', :'va'), 'active'::listing_status, 'Vorbereitung: Anzeige freigegeben');
select is(tests.state_of(format($$ update listings set status = 'removed', reject_code = 'weapons' where id = %L $$, :'act')), '42501',
  'Roh-UPDATE auf removed ohne RPC → 42501');
select is(tests.state_of(format($$ update listings set title = 'Betrug, Tel. 0170 1234567' where id = %L $$, :'act')), '42501',
  'Admin schreibt aktive fremde Anzeige nicht um (A5)');
select is(tests.state_of(format($$ update listings set expires_at = now() + interval '10 years' where id = %L $$, :'act')), '42501',
  'Admin verlängert expires_at nicht');
select is(tests.state_of(format($$ update listings set owner_id = %L where id = %L $$, :'mod_id', :'act')), '42501', 'Admin übernimmt keine Anzeige');
select is(tests.rows_of(format($$ delete from listings where id = %L $$, :'act')), 0, 'Admin löscht keine fremde Anzeige (keine Policy)');
select is(tests.rows_of(format($$ update listing_photos set alt_text = 'x' where id = %L $$, :'photo')) <= 0, true, 'Admin ändert keinen fremden Alt-Text');
select is(tests.rows_of(format($$ delete from listing_photos where id = %L $$, :'photo')) <= 0, true, 'Admin löscht kein fremdes Foto');
select is(tests.rows_of(format($$ delete from listing_species where listing_id = %L $$, :'act')) <= 0, true, 'Admin entfernt keine fremde Wildart');
select tests.as_postgres();
select is((select (status, title)::text from listings where id = :'act'), '(active,"QA Aktiv")', 'Aktive Anzeige unverändert');

-- Audit ist nur lesbar, nicht schreib- oder löschbar
select tests.authenticate_as(:'mod_id', 'aal2');
select is(tests.rows_of($$ delete from audit_log $$) <= 0, true, 'Admin löscht keine Audit-Zeilen');
select is(tests.rows_of($$ update audit_log set details = '{}' $$) <= 0, true, 'Admin ändert keine Audit-Zeilen');
select is(tests.state_of(format($$ insert into audit_log (actor_id, action, target_type, target_id) values (%L, 'listing.active', 'listing', %L) $$,
  :'mod2_id', :'act')), '42501', 'Admin fälscht keinen Audit-Eintrag');
select tests.as_postgres();
select is((select actor_id from audit_log where target_id = :'act' and action = 'listing.active'), :'mod_id'::uuid, 'Freigabe mit Akteur im Audit');

-- ---------------------------------------------------------------------------
-- H6: Datensparsamkeit – Entwürfe sind nicht moderierbar, Version nur für die Prüfung
-- ---------------------------------------------------------------------------
select tests.authenticate_as(:'owner_id');
insert into listings (kind, direction, title, content_language, region_id)
values ('helper', 'wanted', 'QA privater Entwurf', 'de', :'dd') returning id as draft \gset
select tests.authenticate_as(:'mod_id', 'aal2');
select is(tests.state_of(format($$ select moderate_listing(%L, 'approve', %L) $$, :'draft', coalesce(admin_listing_version(:'draft'), 'x'))), 'RV003',
  'Entwurf ist nicht moderierbar');
select is((select count(*)::int from admin_review_queue() where id = :'draft'), 0, 'Entwurf nicht in der Warteschlange');
select is(admin_listing_version(:'draft'), null, 'Version nur für Anzeigen in der Prüfung');
select tests.as_postgres();
update listings set title = 'QA privater Entwurf mit Munition' where id = :'draft';
select tests.authenticate_as(:'mod_id', 'aal2');
select is((select count(*)::int from listing_content_hints(:'draft')), 0, 'Hinweise nur für Anzeigen in der Prüfung (F4)');

-- ---------------------------------------------------------------------------
-- A11: gesperrte und gelöschte Admins
-- ---------------------------------------------------------------------------
select tests.as_postgres();
update profiles set deleted_at = now() where user_id = :'mod2_id';
select tests.authenticate_as(:'mod2_id', 'aal2');
select ok(not private.is_admin(), 'Gelöschter Admin ist kein Admin');
select is((select has_role from admin_access()), false, 'Gelöschter Admin: admin_access ohne Rolle (Proxy → 403)');
select is(tests.state_of(format($$ select moderate_listing(%L, 'approve', 'x') $$, :'p1')), '42501', 'Gelöschter Admin moderiert nicht');
select tests.as_postgres();
update profiles set deleted_at = null, is_blocked = true where user_id = :'mod2_id';
select tests.authenticate_totp(:'mod2_id');
select is((select has_role from admin_access()), false, 'Gesperrter Admin: admin_access ohne Rolle');
select is(tests.state_of(format($$ select grant_admin(%L) $$, :'cand_id')), '42501', 'Gesperrter Admin ernennt niemanden, auch mit frischem TOTP');
select is(tests.state_of($$ select * from admin_find_user('qa4-cand@test.local') $$), '42501', 'Gesperrter Admin sucht nicht');

-- ---------------------------------------------------------------------------
-- B2: letzter aktiver Admin, Karenz, Gesamtlimit, Suche
-- ---------------------------------------------------------------------------
select tests.authenticate_totp(:'mod_id');
select is(tests.state_of(format($$ select revoke_admin(%L) $$, :'mod_id')), '23514',
  'Selbst entziehen scheitert, wenn der andere Admin gesperrt ist (nur aktive zählen)');
select tests.as_postgres();
update profiles set is_blocked = false where user_id = :'mod2_id';
select tests.authenticate_totp(:'mod_id');
select is(tests.state_of(format($$ select revoke_admin(%L) $$, :'mod_id')), 'ok', 'Selbst entziehen geht, wenn ein aktiver Admin bleibt');
select tests.as_postgres();
insert into private.user_roles (user_id, role) values (:'mod_id', 'admin');
update private.user_roles set created_at = now() - interval '6 days 23 hours' where user_id = :'mod_id';
select tests.authenticate_totp(:'mod_id');
select is(tests.state_of(format($$ select grant_admin(%L) $$, :'cand_id')), '42501', 'Karenz: 6 Tage 23 Stunden reichen nicht');
select tests.as_postgres();
update private.user_roles set created_at = now() - interval '30 days' where user_id = :'mod_id';
-- Gesamtlimit: 10 Rollenänderungen anderer Admins in 24 h
insert into public.audit_log (actor_id, action, target_type, target_id)
select null, 'role.granted', 'profile', gen_random_uuid() from generate_series(1, 10);
select tests.authenticate_totp(:'mod_id');
select is(tests.state_of(format($$ select grant_admin(%L) $$, :'cand_id')), '54000', 'Gesamtlimit 10 in 24 h → 54000');
select tests.as_postgres();
delete from public.audit_log where action = 'role.granted' and actor_id is null and created_at >= now();
-- Unbestätigte Konten sind kein Treffer und werden kein Admin
insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'qa4-unbestaetigt@test.local', '{}', now(), now())
returning id as unconfirmed \gset
select tests.authenticate_totp(:'mod_id');
select is((select count(*)::int from admin_find_user('qa4-unbestaetigt@test.local')), 0, 'Unbestätigte E-Mail ist kein Treffer');
select is(tests.state_of(format($$ select grant_admin(%L) $$, :'unconfirmed')), 'P0002', 'Unbestätigtes Konto wird kein Admin');
-- Rate-Limit der Suche (30 je Stunde)
select tests.as_postgres();
insert into private.admin_lookups (actor_id) select :'mod_id'::uuid from generate_series(1, 30);
select tests.authenticate_totp(:'mod_id');
select is(tests.state_of($$ select * from admin_find_user('qa4-cand@test.local') $$), '54000', 'Suche: 31. Abfrage in der Stunde → 54000');

select * from finish();
rollback;
