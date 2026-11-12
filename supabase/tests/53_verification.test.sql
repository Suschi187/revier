-- M9b Commit 6 (ADR 020, Plan M9 4.3/4.6, Review A6, A7, A11, B3): Verifizierung „Zeile zuerst“, Entscheidung und
-- Widerruf nur per RPC, Storage-Bindung, Dokumentansicht nur mit frischem Audit, Profilstatus und Cache-Zähler,
-- Warteschlange account_notifications, Audit und Moderations-Mails auf Server-Pfaden mit Flag.
begin;
\ir _helpers.psql
select plan(90);

select set_config('storage.allow_delete_query', 'true', true);
select s.decrypted_secret as secret from vault.decrypted_secrets s where s.name = 'search_notifications_secret' \gset
select s.decrypted_secret as chat_secret from vault.decrypted_secrets s where s.name = 'chat_notifications_secret' \gset

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

-- Datei auf den Pfad eines Antrags legen (wie die Storage-API, als der Besitzer).
create function tests.upload(ver uuid) returns void language plpgsql as $$
declare
  v record;
begin
  perform tests.as_postgres();
  select user_id, document_path into v from public.verifications where id = ver;
  perform tests.authenticate_as(v.user_id);
  insert into storage.objects (bucket_id, name, owner_id) values ('verification-docs', v.document_path, v.user_id);
end;
$$;
create function tests.submitted(owner uuid, doc text default 'jagdschein') returns uuid language plpgsql as $$
declare
  ver uuid;
begin
  perform tests.authenticate_as(owner);
  ver := (public.begin_verification(doc::public.document_type) ->> 'id')::uuid;
  perform tests.upload(ver);
  perform tests.authenticate_as(owner);
  perform public.submit_verification(ver);
  perform tests.as_postgres();
  return ver;
end;
$$;
create function tests.status(u uuid) returns text language sql as $$
  select verification_status::text from public.profiles where user_id = u;
$$;
create function tests.notes(u uuid) returns text[] language sql as $$
  select coalesce(array_agg(n.kind order by n.kind), '{}') from private.account_notifications n where n.user_id = u;
$$;
grant execute on all functions in schema tests to authenticated;

select tests.create_user('m9b-a@test.local') as a \gset
select tests.create_user('m9b-b@test.local') as b \gset
select tests.create_user('m9b-c@test.local') as c \gset
select tests.create_user('m9b-biz@test.local') as biz \gset
select tests.create_user('m9b-new@test.local', null, false) as nolegal \gset
select tests.create_user('m9b-adm@test.local') as adm \gset
select tests.create_user('m9b-adm2@test.local') as adm2 \gset
select tests.make_admin(:'adm');
select tests.make_admin(:'adm2');
update profiles set account_type = 'business', business_name = 'Jagdreisen GmbH' where user_id = :'biz';

-- ---------------------------------------------------------------------------
-- 1. Bucket und Rechte
-- ---------------------------------------------------------------------------
select is((select allowed_mime_types from storage.buckets where id = 'verification-docs'),
  array['image/jpeg', 'image/png', 'application/pdf'], 'Bucket: JPEG, PNG, PDF, kein HEIC');
select ok(not has_table_privilege('authenticated', 'public.verifications', 'insert')
          and not has_table_privilege('authenticated', 'public.verifications', 'update')
          and not exists (select 1 from pg_policies where tablename = 'verifications' and cmd in ('INSERT', 'UPDATE')),
  'Kein Roh-INSERT und kein Roh-UPDATE an verifications (auch keine Policy)');
select ok(not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and cmd = 'UPDATE'
                      and coalesce(qual, '') || coalesce(with_check, '') like '%verification%'),
  'Keine Update-Policy im Dokument-Bucket (kein Upsert)');
select ok(not has_table_privilege('authenticated', 'private.verification_attempts', 'select')
          and not has_table_privilege('service_role', 'private.account_notifications', 'select'),
  'Zähler und Warteschlange sind für keine API-Rolle lesbar');
select is(
  array(select p.proname || ':' || has_function_privilege('anon', p.oid, 'execute') || ':' || has_function_privilege('authenticated', p.oid, 'execute')
               || ':' || has_function_privilege('service_role', p.oid, 'execute')
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname like '%account_notifications' order by 1),
  array['claim_account_notifications:false:false:true', 'confirm_account_notifications:false:false:true',
        'release_account_notifications:false:false:true'], 'claim/confirm/release der Dienstmails nur service_role');

-- ---------------------------------------------------------------------------
-- 2. begin / submit / withdraw
-- ---------------------------------------------------------------------------
select tests.authenticate_as(:'a');
select begin_verification('jagdschein') as v1 \gset
select (:'v1'::jsonb ->> 'id') as v1_id, (:'v1'::jsonb ->> 'path') as v1_path \gset
select is(:'v1_path', :'a' || '/' || :'v1_id', 'Der Server setzt den Pfad {user_id}/{id}');
select is(tests.status(:'a'), 'none', 'Ein nicht eingereichter Antrag ändert den Profilstatus nicht');
select is((begin_verification('jagdkarte') ->> 'id'), :'v1_id', 'Erneuter Beginn ohne Einreichung: derselbe Antrag');
select is((select document_type::text from verifications where id = :'v1_id'), 'jagdkarte', '… mit dem neuen Dokumenttyp');
select tests.as_postgres();
select is((select count(*)::int from private.verification_attempts where user_id = :'a'), 1, '… und ohne neuen Versuch');
select tests.authenticate_as(:'a');
select is(tests.err($$ select begin_verification('gewerbe') $$), '23514', 'gewerbe nur für gewerbliche Konten');
select is(tests.err(format($$ select submit_verification(%L) $$, :'v1_id')), '23514', 'Ohne Datei nicht einreichbar');
select tests.authenticate_as(:'b');
select is(tests.err(format($$ select submit_verification(%L) $$, :'v1_id')), 'P0002', 'Fremder Antrag: P0002');
select is(tests.err(format($$ select submit_verification(%L) $$, gen_random_uuid())), 'P0002', 'Unbekannter Antrag: P0002');
select is(tests.err(format($$ insert into storage.objects (bucket_id, name, owner_id) values ('verification-docs', %L, %L) $$, :'v1_path', :'b')),
  '42501', 'B lädt nicht auf den Pfad des Antrags von A');
select is(tests.err(format($$ select withdraw_verification(%L) $$, :'v1_id')), 'P0002', 'B zieht den Antrag von A nicht zurück');

select tests.upload(:'v1_id');
select tests.authenticate_as(:'a');
select is((select count(*)::int from storage.objects where bucket_id = 'verification-docs' and name = :'v1_path'), 1, 'A sieht die eigene Datei');
delete from storage.objects where bucket_id = 'verification-docs' and name = :'v1_path';
select is((select count(*)::int from storage.objects where name = :'v1_path'), 0, 'Vor der Einreichung löscht A die Datei selbst');
select tests.upload(:'v1_id');
select tests.authenticate_as(:'a');
select submit_verification(:'v1_id');
select is(tests.status(:'a'), 'pending', 'Einreichen setzt das Profil auf pending');
select is(tests.err(format($$ select submit_verification(%L) $$, :'v1_id')), 'RV003', 'Zweites Einreichen: RV003');
select is(tests.err(format($$ insert into storage.objects (bucket_id, name, owner_id) values ('verification-docs', %L, %L) $$,
                           :'a' || '/' || gen_random_uuid(), :'a')), '42501', 'Nach der Einreichung kein weiterer Upload');
delete from storage.objects where bucket_id = 'verification-docs' and name = :'v1_path';
select tests.as_postgres();
select is((select count(*)::int from storage.objects where name = :'v1_path'), 1, 'Nach der Einreichung löscht A die Datei nicht mehr');
select tests.authenticate_as(:'a');
select is(tests.err($$ select begin_verification('jagdschein') $$), '23505', 'Eingereichter offener Antrag: kein zweiter');
select withdraw_verification(:'v1_id');
select is(tests.status(:'a'), 'none', 'Zurückziehen setzt den Status zurück');

-- Limit: Zurückziehen umgeht es nicht (Review A6).
select (begin_verification('jagdschein') ->> 'id') as v2_id \gset
select withdraw_verification(:'v2_id');
select (begin_verification('jagdschein') ->> 'id') as v3_id \gset
select withdraw_verification(:'v3_id');
select is(tests.err($$ select begin_verification('jagdschein') $$), 'RV002', 'Vierter Versuch in 30 Tagen: RV002');
create temp table limit_hint (hint jsonb);
grant all on limit_hint to authenticated;
do $$
begin
  perform public.begin_verification('jagdschein');
exception when sqlstate 'RV002' then
  declare h text;
  begin
    get stacked diagnostics h = pg_exception_hint;
    insert into limit_hint values (h::jsonb);
  end;
end;
$$;
select is((select hint ->> 'scope' from limit_hint), 'verification', 'RV002 mit scope verification');
select ok((select (hint ->> 'retry_after')::timestamptz > now() + interval '29 days' from limit_hint), 'retry_after nach 30 Tagen');
select tests.as_postgres();
update private.verification_attempts set created_at = now() - interval '31 days' where user_id = :'a';
select tests.authenticate_as(:'a');
select ok(begin_verification('jagdschein') ? 'id', 'Nach 30 Tagen geht es wieder');

select tests.authenticate_as(:'nolegal');
select is(tests.err($$ select begin_verification('jagdschein') $$), 'RV001', 'Ohne aktuelle Zustimmung: RV001');
select tests.as_postgres();
update profiles set is_blocked = true where user_id = :'c';
select tests.authenticate_as(:'c');
select is(tests.err($$ select begin_verification('jagdschein') $$), '42501', 'Gesperrte Konten beginnen keinen Antrag');
select tests.as_postgres();
update profiles set is_blocked = false where user_id = :'c';
select tests.authenticate_as(:'biz');
select ok(begin_verification('gewerbe') ? 'id', 'Gewerbliches Konto: gewerbe erlaubt');

-- ---------------------------------------------------------------------------
-- 3. Entscheiden
-- ---------------------------------------------------------------------------
select tests.submitted(:'b') as vb \gset
select tests.authenticate_as(:'a');
select is(tests.err(format($$ select decide_verification(%L, 'verify') $$, :'vb')), '42501', 'Nutzer entscheiden nicht');
select tests.authenticate_as(:'adm', 'aal1');
select is(tests.err(format($$ select decide_verification(%L, 'verify') $$, :'vb')), '42501', 'Admin ohne aal2 entscheidet nicht');
select tests.authenticate_as(:'adm', 'aal2');
select is(tests.err(format($$ select decide_verification(%L, 'maybe') $$, :'vb')), '22023', 'Unbekannte Entscheidung');
select is(tests.err(format($$ select decide_verification(%L, 'reject', 'blurry') $$, :'vb')), '23514', 'Unbekannter Code');
select is(tests.err(format($$ select decide_verification(%L, 'reject', 'other', '  ') $$, :'vb')), '23514', 'other braucht Freitext');
select is(tests.err(format($$ select decide_verification(%L, 'verify') $$, :'v2_id')), 'P0002', 'Gelöschter Antrag: P0002');
select tests.authenticate_as(:'a');
select (begin_verification('jagdschein') ->> 'id') as v_unsub \gset
select tests.authenticate_as(:'adm', 'aal2');
select is(tests.err(format($$ select decide_verification(%L, 'verify') $$, :'v_unsub')), 'P0002', 'Nicht eingereicht: P0002');
select is((select count(*)::int from admin_verification_queue() q where q.id = :'v_unsub'), 0, 'Warteschlange zeigt nur eingereichte Anträge');
select is((select count(*)::int from admin_verification_queue() q where q.id = :'vb'), 1, 'Eingereichter Antrag steht in der Warteschlange');
select is(tests.err(format($$ select admin_verification(%L) $$, :'v_unsub')), 'P0002', 'Detail eines nicht eingereichten Antrags: P0002');
select ok(not (admin_verification(:'vb') ? 'document_path') and not (admin_verification(:'vb') ? 'reviewed_by'),
  'Detail ohne Pfad und ohne Prüfer');

select tests.submitted(:'adm2') as v_adm2 \gset
select tests.authenticate_as(:'adm2', 'aal2');
select is(tests.err(format($$ select decide_verification(%L, 'verify') $$, :'v_adm2')), '42501', 'Selbstentscheidungsverbot');
select tests.authenticate_as(:'adm', 'aal2');
select public_cache_epoch() as e0 \gset
select is(decide_verification(:'vb', 'reject', 'unreadable')::text, 'rejected', 'Ablehnung mit Code ohne Freitext');
select is(tests.status(:'b'), 'rejected', 'Profil: rejected');
select is(public_cache_epoch(), :'e0'::bigint, 'Ablehnung ohne vorheriges Badge erhöht den Cache-Zähler nicht');
select is(tests.err(format($$ select decide_verification(%L, 'verify') $$, :'vb')), 'RV003', 'Bereits entschieden: RV003');
select tests.as_postgres();
select is((select details from audit_log where action = 'verification.rejected' and target_id = :'vb'),
  jsonb_build_object('user_id', :'b', 'code', 'unreadable', 'reason', null), 'Audit mit Code und Begründung');
select is(tests.notes(:'b'), array['verification_rejected'], 'Mail verification_rejected in der Warteschlange');

select tests.submitted(:'b', 'jagdkarte') as vb2 \gset
select tests.authenticate_as(:'adm', 'aal2');
select decide_verification(:'vb2', 'verify');
select is(tests.status(:'b'), 'verified', 'Profil: verified');
select is(public_cache_epoch(), :'e0'::bigint + 1, 'Wechsel zu verified erhöht den Cache-Zähler');
select tests.as_postgres();
insert into listings (owner_id, kind, direction, title, content_language, region_id, status, expires_at, attributes)
select :'b', 'helper', 'offer', 'M9b Badge', 'de', r.id, 'active', now() + interval '30 days', '{"tasks": ["Ansitz"]}'
from regions r where r.code = 'DE-14612' returning id as l_b \gset
select tests.make_ready(:'l_b');
select is((select verification_status::text from public_profiles where user_id = :'b'), 'verified', 'Badge öffentlich sichtbar');

-- Neuer Antrag und Ablehnung heben das Badge nicht auf.
select tests.submitted(:'b') as vb3 \gset
select tests.authenticate_as(:'adm', 'aal2');
select decide_verification(:'vb3', 'reject', 'expired');
select is(tests.status(:'b'), 'verified', 'Abgelehnter neuer Antrag lässt die Verifizierung bestehen');

-- ---------------------------------------------------------------------------
-- 4. Widerruf
-- ---------------------------------------------------------------------------
select tests.authenticate_as(:'a');
select is(tests.err(format($$ select revoke_verification(%L, 'fraud') $$, :'b')), '42501', 'Nutzer widerrufen nicht');
select tests.authenticate_as(:'adm', 'aal2');
select is(tests.err(format($$ select revoke_verification(%L, 'other') $$, :'b')), '23514', 'Widerruf other braucht Freitext');
select is(tests.err(format($$ select revoke_verification(%L, 'fraud') $$, :'c')), 'P0002', 'Ohne Verifizierung: P0002');
select is(tests.err(format($$ select revoke_verification(%L, 'fraud') $$, :'adm')), '42501', 'Nicht das eigene Konto');
select revoke_verification(:'b', 'fraud', 'Nach Meldung wegen Betrugs');
select is(tests.status(:'b'), 'none', 'Widerruf: Profil none');
select is(public_cache_epoch(), :'e0'::bigint + 2, 'Widerruf erhöht den Cache-Zähler');
select is(tests.err(format($$ select revoke_verification(%L, 'fraud') $$, :'b')), 'P0002', 'Zweiter Widerruf: P0002');
select tests.as_postgres();
select is((select verification_status::text from public_profiles where user_id = :'b'), 'none', 'Badge nach Widerruf weg');
select is((select details ->> 'code' from audit_log where action = 'verification.revoked' and target_id = :'vb2'), 'fraud', 'Audit verification.revoked');
select is(tests.notes(:'b'), array['verification_rejected', 'verification_rejected', 'verification_revoked', 'verification_verified'],
  'Mails je Entscheidung und Widerruf');
select is(tests.err(format($$ update verifications set revoked_at = null, revoke_code = null where id = %L $$, :'vb2')), '42501',
  'Widerruf ist unveränderlich (auch für den Server ohne RPC)');

-- ---------------------------------------------------------------------------
-- 5. Dokumentansicht nur mit frischem Audit (Review B3)
-- ---------------------------------------------------------------------------
select tests.submitted(:'c') as vc \gset
select document_path as vc_path from verifications where id = :'vc' \gset
select tests.authenticate_as(:'adm', 'aal2');
select is((select count(*)::int from storage.objects where name = :'vc_path'), 0, 'Ohne Audit: kein Zugriff, auch für Admins');
select is(admin_open_verification_document(:'vc'), :'vc_path', 'admin_open_verification_document liefert den Pfad');
select is((select count(*)::int from storage.objects where name = :'vc_path'), 1, 'Mit frischem Audit: Zugriff');
select tests.authenticate_as(:'adm2', 'aal2');
select is((select count(*)::int from storage.objects where name = :'vc_path'), 0, 'Das Audit eines anderen Admins gilt nicht');
select tests.as_postgres();
update audit_log set created_at = now() - interval '3 minutes' where action = 'verification.document_viewed' and target_id = :'vc';
select tests.authenticate_as(:'adm', 'aal2');
select is((select count(*)::int from storage.objects where name = :'vc_path'), 0, 'Nach 2 Minuten wieder kein Zugriff');
select is(tests.err(format($$ select admin_open_verification_document(%L) $$, :'v_unsub')), 'P0002', 'Nicht eingereicht: P0002');
select tests.authenticate_as(:'adm2', 'aal2');
select is(tests.err(format($$ select admin_open_verification_document(%L) $$, :'v_adm2')), '42501', 'Eigenes Dokument öffnet ein anderer Admin');
select tests.authenticate_as(:'adm', 'aal1');
select is(tests.err(format($$ select admin_open_verification_document(%L) $$, :'vc')), '42501', 'Ohne aal2 kein Dokument');

-- ---------------------------------------------------------------------------
-- 6. Warteschlange account_notifications
-- ---------------------------------------------------------------------------
select tests.as_postgres();
select is(tests.err(format($$ insert into private.account_notifications (kind, user_id, ref_id, payload) values ('account_warned', %L, gen_random_uuid(), '{"email":"x"}') $$, :'a')),
  '23514', 'Payload-Allowlist je Art');
select is(tests.err(format($$ insert into private.account_notifications (kind, user_id, ref_id) values ('newsletter', %L, gen_random_uuid()) $$, :'a')),
  '23514', 'kind nur aus der Liste');
select is(tests.err(format($$ insert into private.account_notifications (kind, user_id, ref_id) values ('verification_revoked', %L, %L) $$, :'b', :'vb2')),
  '23505', 'Idempotent je (kind, ref_id, user_id)');
-- Konto c gelöscht markiert: erledigt ohne Versand.
select tests.authenticate_as(:'adm', 'aal2');
select decide_verification(:'vc', 'verify');
select tests.as_postgres();
update profiles set deleted_at = now() where user_id = :'c';
select tests.authenticate_as(:'b');
select is(tests.err(format($$ select claim_account_notifications(%L) $$, :'secret')), '42501', 'Nutzer rufen claim nicht auf');
select tests.as_postgres();
select is(tests.err(format($$ select claim_account_notifications(%L) $$, :'chat_secret')), '42501', 'Falsches Secret: 42501');
select claim_account_notifications(:'secret') as claims \gset
select is((select array_agg(e ->> 'kind' order by e ->> 'kind') from jsonb_array_elements(:'claims'::jsonb) e),
  array['verification_rejected', 'verification_rejected', 'verification_revoked', 'verification_verified'],
  'Claim: vier Mails an B, keine an das gelöschte Konto');
select ok((select done_at is not null and sent_at is null from private.account_notifications where user_id = :'c'), 'Gelöschtes Konto: erledigt ohne Versand');
select is((select e -> 'details' from jsonb_array_elements(:'claims'::jsonb) e where e ->> 'kind' = 'verification_revoked'),
  jsonb_build_object('document_type', 'jagdkarte', 'code', 'fraud', 'reason', 'Nach Meldung wegen Betrugs',
                     'decided_at', (select revoked_at from verifications where id = :'vb2'),
                     'appeal_until', (select revoked_at + interval '183 days' from verifications where id = :'vb2')),
  'Details aus dem Fachdatensatz (Allowlist)');
select is((select e -> 'details' -> 'appeal_until' from jsonb_array_elements(:'claims'::jsonb) e where e ->> 'kind' = 'verification_verified'),
  'null'::jsonb, 'Verifiziert: keine Anfechtungsfrist');
select is((select array_agg(k order by k) from jsonb_array_elements(:'claims'::jsonb) e, jsonb_object_keys(e) k
           where e ->> 'kind' = 'verification_verified'),
  array['claim_id', 'details', 'email', 'kind', 'language'], 'Claim-Schlüssel exakt (kein Admin, kein Pfad)');
select is(confirm_account_notifications(:'secret', array(select (e ->> 'claim_id')::uuid from jsonb_array_elements(:'claims'::jsonb) e
                                                         where e ->> 'kind' <> 'verification_verified')), 3, 'confirm');
select is(release_account_notifications(:'secret', array(select (e ->> 'claim_id')::uuid from jsonb_array_elements(:'claims'::jsonb) e
                                                         where e ->> 'kind' = 'verification_verified')), 1, 'release');
select is((select attempts from private.account_notifications n where n.user_id = :'b' and n.kind = 'verification_verified'), 1,
  'release zählt den Versuch');
select is((select array_agg(e ->> 'kind') from jsonb_array_elements(claim_account_notifications(:'secret')) e),
  array['verification_verified'], 'Freigegebene Mail kommt im nächsten Lauf wieder');
update private.account_notifications set done_at = now() - interval '31 days', created_at = now() - interval '31 days' where user_id = :'b';
select is((private.purge_trust_records() ->> 'notifications')::int >= 3, true, 'Frist 30 Tage');

-- ---------------------------------------------------------------------------
-- 7. Server-Pfade (Review A7, Lücke M8)
-- ---------------------------------------------------------------------------
select id as dd from regions where code = 'DE-14612' \gset
insert into listings (owner_id, kind, direction, title, content_language, region_id, status, expires_at, attributes)
values (:'a', 'helper', 'offer', 'M9b Server', 'de', :'dd', 'active', now() + interval '30 days', '{"tasks": ["Ansitz"]}')
returning id as l_srv \gset
select tests.make_ready(:'l_srv');
select set_config('revier.moderation', '', false);
insert into listings (owner_id, kind, direction, title, content_language, region_id, status, expires_at, attributes)
values (:'a', 'helper', 'offer', 'M9b Server ohne Flag', 'de', :'dd', 'active', now() + interval '30 days', '{"tasks": ["Ansitz"]}')
returning id as l_noflag \gset
select tests.make_ready(:'l_noflag');
select tests.err(format($$ update listings set status = 'removed', reject_code = 'prohibited_content' where id = %L $$, :'l_noflag'));
select is((select count(*)::int from audit_log where target_id = :'l_noflag'), 0, 'Ohne Flag und ohne Admin: kein Audit');
select set_config('revier.moderation', 'on', false);
update listings set status = 'removed', reject_code = 'prohibited_content' where id = :'l_srv';
select ok((select actor_id is null from audit_log where target_id = :'l_srv' and action = 'listing.removed'),
  'Server-Pfad mit Flag: Audit ohne Akteur');
select is((select decision from private.moderation_notifications where listing_id = :'l_srv'), 'removed', 'Server-Pfad mit Flag: Moderations-Mail');

select * from finish();
rollback;
