begin;
\ir _helpers.psql
select plan(50);

-- Regeln für Anzeigen (Migration listing_rules, Plan M3 Abschnitte 2, 5, 6, QA M3 F1).
-- Die Bereitschaftsprüfung läuft deferred am Ende der Transaktion; pgTAP committet nie, deshalb sofort prüfen.
set constraints all immediate;

-- SQLSTATE bzw. Hint eines Statements ('ok' ohne Fehler).
create function tests.sqlstate_of(statement text) returns text language plpgsql as $$
begin
  execute statement;
  return 'ok';
exception when others then
  return sqlstate;
end;
$$;
create function tests.hint_of(statement text) returns jsonb language plpgsql as $$
declare
  hint text;
  message text;
begin
  execute statement;
  return null;
exception when others then
  get stacked diagnostics hint = pg_exception_hint, message = message_text;
  begin
    return hint::jsonb;
  exception when others then
    -- Kein JSON-Hint: Fehler sichtbar machen statt den Test abzubrechen.
    return to_jsonb(sqlstate || ': ' || message);
  end;
end;
$$;
grant execute on function tests.sqlstate_of(text), tests.hint_of(text) to authenticated;

select tests.create_user('owner@test.local') as a_id \gset
select tests.create_user('admin@test.local') as adm \gset
select tests.create_user('neu@test.local') as n_id \gset
select tests.create_user('alt@test.local') as o_id \gset
select tests.create_user('ohne@test.local', accepted => false) as c_id \gset
select tests.make_admin(:'adm');
select id as muenchen from regions where code = 'DE-09162' \gset
select id as miesbach from regions where code = 'DE-09182' \gset

-- ---------------------------------------------------------------------------
-- Attribute je Art (bei jedem Schreiben, auch Entwürfe)
-- ---------------------------------------------------------------------------
select tests.authenticate_as(:'a_id');
insert into listings (kind, direction, title, content_language, region_id)
values ('lease', 'offer', 'Pacht in München', 'de', :'muenchen') returning id as l \gset

select is(tests.hint_of(format($$ update listings set attributes = '{"foo": 1}' where id = %L $$, :'l')),
  '{"fields": ["attributes.unknown"]}', 'Unbekannter Schlüssel abgelehnt');
select is(tests.hint_of(format($$ update listings set attributes = '{"paid": true}' where id = %L $$, :'l')),
  '{"fields": ["attributes.unknown"]}', 'Schlüssel einer anderen Art abgelehnt');
select is(tests.hint_of(format($$ update listings set attributes = '{"lease_type": "kauf"}' where id = %L $$, :'l')),
  '{"fields": ["attributes.lease_type"]}', 'Unbekannte Pachtart abgelehnt');
select is(tests.hint_of(format($$ update listings set attributes = '{"revier_type": ["wald", "wald"]}' where id = %L $$, :'l')),
  '{"fields": ["attributes.revier_type"]}', 'Doppelter Reviertyp abgelehnt');
select is(tests.hint_of(format($$ update listings set attributes = '{"submission_deadline": "2026-02-30"}' where id = %L $$, :'l')),
  '{"fields": ["attributes.submission_deadline"]}', 'Ungültiges Datum abgelehnt');
select lives_ok(format($$ update listings set attributes = '{"lease_type": "eigenjagd", "revier_type": ["wald", "feld"], "hunting_hut": true, "co_lessee_slots": 2}' where id = %L $$, :'l'),
  'Gültige Attribute der Pacht');

-- Preisgrenzen je Währung
select is(tests.sqlstate_of(format($$ update listings set price_minor = 0, currency = 'EUR', price_unit = 'per_year' where id = %L $$, :'l')),
  '23514', 'Betrag 0 nicht erlaubt (dann auf Anfrage)');
select is(tests.sqlstate_of(format($$ update listings set price_minor = 1000000001, currency = 'EUR', price_unit = 'total' where id = %L $$, :'l')),
  '23514', 'EUR über 10 Mio. abgelehnt');
select is(tests.sqlstate_of(format($$ update listings set price_minor = 25000000000, currency = 'CZK', price_unit = 'total' where id = %L $$, :'l')),
  'ok', 'CZK bis 250 Mio. erlaubt');

-- ---------------------------------------------------------------------------
-- Bereitschaft beim Absenden (Feldcodes im Hint)
-- ---------------------------------------------------------------------------
select tests.as_postgres();
update listings set price_minor = null, currency = null, price_unit = null, attributes = '{}' where id = :'l';
select tests.authenticate_as(:'a_id');
select is(tests.hint_of(format($$ update listings set status = 'pending_review' where id = %L $$, :'l')),
  '{"fields": ["description.length", "place.postal_code.required", "place.place_name.required", "attributes.lease_type", "attributes.revier_type", "area_hectares", "species"]}',
  'Pacht-Angebot ohne Angaben: alle fehlenden Felder');
select tests.as_postgres();
select tests.make_ready(:'l');
select tests.authenticate_as(:'a_id');
select is(tests.sqlstate_of(format($$ update listings set status = 'pending_review' where id = %L $$, :'l')), 'ok',
  'Vollständiges Angebot wird eingereicht');

-- Während der Prüfung muss die Anzeige bereit bleiben.
select is(tests.hint_of(format($$ delete from listing_species where listing_id = %L $$, :'l')),
  '{"fields": ["species"]}', 'In der Prüfung: letzte Wildart entfernen abgelehnt');
select is(tests.hint_of(format($$ update listings set region_id = %L where id = %L $$, :'miesbach', :'l')),
  '{"fields": ["place.postal_code.region_mismatch"]}', 'Nur den Kreis ändern: PLZ passt nicht mehr');
-- Wie in echten Requests: geprüft wird am Ende (die RPC ändert erst den Kreis, dann den Ort).
set constraints all deferred;
select set_listing_location(:'l', :'miesbach', '83714', 'Miesbach');
select is(tests.sqlstate_of('set constraints all immediate'), 'ok', 'Kreis und PLZ zusammen per RPC: kein Fehler');
set constraints all immediate;
select is(tests.hint_of(format($$ update listing_places set postal_code = '99999' where listing_id = %L $$, :'l')),
  '{"fields": ["place.postal_code.unknown"]}', 'Unbekannte PLZ abgelehnt');

-- Absenden mit unverarbeitetem Foto
insert into listings (kind, direction, title, description, content_language, region_id)
values ('helper', 'wanted', 'Suche Helfer', 'Suche Hilfe beim Ansitzbau im Frühjahr, zwei Tage.', 'de', :'muenchen') returning id as hp \gset
insert into listing_photos (listing_id, sort_order) values (:'hp', 0);
select is(tests.hint_of(format($$ update listings set status = 'pending_review' where id = %L $$, :'hp')),
  '{"fields": ["photos.unprocessed"]}', 'Absenden mit unverarbeitetem Foto abgelehnt');

-- Gesuche: nur die Mindestfelder, PLZ optional, aber geprüft; Häkchen bei Trophäen auch beim Gesuch.
insert into listings (kind, direction, title, description, content_language, region_id)
values ('lease', 'wanted', 'Suche Pacht', 'Suche eine Jagdpacht im Raum München, gern Wald.', 'de', :'muenchen') returning id as w \gset
select is(tests.sqlstate_of(format($$ update listings set status = 'pending_review' where id = %L $$, :'w')), 'ok',
  'Gesuch ohne PLZ und Attribute wird eingereicht');
select is(tests.hint_of(format($$ select set_listing_location(%L, %L, '83714', 'Miesbach') $$, :'w', :'muenchen')),
  '{"fields": ["place.postal_code.region_mismatch"]}', 'Gesuch mit PLZ außerhalb des Kreises abgelehnt');
insert into listings (kind, direction, title, description, content_language, region_id)
values ('trophy_hunt', 'wanted', 'Suche Gastjagd', 'Suche eine Gastjagd auf Rotwild im Herbst, gern Bayern.', 'de', :'muenchen') returning id as t \gset
select is(tests.hint_of(format($$ update listings set status = 'pending_review' where id = %L $$, :'t')),
  '{"fields": ["attributes.legal_ack"]}', 'Trophäen-Gesuch ohne Rechtshinweis abgelehnt');
insert into listings (kind, direction, title, description, content_language, region_id, attributes)
values ('driven_hunt', 'wanted', 'Suche Drückjagd', 'Suche einen Platz auf einer Drückjagd im Dezember.', 'de', :'muenchen',
  '{"event_date": "2020-12-01"}') returning id as d \gset
select is(tests.hint_of(format($$ update listings set status = 'pending_review' where id = %L $$, :'d')),
  '{"fields": ["attributes.event_date.past"]}', 'Termin in der Vergangenheit abgelehnt');

-- ---------------------------------------------------------------------------
-- Freigabe (A1): nur bereit, also auch alle Fotos verarbeitet
-- ---------------------------------------------------------------------------
insert into listing_photos (listing_id, sort_order) values (:'l', 0) returning id as photo \gset
select pass('In der Prüfung darf ein neues Foto bis zur Verarbeitung unverarbeitet sein');
select tests.authenticate_as(:'adm', 'aal2');
select is(tests.hint_of(format($$ update listings set status = 'active' where id = %L $$, :'l')),
  '{"fields": ["photos.unprocessed"]}', 'Freigabe mit unverarbeitetem Foto abgelehnt');
select tests.as_postgres();
update listing_photos set processed_at = now(), width = 10, height = 10 where id = :'photo';
select tests.authenticate_as(:'adm', 'aal2');
select is(tests.sqlstate_of(format($$ update listings set status = 'active' where id = %L $$, :'l')), 'ok', 'Freigabe nach der Verarbeitung');
select tests.as_postgres();
select ok(exists (select 1 from private.listing_approvals where listing_id = :'l'), 'Freigabe-Hash gespeichert');
select ok(not has_table_privilege('authenticated', 'private.listing_approvals', 'select')
  and not has_table_privilege('anon', 'private.listing_approvals', 'select'), 'Freigabe-Hash ist für API-Rollen nicht lesbar');

-- ---------------------------------------------------------------------------
-- Fortsetzen nur mit dem freigegebenen Inhalt (Entscheidung 4, Hash als zweite Sicherung)
-- ---------------------------------------------------------------------------
select tests.authenticate_as(:'a_id');
update listings set status = 'paused' where id = :'l';
update listings set status = 'active' where id = :'l';
select is((select status::text from listings where id = :'l'), 'active', 'Ohne Änderung: Fortsetzen klappt');
update listings set status = 'paused' where id = :'l';
select tests.as_postgres();
update listings set title = 'Vom Server korrigierter Titel' where id = :'l';
select tests.authenticate_as(:'a_id');
update listings set status = 'active' where id = :'l';
select is((select status::text from listings where id = :'l'), 'pending_review', 'Inhalt seit der Freigabe geändert: zurück in die Prüfung');

select tests.authenticate_as(:'adm', 'aal2');
update listings set status = 'active' where id = :'l';
select tests.authenticate_as(:'a_id');
update listings set status = 'paused' where id = :'l';
select tests.as_postgres();
update listing_photos set alt_text = 'Alt-Text vom Server' where id = :'photo';
select tests.authenticate_as(:'a_id');
update listings set status = 'active' where id = :'l';
select is((select status::text from listings where id = :'l'), 'pending_review', 'Alt-Text seit der Freigabe geändert: zurück in die Prüfung');

select tests.authenticate_as(:'adm', 'aal2');
update listings set status = 'active' where id = :'l';
select tests.authenticate_as(:'a_id');
update listings set status = 'paused' where id = :'l';
select tests.as_postgres();
delete from private.listing_approvals where listing_id = :'l';
select tests.authenticate_as(:'a_id');
update listings set status = 'active' where id = :'l';
select is((select status::text from listings where id = :'l'), 'pending_review', 'Ohne Hash kein Fortsetzen (fail closed)');

select tests.authenticate_as(:'adm', 'aal2');
update listings set status = 'active' where id = :'l';
select tests.authenticate_as(:'a_id');
update listings set status = 'paused' where id = :'l';
update listings set status = 'active', description = description || ' Neu.' where id = :'l';
select is((select status::text from listings where id = :'l'), 'pending_review', 'Fortsetzen mit Textänderung: pending_review');

-- ---------------------------------------------------------------------------
-- Statusmatrix: Der Besitzer setzt nie selbst active, außer Fortsetzen aus paused
-- ---------------------------------------------------------------------------
select tests.as_postgres();
create function tests.owner_activation(owner uuid, region uuid, aal text) returns text language plpgsql as $$
declare
  s public.listing_status;
  listing uuid;
  results text := '';
begin
  foreach s in array enum_range(null::public.listing_status) loop
    if s = 'active' then continue; end if;
    perform tests.as_postgres();
    insert into public.listings (owner_id, kind, direction, title, content_language, region_id)
    values (owner, 'helper', 'wanted', 'Matrix ' || s, 'de', region) returning id into listing;
    perform tests.make_ready(listing);
    update public.listings set status = 'pending_review' where id = listing;
    update public.listings set status = 'active', expires_at = now() + interval '30 days' where id = listing;
    update public.listings set status = s, reject_reason = case when s in ('rejected', 'removed') then 'Grund' end
    where id = listing;
    perform tests.authenticate_as(owner, aal);
    -- Zwei Anweisungen: Ein Subselect im selben Ausdruck sähe den Snapshot vor dem Update.
    results := results || s || '=' || tests.sqlstate_of(format('update public.listings set status = ''active'' where id = %L', listing));
    results := results || '/' || (select status from public.listings where id = listing) || ' ';
  end loop;
  perform tests.as_postgres();
  return btrim(results);
end;
$$;
grant execute on function tests.owner_activation(uuid, uuid, text) to authenticated;
select is(tests.owner_activation(:'a_id', :'muenchen', 'aal1'),
  'draft=42501/draft pending_review=42501/pending_review paused=ok/active expired=42501/expired rejected=42501/rejected removed=42501/removed',
  'Besitzer: active nur aus paused (Fortsetzen)');
select is(tests.owner_activation(:'adm', :'muenchen', 'aal2'),
  'draft=42501/draft pending_review=42501/pending_review paused=ok/active expired=42501/expired rejected=42501/rejected removed=42501/removed',
  'Admin-Besitzer mit 2FA: dieselbe Matrix (Vier-Augen-Prinzip)');

-- Admin-Besitzer ändert die eigene freigegebene Anzeige: zurück in die Prüfung (QA M3 F1)
select tests.authenticate_as(:'adm', 'aal2');
insert into listings (kind, direction, title, content_language, region_id)
values ('helper', 'wanted', 'Eigene Anzeige Admin', 'de', :'muenchen') returning id as la \gset
select tests.as_postgres();
select tests.make_ready(:'la');
update listings set status = 'active', expires_at = now() + interval '30 days' where id = :'la';
select tests.authenticate_as(:'adm', 'aal2');
update listings set title = 'Admin schreibt eigene Anzeige um' where id = :'la';
select is((select status::text from listings where id = :'la'), 'pending_review', 'Admin-Besitzer: Inhaltsänderung → pending_review');
select is(tests.sqlstate_of(format($$ update listings set status = 'active' where id = %L $$, :'la')), '42501',
  'Admin gibt die eigene Anzeige nicht frei');

-- ---------------------------------------------------------------------------
-- Legal-Gate (RV001): Anlegen und Ändern ja, Pausieren, Zurückziehen und Löschen nicht
-- ---------------------------------------------------------------------------
select tests.authenticate_as(:'c_id');
select is(tests.sqlstate_of(format($$ insert into listings (kind, direction, title, content_language, region_id) values ('helper', 'offer', 'Ohne Zustimmung', 'de', %L) $$, :'muenchen')),
  'RV001', 'Anlegen ohne Zustimmung: RV001');
-- Neue Version der Rechtstexte: der Besitzer hat ihr noch nicht zugestimmt.
select tests.as_postgres();
update listings set status = 'active', expires_at = now() + interval '30 days' where id = :'l';
update private.app_settings set value = '"2099-01"' where key = 'legal_terms_version';
select tests.authenticate_as(:'a_id');
select is(tests.sqlstate_of(format($$ update listings set title = 'Neuer Titel' where id = %L $$, :'l')), 'RV001',
  'Inhalt ändern ohne aktuelle Zustimmung: RV001');
select is(tests.sqlstate_of(format($$ insert into listing_species (listing_id, species_code) values (%L, 'red_deer') $$, :'l')), 'RV001',
  'Wildart hinzufügen ohne aktuelle Zustimmung: RV001');
select is(tests.sqlstate_of(format($$ update listings set status = 'paused' where id = %L $$, :'l')), 'ok', 'Pausieren ohne Zustimmung erlaubt');
select is(tests.sqlstate_of(format($$ update listings set status = 'active' where id = %L $$, :'l')), 'RV001', 'Fortsetzen ohne Zustimmung: RV001');
select is(tests.sqlstate_of(format($$ update listings set status = 'draft' where id = %L $$, :'w')), 'ok', 'Zurückziehen ohne Zustimmung erlaubt');
select is(tests.sqlstate_of(format($$ delete from listings where id = %L $$, :'w')), 'ok', 'Löschen ohne Zustimmung erlaubt');
select tests.as_postgres();
update private.app_settings set value = '"2026-10-draft"' where key = 'legal_terms_version';

-- ---------------------------------------------------------------------------
-- Rate-Limit (RV002): neue Konten 3, ältere 10 in 24 h; Löschen hilft nicht
-- ---------------------------------------------------------------------------
update private.app_settings set value = '3' where key = 'listing_create_daily_limit_new';
update private.app_settings set value = '4' where key = 'listing_create_daily_limit';
update auth.users set created_at = now() - interval '30 days' where id = :'o_id';
create function tests.create_many(n integer, region uuid) returns text language plpgsql as $$
declare
  results text := '';
begin
  for i in 1..n loop
    results := results || tests.sqlstate_of(format(
      'insert into public.listings (kind, direction, title, content_language, region_id) values (''helper'', ''wanted'', ''Limit %s'', ''de'', %L)', i, region)) || ' ';
  end loop;
  return btrim(results);
end;
$$;
grant execute on function tests.create_many(integer, uuid) to authenticated;
select tests.authenticate_as(:'n_id');
select is(tests.create_many(4, :'muenchen'), 'ok ok ok RV002', 'Neues Konto: drei Anzeigen, die vierte RV002');
delete from listings where owner_id = :'n_id';
select is(tests.create_many(1, :'muenchen'), 'RV002', 'Nach dem Löschen weiterhin RV002');
select ok((tests.hint_of(format($$ insert into listings (kind, direction, title, content_language, region_id) values ('helper', 'wanted', 'X', 'de', %L) $$, :'muenchen'))
  ->> 'retry_after') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T', 'RV002 nennt den Zeitpunkt für den nächsten Versuch');
select tests.authenticate_as(:'o_id');
select is(tests.create_many(5, :'muenchen'), 'ok ok ok ok RV002', 'Älteres Konto: eigenes, höheres Limit');
select tests.as_postgres();
select ok(not has_table_privilege('authenticated', 'private.listing_creations', 'select')
  and not has_table_privilege('authenticated', 'private.listing_creations', 'delete'), 'Zähler ist für Nutzer nicht erreichbar');

-- ---------------------------------------------------------------------------
-- Meta-Tests (Auflage 8)
-- ---------------------------------------------------------------------------
-- Jede Spalte des UPDATE-GRANT (außer status und reject_reason) zählt im Guard als Inhalt.
select is(array(
  select c.column_name::text from information_schema.columns c
  where c.table_schema = 'public' and c.table_name = 'listings'
    and has_column_privilege('authenticated', 'public.listings', c.column_name, 'update')
    and c.column_name not in ('status', 'reject_reason')
    and (select prosrc from pg_proc where oid = 'private.listings_guard'::regproc) !~ ('new\.' || c.column_name || '[,)]')
  order by 1), array[]::text[], 'Inhaltsvergleich im Guard deckt alle änderbaren Spalten ab');
-- Nur diese Funktionen schreiben den Status einer Anzeige.
select set_eq($$ select n.nspname || '.' || p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private') and p.prosrc ~* 'update\s+public\.listings\s+set\s+status'
  union select n.nspname || '.' || p.proname from pg_trigger t join pg_proc p on p.oid = t.tgfoid
    join pg_namespace n on n.oid = p.pronamespace
    where t.tgrelid = 'public.listings'::regclass and p.prosrc ~* 'new\.status\s*:=' $$,
  array['private.listings_guard', 'private.listing_children_guard', 'public.complete_photo_processing'],
  'Nur Guard, Kinder-Guard (pending_review) und Foto-Abschluss (pending_review) setzen den Status');
select is((select count(*)::int from pg_trigger where tgrelid = 'public.listings'::regclass and tgname = 'listings_ready' and tgdeferrable and tginitdeferred), 1,
  'Bereitschaftsprüfung ist deferred');
select ok(not has_function_privilege('authenticated', 'private.listing_readiness(uuid, boolean)', 'execute')
  and not has_function_privilege('authenticated', 'private.listing_content_hash(uuid)', 'execute'),
  'Bereitschaft und Hash sind für Nutzer nicht aufrufbar');

select * from finish();
rollback;
