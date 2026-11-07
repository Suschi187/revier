-- QA-Nachprüfung M8 (docs/QA-REPORT.md, „M8 – Nachprüfung“): Proben zu F1 (20261109100000), kein Feature-Code.
-- F1 verschiebt nur die Bestimmung von has_daily hinter die Entdopplung. Geprüft wird die Gegenrichtung:
-- Eine Mail mit echtem täglichem Treffer verbraucht den Kalendertag weiter (auch gemischt mit einem doppelten),
-- ein Release gibt ihn zurück, und nach einer Mail nur mit doppelten täglichen Treffern kommt ein neuer täglicher
-- Treffer am selben Tag noch (danach nicht noch einer). Dazu Rechte, Owner und Definer der neuen Fassung.
begin;
\ir _helpers.psql
select plan(23);

set constraints all immediate;
select s.decrypted_secret as secret from vault.decrypted_secrets s where s.name = 'search_notifications_secret' \gset

-- Fremde Daten dieser Datenbank nicht mitzählen (alles in der Transaktion, Rollback am Ende).
update public.saved_searches set notify_email = false;
delete from private.search_match_queue;
delete from private.saved_search_matches;
delete from private.saved_search_deliveries;
delete from private.search_notification_claims;
delete from private.search_notification_state;
delete from private.moderation_notifications;
delete from private.unsubscribe_tokens;
update private.app_settings set value = '2' where key = 'saved_search_instant_delay_minutes';
update private.app_settings set value = '10' where key = 'saved_search_instant_min_gap_minutes';
update private.app_settings set value = '0' where key = 'saved_search_daily_hour';

create function tests.nsearch(uid uuid, f jsonb, c public.saved_search_cadence, label text)
returns uuid language sql as $$
  insert into public.saved_searches (user_id, name, filters, cadence, created_at)
  values (uid, label, f, c, now() - interval '1 hour') returning id;
$$;
create function tests.nrecipient(result jsonb, mail text) returns jsonb language sql as $$
  select e from jsonb_array_elements(result -> 'recipients') e where e ->> 'email' = mail;
$$;
create function tests.nitems(result jsonb, mail text) returns text[] language sql as $$
  select coalesce(array_agg(i ->> 'listing_id' order by i ->> 'listing_id'), '{}')
  from jsonb_array_elements(tests.nrecipient(result, mail) -> 'items') i;
$$;
create function tests.nlisting(owner uuid, kind public.listing_kind, title text, region uuid) returns uuid language sql as $$
  insert into public.listings (owner_id, kind, direction, title, description, content_language, region_id, status, expires_at, attributes)
  values (owner, kind, 'offer', title, title || ' für die Nachprüfung des Kalendertags.', 'de', region, 'active',
          now() + interval '30 days',
          case when kind = 'trophy_hunt' then '{"legal_ack": true}'::jsonb else '{}'::jsonb end) returning id;
$$;
create function tests.ndue(uid uuid) returns void language sql as $$
  update private.saved_search_matches set due_at = now() - interval '1 minute' where user_id = uid and done_at is null;
$$;
create function tests.npass(minutes int) returns void language sql as $$
  update private.saved_search_matches set due_at = due_at - make_interval(mins => minutes);
  update private.search_notification_state set last_sent_at = last_sent_at - make_interval(mins => minutes);
  update private.search_notification_claims set claimed_at = claimed_at - make_interval(mins => minutes);
$$;
create function tests.nday(uid uuid) returns date language sql as $$
  select last_daily_on from private.search_notification_state where user_id = uid;
$$;

select id as muc from regions where code = 'DE-09162' \gset
select (now() at time zone private.setting_text('saved_search_timezone'))::date as today \gset
select tests.create_user('qa8n-own@test.local') as qo \gset

-- ===========================================================================
-- 0. Neue Fassung: Rechte, Owner, Definer unverändert
-- ===========================================================================
select is((select pg_get_userbyid(p.proowner) from pg_proc p where p.oid = 'public.claim_search_notifications(text, integer)'::regprocedure),
  'postgres', 'claim_search_notifications: Owner postgres');
select is((select p.prosecdef and p.proconfig = array['search_path=""'] from pg_proc p
           where p.oid = 'public.claim_search_notifications(text, integer)'::regprocedure),
  true, 'claim_search_notifications: Definer mit leerem search_path');
select is(array(select r from unnest(array['anon', 'authenticated', 'service_role']) r
                where has_function_privilege(r, 'public.claim_search_notifications(text, integer)', 'execute')),
  array['service_role'], 'claim_search_notifications: execute nur für service_role');
select ok(position('erst nach der Entdopplung' in (select p.prosrc from pg_proc p
          where p.oid = 'public.claim_search_notifications(text, integer)'::regprocedure)) > 0,
  'Die angewendete Fassung ist die aus 20261109100000');

-- ===========================================================================
-- 1. Gegenrichtung: echter täglicher Treffer setzt den Tag, ein zweiter am selben Tag wartet
-- ===========================================================================
select tests.create_user('qa8n-a@test.local') as qa \gset
select tests.nsearch(:'qa', '{"v": 1, "kind": "lease"}', 'daily', 'QA täglich A') as sa \gset
select tests.nlisting(:'qo', 'lease', 'QA Pacht A1', :'muc') as la1 \gset
select private.process_search_match_queue(50) is not null;
select tests.ndue(:'qa');
select claim_search_notifications(:'secret') as ca1 \gset
select is(tests.nitems(:'ca1'::jsonb, 'qa8n-a@test.local'), array[:'la1'], 'A: Mail mit dem täglichen Treffer A1');
select is((select set_daily from private.search_notification_claims
           where claim_id = (tests.nrecipient(:'ca1'::jsonb, 'qa8n-a@test.local') ->> 'claim_id')::uuid),
  true, 'A: Claim merkt set_daily');
select is(tests.nday(:'qa'), :'today'::date, 'A: Kalendertag ist heute (Gegenrichtung zu F1)');
select is(confirm_search_notifications(:'secret', array[(tests.nrecipient(:'ca1'::jsonb, 'qa8n-a@test.local') ->> 'claim_id')::uuid]),
  1, 'A: Confirm');
select is(tests.nday(:'qa'), :'today'::date, 'A: Kalendertag bleibt nach Confirm');
select tests.npass(15);
select tests.nlisting(:'qo', 'lease', 'QA Pacht A2', :'muc') as la2 \gset
select private.process_search_match_queue(50) is not null;
select tests.ndue(:'qa');
select claim_search_notifications(:'secret') as ca2 \gset
select is(tests.nrecipient(:'ca2'::jsonb, 'qa8n-a@test.local'), null, 'A: Zweiter täglicher Treffer am selben Tag geht nicht');
select is((select count(*)::int from private.saved_search_matches where user_id = :'qa' and listing_id = :'la2' and done_at is null),
  1, 'A: A2 wartet offen auf den nächsten Tag');

-- ===========================================================================
-- 2. Release gibt den Tag zurück, erneuter Claim setzt ihn wieder
-- ===========================================================================
-- A trifft auch Pachten aus B; A deshalb ruhen lassen.
update public.saved_searches set notify_email = false where user_id = :'qa';
select tests.create_user('qa8n-b@test.local') as qb \gset
select tests.nsearch(:'qb', '{"v": 1, "kind": "lease"}', 'daily', 'QA täglich B') as sb \gset
select tests.nlisting(:'qo', 'lease', 'QA Pacht B1', :'muc') as lb1 \gset
select private.process_search_match_queue(50) is not null;
select tests.ndue(:'qb');
select claim_search_notifications(:'secret') as cb1 \gset
select is(tests.nday(:'qb'), :'today'::date, 'B: Claim setzt den Tag');
select is(release_search_notifications(:'secret', array[(tests.nrecipient(:'cb1'::jsonb, 'qa8n-b@test.local') ->> 'claim_id')::uuid]),
  1, 'B: Release');
select is(tests.nday(:'qb'), null, 'B: Release gibt den Kalendertag zurück');
select claim_search_notifications(:'secret') as cb2 \gset
select is(tests.nitems(:'cb2'::jsonb, 'qa8n-b@test.local'), array[:'lb1'], 'B: Erneuter Claim liefert B1');
select is(tests.nday(:'qb'), :'today'::date, 'B: und setzt den Tag wieder');
select confirm_search_notifications(:'secret', array[(tests.nrecipient(:'cb2'::jsonb, 'qa8n-b@test.local') ->> 'claim_id')::uuid]);

-- ===========================================================================
-- 3. Gemischt: doppelter und echter täglicher Treffer in einer Mail setzen den Tag
-- ===========================================================================
update private.app_settings set value = '24' where key = 'saved_search_daily_hour';
select tests.create_user('qa8n-c@test.local') as qc \gset
select tests.nsearch(:'qc', '{"v": 1, "kind": "trophy_hunt"}', 'instant', 'QA sofort C') as sc_i \gset
select tests.nsearch(:'qc', '{"v": 1, "kind": "trophy_hunt"}', 'daily', 'QA täglich C') as sc_d \gset
select tests.nlisting(:'qo', 'trophy_hunt', 'QA Trophäe C1', :'muc') as lc1 \gset
select private.process_search_match_queue(50) is not null;
select tests.ndue(:'qc');
select claim_search_notifications(:'secret') as cc1 \gset
select is(tests.nitems(:'cc1'::jsonb, 'qa8n-c@test.local'), array[:'lc1'], 'C: Vor der Stunde geht C1 sofort');
select confirm_search_notifications(:'secret', array[(tests.nrecipient(:'cc1'::jsonb, 'qa8n-c@test.local') ->> 'claim_id')::uuid]);
select tests.npass(15);
update private.app_settings set value = '0' where key = 'saved_search_daily_hour';
select tests.nlisting(:'qo', 'trophy_hunt', 'QA Trophäe C2', :'muc') as lc2 \gset
select private.process_search_match_queue(50) is not null;
-- C2 nur täglich: den Sofort-Treffer zu C2 herausnehmen.
delete from private.saved_search_matches where saved_search_id = :'sc_i' and listing_id = :'lc2';
select tests.ndue(:'qc');
select claim_search_notifications(:'secret') as cc2 \gset
select is(tests.nitems(:'cc2'::jsonb, 'qa8n-c@test.local'), array[:'lc2'], 'C: Mail nur mit C2 (C1 täglich ist doppelt)');
select is((select outcome::text from private.saved_search_matches where saved_search_id = :'sc_d' and listing_id = :'lc1'),
  'duplicate', 'C: täglicher Treffer C1 als doppelt erledigt');
select is(tests.nday(:'qc'), :'today'::date, 'C: echter täglicher Treffer neben einem doppelten setzt den Tag');
select confirm_search_notifications(:'secret', array[(tests.nrecipient(:'cc2'::jsonb, 'qa8n-c@test.local') ->> 'claim_id')::uuid]);

-- ===========================================================================
-- 4. Nach der F1-Mail (nur doppelte tägliche Treffer) kommt ein neuer täglicher Treffer am selben Tag noch
-- ===========================================================================
update private.app_settings set value = '24' where key = 'saved_search_daily_hour';
select tests.create_user('qa8n-d@test.local') as qd \gset
select tests.nsearch(:'qd', '{"v": 1, "kind": "trophy_hunt"}', 'instant', 'QA sofort D') as sd_i \gset
select tests.nsearch(:'qd', '{"v": 1, "kind": "trophy_hunt"}', 'daily', 'QA täglich D') as sd_d \gset
-- C hat keine offenen Treffer mehr; neue Trophäen treffen auch C, deshalb C pausieren.
update public.saved_searches set notify_email = false where user_id = :'qc';
select tests.nlisting(:'qo', 'trophy_hunt', 'QA Trophäe X', :'muc') as lx \gset
select private.process_search_match_queue(50) is not null;
select tests.ndue(:'qd');
select claim_search_notifications(:'secret') as cd1 \gset
select confirm_search_notifications(:'secret', array[(tests.nrecipient(:'cd1'::jsonb, 'qa8n-d@test.local') ->> 'claim_id')::uuid]);
select tests.npass(15);
update private.app_settings set value = '0' where key = 'saved_search_daily_hour';
select tests.nlisting(:'qo', 'trophy_hunt', 'QA Trophäe Y', :'muc') as ly \gset
select private.process_search_match_queue(50) is not null;
delete from private.saved_search_matches where saved_search_id = :'sd_d' and listing_id = :'ly';
select tests.ndue(:'qd');
select claim_search_notifications(:'secret') as cd2 \gset
select confirm_search_notifications(:'secret', array[(tests.nrecipient(:'cd2'::jsonb, 'qa8n-d@test.local') ->> 'claim_id')::uuid]);
select is(tests.nday(:'qd'), null, 'D: Mail nur mit Y, der Tag bleibt frei (F1)');
-- Z nur täglich, innerhalb des Sofort-Abstands (der tägliche Takt kennt keinen Abstand).
select tests.nlisting(:'qo', 'trophy_hunt', 'QA Trophäe Z', :'muc') as lz \gset
select private.process_search_match_queue(50) is not null;
delete from private.saved_search_matches where saved_search_id = :'sd_i' and listing_id = :'lz';
select tests.ndue(:'qd');
select claim_search_notifications(:'secret') as cd3 \gset
select is(tests.nitems(:'cd3'::jsonb, 'qa8n-d@test.local'), array[:'lz'], 'D: Neuer täglicher Treffer Z geht am selben Tag');
select confirm_search_notifications(:'secret', array[(tests.nrecipient(:'cd3'::jsonb, 'qa8n-d@test.local') ->> 'claim_id')::uuid]);
select is(tests.nday(:'qd'), :'today'::date, 'D: Danach ist der Tag verbraucht');

select * from finish();
rollback;
