-- M9a (ADR 019, Review A5): export_my_data. Exakte Schlüsselmenge je Abschnitt, keine Daten anderer außer
-- Anzeigenamen (keine fremde UUID, keine fremde E-Mail, keine fremden Meldungen), Rate-Limit RV002, gesperrt und
-- ohne Zustimmung erlaubt, während der Löschung 42501. Wächter: Jede Tabelle mit Nutzerbezug steht in der Export-
-- Allowlist oder in der Ausschlussliste mit Grund (ADR 019).
begin;
\ir _helpers.psql
select plan(28);

set constraints all immediate;

create function tests.exp_err(statement text) returns text language plpgsql as $$
declare s text; h text;
begin
  execute statement;
  return 'ok';
exception when others then
  get stacked diagnostics s = returned_sqlstate, h = pg_exception_hint;
  return s || coalesce(' ' || nullif(h, ''), '');
end;
$$;
create function tests.keys(j jsonb) returns text[] language sql immutable as $$
  select coalesce(array_agg(k order by k), '{}') from jsonb_object_keys(j) k;
$$;
grant usage on schema tests to service_role;
grant execute on all functions in schema tests to anon, authenticated, service_role;

select tests.create_user('exp-u@test.local', 'Exp Ute') as u \gset
select tests.create_user('exp-v@test.local', 'Exp Vera') as v \gset
select tests.create_user('exp-x@test.local', 'Exp Xaver', false) as x \gset
select id as district from regions where code = 'DE-09162' \gset
insert into listings (owner_id, kind, direction, title, content_language, region_id, status, expires_at, published_at) values
  (:'u', 'helper', 'wanted', 'Exp Anzeige U', 'de', :'district', 'active', now() + interval '30 days', now()),
  (:'v', 'helper', 'wanted', 'Exp Anzeige V', 'de', :'district', 'active', now() + interval '30 days', now());
select id as lu from listings where title = 'Exp Anzeige U' \gset
select id as lv from listings where title = 'Exp Anzeige V' \gset
select tests.make_ready(:'lu');
insert into listing_photos (listing_id, sort_order, storage_path, alt_text, processed_at, width, height)
  values (:'lu', 0, :'u' || '/' || :'lu' || '/a.jpg', 'Foto', now(), 800, 600);
insert into favorites (user_id, listing_id) values (:'u', :'lv');
insert into blocks (blocker_id, blocked_id) values (:'u', :'x');
insert into devices (user_id, apns_token, platform, language) values (:'u', repeat('b', 64), 'ios', 'de');
insert into saved_searches (user_id, name, filters) values (:'u', 'Exp Suche', '{"v": 1, "kind": "helper"}');
select id as su from saved_searches where name = 'Exp Suche' \gset
insert into private.saved_search_matches (saved_search_id, listing_id, user_id, cadence, due_at, done_at, outcome)
  values (:'su', :'lv', :'u', 'instant', now(), now(), 'sent');
insert into verifications (user_id, document_type, document_path) values (:'u', 'jagdschein', :'u' || '/doc.jpg');

select tests.authenticate_as(:'u');
select start_conversation(:'lv', 'Exp Frage von Ute') as c1 \gset
insert into reports (target_type, target_id, reason) values ('listing', :'lv', 'scam');
select tests.authenticate_as(:'v');
select send_message(:'c1', 'Exp Antwort von Vera') as m_v \gset
insert into reports (target_type, target_id, reason, note) values ('profile', :'u', 'scam', 'Exp Meldung von Vera');

-- ---------------------------------------------------------------------------
select tests.as_anon();
select is(tests.exp_err('select export_my_data()'), '42501', 'anon: 42501');

select tests.authenticate_as(:'u');
select export_my_data() as e \gset
select tests.as_postgres();
select is(tests.keys(:'e'::jsonb),
  array['account', 'blocks', 'conversations', 'devices', 'favorites', 'format', 'generated_at', 'legal_acceptances', 'listings',
        'profile', 'reports', 'reviews', 'roles', 'saved_searches', 'verifications', 'version'], 'Abschnitte exakt');
select is((:'e'::jsonb ->> 'format') || ' ' || (:'e'::jsonb ->> 'version'), 'revier-export 1', 'Format und Version');
select is(tests.keys(:'e'::jsonb -> 'account'), array['created_at', 'email', 'last_sign_in_at'], 'account: Schlüssel exakt');
select is(tests.keys(:'e'::jsonb -> 'profile'),
  array['account_type', 'business_name', 'country', 'created_at', 'display_name', 'is_blocked', 'notify_chat_email', 'preferred_language',
        'verification_status'], 'profile: Schlüssel exakt');
select is(tests.keys(:'e'::jsonb -> 'legal_acceptances' -> 0), array['accepted_at', 'document', 'source', 'version'], 'legal_acceptances: Schlüssel exakt');
select is(tests.keys(:'e'::jsonb -> 'listings' -> 0),
  array['approved_at', 'area_hectares', 'attributes', 'content_language', 'country', 'created_at', 'currency', 'description', 'direction',
        'end_date', 'expires_at', 'id', 'kind', 'photos', 'place', 'price_minor', 'price_unit', 'published_at', 'region_code', 'reject_code',
        'reject_reason', 'species', 'start_date', 'status', 'submitted_at', 'title'], 'listings: Schlüssel exakt (ohne Kartenpunkt und Verfremdung)');
select is(tests.keys(:'e'::jsonb -> 'listings' -> 0 -> 'photos' -> 0), array['alt_text', 'created_at', 'height', 'id', 'sort_order', 'width'],
  'photos: Schlüssel exakt (ohne Pfade; download_url ergänzt die Route)');
select is(tests.keys(:'e'::jsonb -> 'listings' -> 0 -> 'place'), array['place_name', 'postal_code'], 'place: PLZ und Ort');
select is(tests.keys(:'e'::jsonb -> 'favorites' -> 0), array['created_at', 'listing_id', 'title'], 'favorites: Schlüssel exakt');
select is(tests.keys(:'e'::jsonb -> 'saved_searches' -> 0),
  array['cadence', 'created_at', 'expires_at', 'filters', 'matches', 'name', 'notify_email', 'notify_push', 'paused_at'], 'saved_searches: Schlüssel exakt');
select is(tests.keys(:'e'::jsonb -> 'saved_searches' -> 0 -> 'matches' -> 0), array['listing_id', 'matched_at', 'sent_at'], 'matches: Schlüssel exakt');
select is(tests.keys(:'e'::jsonb -> 'conversations' -> 0),
  array['counterpart', 'created_at', 'listing_id', 'listing_title', 'messages', 'role'], 'conversations: Schlüssel exakt');
select is(tests.keys(:'e'::jsonb -> 'conversations' -> 0 -> 'messages' -> 0), array['body', 'created_at', 'from', 'read_at'], 'messages: Schlüssel exakt');
select is(tests.keys(:'e'::jsonb -> 'blocks' -> 0), array['created_at', 'display_name'], 'blocks: Schlüssel exakt');
select is(tests.keys(:'e'::jsonb -> 'reports' -> 0),
  array['created_at', 'handled_at', 'note', 'reason', 'status', 'target_label', 'target_type'], 'reports: Schlüssel exakt (ohne handled_by)');
select is(tests.keys(:'e'::jsonb -> 'devices' -> 0), array['created_at', 'language', 'platform'], 'devices: ohne Token');
select is(tests.keys(:'e'::jsonb -> 'verifications' -> 0),
  array['created_at', 'decided_at', 'document_present', 'document_type', 'reject_reason', 'status'], 'verifications: ohne Pfad und Prüfer');

-- Keine Daten anderer außer Anzeigenamen.
select ok(position(:'v' in :'e') = 0 and position('exp-v@test.local' in :'e') = 0, 'keine UUID und keine E-Mail des Gegenübers');
select ok(position('Exp Meldung von Vera' in :'e') = 0 and jsonb_array_length(:'e'::jsonb -> 'reports') = 1, 'fremde Meldungen über das Konto fehlen');
select is(:'e'::jsonb #>> '{conversations,0,counterpart}', 'Exp Vera', 'Gegenüber nur mit Anzeigenamen');
select is((select string_agg(m ->> 'from', ',' order by m ->> 'created_at') from jsonb_array_elements(:'e'::jsonb #> '{conversations,0,messages}') m),
  'me,counterpart', 'Nachrichten beider Seiten mit from');
select is(:'e'::jsonb #>> '{blocks,0,display_name}', 'Exp Xaver', 'Blockierungen mit Anzeigenamen statt UUID');

-- Rate-Limit: 3 je 24 h (einer ist schon verbraucht).
select tests.authenticate_as(:'u');
select export_my_data() is not null and export_my_data() is not null as two \gset
select ok(split_part(tests.exp_err('select export_my_data()'), ' ', 1) = 'RV002'
          and tests.exp_err('select export_my_data()') like '%"scope": "data_export"%', 'viertes Mal in 24 h: RV002 mit scope data_export');

-- Gesperrt und ohne Zustimmung erlaubt, während der Löschung nicht.
select tests.as_postgres();
update profiles set is_blocked = true where user_id = :'x';
select tests.authenticate_as(:'x');
select is(tests.exp_err('select export_my_data()'), 'ok', 'gesperrt und ohne Zustimmung: erlaubt');
select tests.as_postgres();
update profiles set deleted_at = now() where user_id = :'x';
select tests.authenticate_as(:'x');
select is(tests.exp_err('select export_my_data()'), '42501', 'während der Löschung: 42501');

-- Wächter (Review A5): Tabellen mit Nutzerbezug (wie 00_meta) stehen in der Export-Allowlist oder der Ausschlussliste.
select tests.as_postgres();
select is(
  array(select distinct n.nspname || '.' || c.relname
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
        join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
        left join pg_constraint k on k.conrelid = c.oid and k.contype = 'f' and a.attnum = any (k.conkey)
          and k.confrelid in ('public.profiles'::regclass, 'auth.users'::regclass)
        where n.nspname in ('public', 'private') and c.relkind in ('r', 'p')
          and (k.oid is not null or (a.atttypid = 'uuid'::regtype
               and a.attname ~ '^(user|owner|sender|recipient|actor|reporter|handled_by|reviewed_by|blocker|blocked|interested|target|author)(_id)?$'))
        except
        select unnest(array[
          -- Export-Allowlist
          'public.profiles', 'private.user_roles', 'public.legal_acceptances', 'public.listings', 'public.favorites', 'public.saved_searches',
          'private.saved_search_matches', 'public.conversations', 'public.messages', 'public.blocks', 'public.reports', 'public.devices',
          'public.verifications', 'public.reviews',
          -- Ausschlussliste (ADR 019): Audit und Admin-Daten, Kopien gemeldeter Nachrichten (Schutz der Meldenden),
          -- Hashes und Token, Zähler, Versandzustände, Anker der Löschung
          'public.audit_log', 'private.admin_lookups', 'private.reported_message_snapshots', 'private.unsubscribe_tokens',
          'private.listing_creations', 'private.photo_creations', 'private.data_exports', 'private.chat_notifications',
          'private.moderation_notifications', 'private.saved_search_deliveries', 'private.search_notification_claims',
          'private.search_notification_state', 'private.account_deletions'])
        order by 1),
  '{}'::text[], 'Jede Tabelle mit Nutzerbezug steht in der Export-Allowlist oder der Ausschlussliste');

select ok(not has_function_privilege('anon', 'public.export_my_data()', 'execute')
          and not has_function_privilege('service_role', 'public.export_my_data()', 'execute')
          and not has_table_privilege('authenticated', 'private.data_exports', 'select'), 'Rechte: nur authenticated, Zähler nicht lesbar');

select * from finish();
rollback;
