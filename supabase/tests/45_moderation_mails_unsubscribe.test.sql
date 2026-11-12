-- M8 Commit 4 (ADR 018, Plan M8 4.5, 4.6, Review B4, A2, A5, A6, A8–A11): Moderations-Mails (Trigger über die
-- echten Pfade, Empfänger, Antwortform ohne Admin, claim/confirm/release mit 3 Versuchen) und Abbestell-Token
-- (nur Hash, Hex, Scope und Ziele, kein Orakel, idempotent, anon) sowie Retention.
begin;
\ir _helpers.psql
select plan(67);

set constraints all immediate;
select s.decrypted_secret as secret from vault.decrypted_secrets s where s.name = 'search_notifications_secret' \gset
select s.decrypted_secret as chat_secret from vault.decrypted_secrets s where s.name = 'chat_notifications_secret' \gset

-- Fremde Daten dieser Datenbank nicht mitzählen (Rollback am Ende).
delete from private.moderation_notifications;
delete from private.unsubscribe_tokens;
update public.saved_searches set notify_email = false;
delete from private.search_match_queue;
delete from private.saved_search_matches;
delete from private.saved_search_deliveries;
delete from private.search_notification_claims;
delete from private.search_notification_state;
delete from private.chat_notifications;
insert into private.chat_notifications (conversation_id, recipient_id, channel, last_sent_at)
select distinct conversation_id, recipient_id, 'email', now() from messages where read_at is null;
update private.app_settings set value = '1000' where key in ('chat_unanswered_max', 'chat_messages_per_10min_new');

create function tests.err(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlstate;
end;
$$;
grant execute on function tests.err(text) to anon, authenticated, service_role;
grant usage on schema tests to service_role;

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
create function tests.notes(listing uuid) returns text[] language sql as $$
  select coalesce(array_agg(n.decision || ':' || coalesce(n.reject_code, '-') || ':' || coalesce(n.reason, '-')
                            order by n.created_at, n.decision), '{}')
  from private.moderation_notifications n where n.listing_id = listing;
$$;
create function tests.mine(result jsonb, owner uuid) returns jsonb language sql as $$
  select coalesce(jsonb_agg(e), '[]') from jsonb_array_elements(result) e
  where (e ->> 'listing_id')::uuid in (select id from public.listings where owner_id = owner);
$$;

select tests.create_user('m8u-owner@test.local') as o \gset
select tests.create_user('m8u-adm@test.local') as adm \gset
select tests.create_user('m8u-blocked@test.local') as ob \gset
select tests.create_user('m8u-deleted@test.local') as od \gset
select tests.create_user('m8u-unconfirmed@test.local') as ou \gset
select tests.make_admin(:'adm');
update profiles set preferred_language = 'pl' where user_id = :'o';
select id as dd from regions where code = 'DE-14612' \gset
select id as muc from regions where code = 'DE-09162' \gset

-- ---------------------------------------------------------------------------
-- 1. Auslöser über die echten Pfade (A2)
-- ---------------------------------------------------------------------------
select tests.submitted(:'o', 'M8U Freigabe', :'dd') as l_ok \gset
select tests.submitted(:'o', 'M8U Änderung', :'dd') as l_chg \gset
select tests.submitted(:'o', 'M8U Ablehnung', :'dd') as l_rej \gset
select is((select count(*)::int from private.moderation_notifications), 0, 'Entwurf und Einreichung: keine Mail');

select tests.authenticate_as(:'adm', 'aal2');
select moderate_listing(:'l_ok', 'approve', admin_listing_version(:'l_ok'));
select moderate_listing(:'l_chg', 'request_changes', admin_listing_version(:'l_chg'), 'incomplete', 'Bitte Fotos ergänzen');
select moderate_listing(:'l_rej', 'reject', admin_listing_version(:'l_rej'), 'other', 'Kein Jagdangebot <b>');
select tests.as_postgres();
select is(tests.notes(:'l_ok'), array['approved:-:-'], 'Freigabe: eine Mail ohne Begründung');
select is(tests.notes(:'l_chg'), array['changes_requested:incomplete:Bitte Fotos ergänzen'],
  'Änderungswunsch (request_changes setzt draft mit Code): eine Mail mit Grund');
select is(tests.notes(:'l_rej'), array['rejected:other:Kein Jagdangebot <b>'], 'Ablehnung: eine Mail mit Code und Freitext');

-- Entfernen per SQL als Admin (kein Web-Pfad bisher; der Guard verlangt das Moderations-Flag, Helfer setzt es).
select tests.authenticate_as(:'adm', 'aal2');
update listings set status = 'removed', reject_code = 'prohibited_content', reject_reason = null where id = :'l_ok';
select tests.as_postgres();
select is(tests.notes(:'l_ok'), array['approved:-:-', 'removed:prohibited_content:-'], 'Entfernen per SQL: eine weitere Mail');

-- Besitzer pausiert und setzt fort: nichts. Admin an der eigenen Anzeige: nichts. Server-Pfad: nichts.
insert into listings (owner_id, kind, direction, title, content_language, region_id, status, expires_at, attributes)
values (:'o', 'helper', 'offer', 'M8U Aktiv', 'de', :'muc', 'active', now() + interval '30 days', '{"tasks": ["Ansitz"]}')
returning id as l_act \gset
insert into listings (owner_id, kind, direction, title, content_language, region_id, status, expires_at, attributes)
values (:'adm', 'helper', 'offer', 'M8U Admin eigen', 'de', :'muc', 'active', now() + interval '30 days', '{"tasks": ["Ansitz"]}')
returning id as l_adm \gset
select tests.make_ready(:'l_act');
select tests.make_ready(:'l_adm');
select tests.authenticate_as(:'o');
update listings set status = 'paused' where id = :'l_act';
update listings set status = 'active' where id = :'l_act';
select tests.authenticate_as(:'adm', 'aal2');
update listings set status = 'paused' where id = :'l_adm';
update listings set status = 'active' where id = :'l_adm';
select tests.as_postgres();
update listings set status = 'rejected', reject_code = 'duplicate' where id = :'l_act';
update listings set status = 'paused' where id = :'l_act';
select is((select count(*)::int from private.moderation_notifications where listing_id = :'l_adm'), 0,
  'Pausieren/Fortsetzen durch Besitzer und Admin an eigener Anzeige: keine Mail');
-- M9b (ADR 020, Review A7): Ein Server-Pfad mit dem Flag revier.moderation (hier für die Sitzung gesetzt) löst die
-- Mail aus; Pausieren und Fortsetzen nicht.
select is(tests.notes(:'l_act'), array['rejected:duplicate:-'], 'Server-Pfad mit Flag: genau eine Mail für die Ablehnung');
select is((select array_agg(column_name::text order by column_name) from information_schema.columns
           where table_schema = 'private' and table_name = 'moderation_notifications'),
  array['attempts', 'claim_id', 'claimed_at', 'created_at', 'decision', 'done_at', 'id', 'listing_id', 'owner_id',
        'reason', 'reject_code', 'sent_at'], 'Keine Spalte für den Admin');

-- Gesperrter, gelöschter und unbestätigter Besitzer
select tests.submitted(:'ob', 'M8U Gesperrt', :'dd') as l_b \gset
select tests.submitted(:'od', 'M8U Gelöscht', :'dd') as l_d \gset
select tests.submitted(:'ou', 'M8U Unbestätigt', :'dd') as l_u \gset
select tests.authenticate_as(:'adm', 'aal2');
select moderate_listing(:'l_b', 'reject', admin_listing_version(:'l_b'), 'weapons');
select moderate_listing(:'l_d', 'reject', admin_listing_version(:'l_d'), 'weapons');
select moderate_listing(:'l_u', 'reject', admin_listing_version(:'l_u'), 'weapons');
select tests.as_postgres();
update profiles set is_blocked = true where user_id = :'ob';
update profiles set deleted_at = now() where user_id = :'od';
update auth.users set email_confirmed_at = null where id = :'ou';

-- ---------------------------------------------------------------------------
-- 2. Zugang
-- ---------------------------------------------------------------------------
select is(tests.err($$ select claim_moderation_notifications('falsch') $$), '42501', 'claim mit falschem Geheimnis: 42501');
select is(tests.err($$ select confirm_moderation_notifications('falsch', '{}') $$), '42501', 'confirm mit falschem Geheimnis: 42501');
select is(tests.err($$ select release_moderation_notifications('falsch', '{}') $$), '42501', 'release mit falschem Geheimnis: 42501');
select is(tests.err(format($$ select claim_moderation_notifications(%L) $$, :'chat_secret')), '42501',
  'Das Chat-Geheimnis gilt nicht');
select is(
  array(select p.proname || ':' || has_function_privilege('anon', p.oid, 'execute')::text || ':'
               || has_function_privilege('authenticated', p.oid, 'execute')::text || ':'
               || has_function_privilege('service_role', p.oid, 'execute')::text || ':' || p.prosecdef::text
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and (p.proname like '%moderation_notifications' or p.proname = 'unsubscribe') order by 1),
  array['claim_moderation_notifications:false:false:true:true', 'confirm_moderation_notifications:false:false:true:true',
        'release_moderation_notifications:false:false:true:true', 'unsubscribe:true:true:true:true'],
  'claim/confirm/release nur service_role, unsubscribe für anon und authenticated (alle Definer)');
select is(
  array(select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'private' and p.proname in ('listings_moderation_notify', 'issue_unsubscribe_token')
          and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute')
               or has_function_privilege('service_role', p.oid, 'execute'))),
  array[]::name[], 'Trigger und Token-Erzeugung sind für keine API-Rolle ausführbar');
select ok(not has_table_privilege('service_role', 'private.unsubscribe_tokens', 'select')
          and not has_table_privilege('anon', 'private.unsubscribe_tokens', 'select')
          and not has_table_privilege('service_role', 'private.moderation_notifications', 'select'),
  'Token und Moderations-Mails sind für keine API-Rolle lesbar');
select tests.authenticate_as(:'o');
select is(tests.err(format($$ select claim_moderation_notifications(%L) $$, :'secret')), '42501', 'Nutzer rufen claim nicht auf');
select tests.as_postgres();

-- ---------------------------------------------------------------------------
-- 3. Claim (A5, A8)
-- ---------------------------------------------------------------------------
select claim_moderation_notifications(:'secret', 2) as m1 \gset
select claim_moderation_notifications(:'secret') as m2 \gset
select is(jsonb_array_length(:'m1'::jsonb), 2, 'Limit: zwei Mails im ersten Lauf');
select is((select count(distinct e ->> 'claim_id')::int from jsonb_array_elements(:'m1'::jsonb || :'m2'::jsonb) e),
  jsonb_array_length(:'m1'::jsonb || :'m2'::jsonb), 'Je Mail eine eigene claim_id, Läufe disjunkt');
create table tests.mod_claims as select e from jsonb_array_elements(:'m1'::jsonb || :'m2'::jsonb) e;
create function tests.mail(listing uuid, decision text) returns jsonb language sql as $$
  select e from tests.mod_claims where (e ->> 'listing_id')::uuid = listing and e ->> 'decision' = mail.decision;
$$;
select is((select count(*)::int from tests.mod_claims), 6, 'Sechs Mails: fünf an den Besitzer (eine über den Server-Pfad), eine an den gesperrten');
select is((select array_agg(distinct k order by k) from tests.mod_claims c, jsonb_object_keys(c.e) k),
  array['claim_id', 'decision', 'email', 'language', 'listing_id', 'reason', 'reject_code', 'title'],
  'Antwort: genau diese Schlüssel');
select ok((select bool_and(c.e::text not like '%' || :'adm' || '%' and c.e::text not like '%m8u-adm%') from tests.mod_claims c),
  'Nie die Identität des Admins');
select is(tests.mail(:'l_rej', 'rejected'),
  jsonb_build_object('claim_id', tests.mail(:'l_rej', 'rejected') -> 'claim_id', 'email', 'm8u-owner@test.local',
    'language', 'pl', 'decision', 'rejected', 'reject_code', 'other', 'reason', 'Kein Jagdangebot <b>',
    'listing_id', :'l_rej'::uuid, 'title', 'M8U Ablehnung'),
  'Inhalt: Empfänger, Sprache, Entscheidung, Code, Freitext roh (escaped erst in der Mail), Titel');
select is(tests.mail(:'l_ok', 'approved') -> 'reason', 'null'::jsonb, 'Freigabe ohne Begründung');
select is(tests.mail(:'l_b', 'rejected') ->> 'email', 'm8u-blocked@test.local', 'Gesperrter Besitzer bekommt die Mail');
select ok(tests.mail(:'l_d', 'rejected') is null and tests.mail(:'l_u', 'rejected') is null,
  'Gelöschter Besitzer und unbestätigte Adresse: keine Mail');
select ok((select bool_and(done_at is not null and sent_at is null and claim_id is null) from private.moderation_notifications
           where listing_id in (:'l_d', :'l_u')), 'Nicht zustellbar: ohne Mail erledigt');
select is(jsonb_array_length(claim_moderation_notifications(:'secret')), 0, 'Geclaimt, unbestätigt: kein zweites Mal');

-- ---------------------------------------------------------------------------
-- 4. Confirm und Release (claim_id, höchstens 3 Versuche)
-- ---------------------------------------------------------------------------
select (tests.mail(:'l_ok', 'approved') ->> 'claim_id')::uuid as c_ok \gset
select (tests.mail(:'l_rej', 'rejected') ->> 'claim_id')::uuid as c_rej \gset
select is(confirm_moderation_notifications(:'secret', array[:'c_ok'::uuid]), 1, 'Confirm: eine Mail');
select ok((select sent_at is not null and done_at is not null from private.moderation_notifications where claim_id = :'c_ok'),
  'Confirm setzt sent_at und done_at');
select is(confirm_moderation_notifications(:'secret', array[:'c_ok'::uuid]), 0, 'Zweites Confirm: nichts');
select is(release_moderation_notifications(:'secret', array[:'c_ok'::uuid]), 0, 'Release nach Confirm: nichts');
select is(release_moderation_notifications(:'secret', array[:'c_rej'::uuid]), 1, 'Release: eine Mail');
select is(release_moderation_notifications(:'secret', array[:'c_rej'::uuid]), 0, 'Zweites Release desselben Claims: nichts');
select tests.mine(claim_moderation_notifications(:'secret'), :'o') as r2 \gset
select ok(jsonb_array_length(:'r2'::jsonb) = 1 and (:'r2'::jsonb -> 0 ->> 'claim_id')::uuid <> :'c_rej'::uuid,
  'Nach dem Release erneut claimbar mit neuer claim_id');
select is(release_moderation_notifications(:'secret', array[:'c_rej'::uuid]), 0, 'Release mit alter claim_id trifft den neuen Claim nicht');
select release_moderation_notifications(:'secret', array[(:'r2'::jsonb -> 0 ->> 'claim_id')::uuid]);
select tests.mine(claim_moderation_notifications(:'secret'), :'o') as r3 \gset
select is(release_moderation_notifications(:'secret', array[(:'r3'::jsonb -> 0 ->> 'claim_id')::uuid]), 1, 'Dritter Versuch freigegeben');
select ok((select attempts = 3 and done_at is not null and sent_at is null from private.moderation_notifications
           where listing_id = :'l_rej'), 'Nach 3 Versuchen aufgegeben');
select is(jsonb_array_length(tests.mine(claim_moderation_notifications(:'secret'), :'o')), 0, 'Danach keine weitere Mail');

-- ---------------------------------------------------------------------------
-- 5. Token aus dem Such-Claim (B4): Scope saved_search_mail, Ziele = Aufträge der Mail
-- ---------------------------------------------------------------------------
select tests.create_user('m8u-searcher@test.local') as su \gset
select tests.create_user('m8u-other@test.local') as so \gset
insert into public.saved_searches (user_id, name, filters, created_at) values
  (:'su', 'A', '{"v": 1, "kind": "helper"}', now() - interval '1 hour'),
  (:'su', 'B', '{"v": 1, "direction": "offer"}', now() - interval '1 hour'),
  (:'su', 'C ohne Treffer', '{"v": 1, "kind": "lease"}', now() - interval '1 hour'),
  (:'so', 'Fremd', '{"v": 1, "kind": "helper"}', now() - interval '1 hour');
select id as s_a from saved_searches where user_id = :'su' and name = 'A' \gset
select id as s_b from saved_searches where user_id = :'su' and name = 'B' \gset
select id as s_c from saved_searches where user_id = :'su' and name = 'C ohne Treffer' \gset
select id as s_f from saved_searches where user_id = :'so' \gset
insert into listings (owner_id, kind, direction, title, content_language, region_id, status, expires_at, attributes)
values (:'o', 'helper', 'offer', 'M8U Treffer', 'de', :'muc', 'active', now() + interval '30 days', '{"tasks": ["Ansitz"]}')
returning id as l_hit \gset
select private.process_search_match_queue(50);
update private.saved_search_matches set due_at = now() - interval '1 minute';
select is((select count(*)::int from private.saved_search_matches where listing_id = :'l_hit'), 3, 'Drei Treffer (A, B, Fremd)');

select claim_search_notifications(:'secret') as sc \gset
select (select e from jsonb_array_elements(:'sc'::jsonb -> 'recipients') e where e ->> 'email' = 'm8u-searcher@test.local') as smail \gset
select (select e from jsonb_array_elements(:'sc'::jsonb -> 'recipients') e where e ->> 'email' = 'm8u-other@test.local') as omail \gset
select :'smail'::jsonb ->> 'unsubscribe_token' as stok \gset
select :'omail'::jsonb ->> 'unsubscribe_token' as otok \gset
select is((select array_agg(k order by k) from jsonb_object_keys(:'smail'::jsonb) k),
  array['claim_id', 'email', 'items', 'language', 'searches', 'unsubscribe_token'], 'Such-Mail: genau diese Schlüssel');
select ok(:'stok' ~ '^[0-9a-f]{64}$' and :'otok' ~ '^[0-9a-f]{64}$' and :'stok' <> :'otok', 'Token: 64 Zeichen Hex, je Mail eigener');
select is((select scope || ':' || (select string_agg(x::text, ',' order by x::text) from unnest(t.target_ids) x)
           from private.unsubscribe_tokens t where t.token_hash = extensions.digest(decode(:'stok', 'hex'), 'sha256') and t.user_id = :'su'),
  'saved_search_mail:' || (select string_agg(x::text, ',' order by x::text) from unnest(array[:'s_a', :'s_b']::uuid[]) x),
  'Gespeichert: SHA-256, Scope saved_search_mail, Ziele = Aufträge der Mail');
select ok(not exists (select 1 from private.unsubscribe_tokens t
                      where encode(t.token_hash, 'hex') in (:'stok', :'otok') or t.token_hash = decode(:'stok', 'hex')),
  'Der Klartext ist nicht gespeichert');
select is((select array_agg(data_type::text order by column_name) from information_schema.columns
           where table_schema = 'private' and table_name = 'unsubscribe_tokens'),
  array['timestamp with time zone', 'text', 'ARRAY', 'bytea', 'uuid'], 'Tabelle: created_at, scope, target_ids, token_hash, user_id');

-- ---------------------------------------------------------------------------
-- 6. Token aus dem Chat-Claim (ADR 017-Nachtrag)
-- ---------------------------------------------------------------------------
select tests.authenticate_as(:'su');
select start_conversation(:'l_hit', 'M8U Frage') as conv \gset
select tests.as_postgres();
alter table public.messages disable trigger messages_guard_update;
update public.messages set created_at = created_at - interval '5 minutes' where conversation_id = :'conv';
alter table public.messages enable trigger messages_guard_update;
select (select e from jsonb_array_elements(claim_chat_notifications(:'chat_secret')) e where (e ->> 'recipient_id')::uuid = :'o') as cmail \gset
select :'cmail'::jsonb ->> 'unsubscribe_token' as ctok \gset
select is((select array_agg(k order by k) from jsonb_object_keys(:'cmail'::jsonb) k),
  array['conversations', 'email', 'language', 'recipient_id', 'unsubscribe_token'], 'Chat-Mail: genau diese Schlüssel');
select ok(:'ctok' ~ '^[0-9a-f]{64}$' and exists (
    select 1 from private.unsubscribe_tokens t where t.token_hash = extensions.digest(decode(:'ctok', 'hex'), 'sha256')
      and t.user_id = :'o' and t.scope = 'chat' and t.target_ids = '{}'),
  'Chat-Token: Hex, gespeichert als Hash mit Scope chat ohne Ziele');

-- ---------------------------------------------------------------------------
-- 7. unsubscribe: kein Orakel, keine Änderung bei ungültigen Token
-- ---------------------------------------------------------------------------
create function tests.flags() returns text language sql as $$
  select md5(coalesce((select string_agg(id::text || notify_email::text, ',' order by id) from public.saved_searches), '')
          || coalesce((select string_agg(user_id::text || notify_chat_email::text, ',' order by user_id) from public.profiles), ''));
$$;
grant execute on function tests.flags() to anon;
select tests.flags() as before \gset
select tests.as_anon();
select lives_ok(format($$ select unsubscribe(%L) $$, encode(extensions.gen_random_bytes(32), 'hex')), 'Zufälliger Token: kein Fehler');
select lives_ok($$ select unsubscribe('') $$, 'Leerer Token: kein Fehler');
select lives_ok($$ select unsubscribe(null) $$, 'NULL: kein Fehler');
select lives_ok($$ select unsubscribe(repeat('a', 100000)) $$, 'Überlanger Token: kein Fehler');
select lives_ok(format($$ select unsubscribe(%L) $$, upper(:'stok')), 'Großbuchstaben (nicht das Format): kein Fehler');
select lives_ok(format($$ select unsubscribe(%L) $$, :'stok' || '0'), '65 Zeichen: kein Fehler');
select lives_ok($$ select unsubscribe('zz' || repeat('0', 62)) $$, 'Kein Hex: kein Fehler');
select lives_ok($$ select unsubscribe(E'\n'' or true --') $$, 'Steuerzeichen und SQL: kein Fehler');
select is(pg_typeof(unsubscribe('x'))::text, 'void', 'Rückgabe immer void');
select tests.as_postgres();
select is(tests.flags(), :'before', 'Ungültige Token ändern nichts');

-- Abgelaufener Token (älter als unsubscribe_token_days) wirkt nicht.
update private.unsubscribe_tokens set created_at = now() - interval '91 days'
where token_hash = extensions.digest(decode(:'otok', 'hex'), 'sha256');
select tests.as_anon();
select unsubscribe(:'otok');
select tests.as_postgres();
select is(tests.flags(), :'before', 'Abgelaufener Token ändert nichts');

-- Gültig, als anon (One-Click ohne Cookies)
select tests.as_anon();
select lives_ok(format($$ select unsubscribe(%L) $$, :'stok'), 'anon bestellt mit gültigem Token ab');
select tests.as_postgres();
select is(array(select name || ':' || notify_email::text from saved_searches where user_id in (:'su', :'so') order by name),
  array['A:false', 'B:false', 'C ohne Treffer:true', 'Fremd:true'],
  'Genau die Aufträge der Mail: E-Mail aus; anderer Auftrag und fremder Auftrag unberührt');
select tests.as_anon();
select lives_ok(format($$ select unsubscribe(%L) $$, :'stok'), 'Zweiter Aufruf: kein Fehler');
select tests.as_postgres();
select ok(exists (select 1 from private.unsubscribe_tokens where token_hash = extensions.digest(decode(:'stok', 'hex'), 'sha256')),
  'Token bleibt bis zum Ablauf gültig');

-- Chat als authenticated (anderer Nutzer, der Token ist die Berechtigung); gesperrtes Konto bestellt trotzdem ab.
update profiles set is_blocked = true where user_id = :'o';
select tests.authenticate_as(:'so');
select lives_ok(format($$ select unsubscribe(%L) $$, :'ctok'), 'authenticated darf ausführen');
select tests.as_postgres();
select ok((select not notify_chat_email from profiles where user_id = :'o')
          and (select notify_chat_email from profiles where user_id = :'su'),
  'Chat-Token: notify_chat_email = false nur beim Empfänger, auch gesperrt');
select is(array(select name || ':' || notify_email::text from saved_searches where user_id in (:'su', :'so') order by name),
  array['A:false', 'B:false', 'C ohne Treffer:true', 'Fremd:true'], 'Chat-Token berührt keine Suchaufträge');

-- ---------------------------------------------------------------------------
-- 8. Retention (A9)
-- ---------------------------------------------------------------------------
update private.moderation_notifications set done_at = now() - interval '31 days' where listing_id = :'l_ok';
update private.moderation_notifications set claimed_at = now() - interval '31 days', created_at = now() - interval '31 days'
where listing_id = :'l_b';
update private.unsubscribe_tokens set created_at = now() - interval '91 days'
where token_hash = extensions.digest(decode(:'stok', 'hex'), 'sha256');
select private.purge_search_notifications() as purge \gset
select ok((:'purge'::jsonb ->> 'moderation')::int = 3 and (:'purge'::jsonb ->> 'tokens')::int = 2,
  'Retention zählt Moderations-Mails und Token');
select ok(not exists (select 1 from private.moderation_notifications where listing_id in (:'l_ok', :'l_b'))
          and exists (select 1 from private.moderation_notifications where listing_id = :'l_chg'),
  'Moderations-Mails 30 Tage nach Erledigung (auch geclaimt-unbestätigt) weg, jüngere bleiben');
select ok(not exists (select 1 from private.unsubscribe_tokens where token_hash = extensions.digest(decode(:'stok', 'hex'), 'sha256'))
          and exists (select 1 from private.unsubscribe_tokens where token_hash = extensions.digest(decode(:'ctok', 'hex'), 'sha256')),
  'Token nach 90 Tagen weg, jüngere bleiben');

select * from finish();
rollback;
