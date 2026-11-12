-- M9b Commit 10 (ADR 020, ADR 008, SPEC 7.3): Fristen für Verifizierungsdokumente, Anträge ohne Einreichung, Dateien
-- ohne Antrag, verlassene Entwürfe mit Hinweis; edited_at nur durch Besitzer-Änderungen, auch an Fotos und Wildarten.
begin;
\ir _helpers.psql
select plan(31);

select s.decrypted_secret as msecret from vault.decrypted_secrets s where s.name = 'account_maintenance_secret' \gset
select s.decrypted_secret as secret from vault.decrypted_secrets s where s.name = 'search_notifications_secret' \gset

create function tests.err(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlstate;
end;
$$;
grant execute on function tests.err(text) to authenticated;

select tests.create_user('m9m-owner@test.local', 'Otto') as o \gset
select tests.create_user('m9m-adm@test.local') as adm \gset
select tests.create_user('m9m-v2@test.local') as o2 \gset
select tests.create_user('m9m-v3@test.local') as o3 \gset
select tests.make_admin(:'adm');
select id as dd from regions where code = 'DE-14612' \gset

-- ---------------------------------------------------------------------------
-- 1. edited_at
-- ---------------------------------------------------------------------------
select ok(not has_column_privilege('authenticated', 'public.listings', 'edited_at', 'update')
          and not has_column_privilege('authenticated', 'public.listings', 'draft_notice_at', 'update'), 'Nur der Server setzt edited_at und draft_notice_at');
select tests.authenticate_as(:'o');
insert into listings (kind, direction, title, content_language, region_id) values ('helper', 'offer', 'M9m Entwurf', 'de', :'dd') returning id as d \gset
select tests.as_postgres();
set local session_replication_role = replica;
update listings set edited_at = now() - interval '2 years' where id = :'d';
set local session_replication_role = origin;
select tests.authenticate_as(:'adm', 'aal2');
select tests.err(format($$ update listings set title = 'fremd' where id = %L $$, :'d'));
select tests.as_postgres();
select ok((select edited_at < now() - interval '1 year' from listings where id = :'d'), 'Admin ändert nichts an edited_at');
select tests.authenticate_as(:'o');
update listings set title = 'M9m Entwurf neu' where id = :'d';
select tests.as_postgres();
select ok((select edited_at > now() - interval '1 minute' from listings where id = :'d'), 'Besitzer-Änderung stempelt edited_at');
set local session_replication_role = replica;
update listings set edited_at = now() - interval '2 years' where id = :'d';
set local session_replication_role = origin;
select tests.authenticate_as(:'o');
insert into listing_species (listing_id, species_code) values (:'d', 'roe_deer');
select tests.as_postgres();
select ok((select edited_at > now() - interval '1 minute' from listings where id = :'d'), 'Wildart (Kinder-Guard) stempelt edited_at');
update listings set edited_at = now() - interval '400 days' where id = :'d';
select ok((select edited_at < now() - interval '1 year' from listings where id = :'d'), 'Der Server darf edited_at setzen (Jobs, Tests)');
select hash1 from (select private.listing_content_hash(:'d') as hash1) x \gset
update listings set edited_at = now(), draft_notice_at = now() where id = :'d';
select is(private.listing_content_hash(:'d'), :'hash1'::bytea, 'edited_at und draft_notice_at nicht im Inhalts-Hash');
update listings set edited_at = now() - interval '400 days', draft_notice_at = null where id = :'d';

-- ---------------------------------------------------------------------------
-- 2. Verlassene Entwürfe
-- ---------------------------------------------------------------------------
-- d: 400 Tage ohne Bearbeitung → Hinweis; d2: 300 Tage → noch nichts; a: aktiv und alt → nie
insert into listings (owner_id, kind, direction, title, content_language, region_id) values (:'o', 'helper', 'offer', 'M9m frisch', 'de', :'dd')
returning id as d2 \gset
update listings set edited_at = now() - interval '300 days' where id = :'d2';
insert into listings (owner_id, kind, direction, title, content_language, region_id, status, expires_at, attributes)
values (:'o', 'helper', 'offer', 'M9m aktiv', 'de', :'dd', 'active', now() + interval '30 days', '{"tasks": ["Ansitz"]}') returning id as a \gset
update listings set edited_at = now() - interval '3 years' where id = :'a';
select is((private.run_trust_maintenance() ->> 'draft_notices')::int, 1, 'Genau ein Hinweis');
select ok((select draft_notice_at is not null from listings where id = :'d'), 'draft_notice_at gesetzt');
select ok((select draft_notice_at is null from listings where id = :'d2') and (select draft_notice_at is null from listings where id = :'a'),
  'Jüngere Entwürfe und aktive Anzeigen ohne Hinweis');
select ok((select (payload ->> 'deletes_at')::timestamptz > now() + interval '29 days' from private.account_notifications
           where kind = 'draft_expiry_notice' and ref_id = :'d'), 'Hinweis nennt das Löschdatum');
select is((private.run_trust_maintenance() ->> 'draft_notices')::int, 0, 'Kein zweiter Hinweis');
select is((select count(*)::int from listings where id = :'d'), 1, 'Vor Ablauf der 30 Tage nicht gelöscht');
select claim_account_notifications(:'secret') as claims \gset
select is((select e -> 'details' ->> 'listing_title' from jsonb_array_elements(:'claims'::jsonb) e where e ->> 'kind' = 'draft_expiry_notice'),
  'M9m Entwurf neu', 'Mail mit Titel');

-- Bearbeitung nach dem Hinweis setzt die Frist neu
update listings set draft_notice_at = now() - interval '31 days' where id = :'d';
select tests.authenticate_as(:'o');
update listings set description = 'Noch aktuell, bitte behalten.' where id = :'d';
select tests.as_postgres();
select is((private.run_trust_maintenance() ->> 'drafts_deleted')::int, 0, 'Bearbeitet nach dem Hinweis: nicht gelöscht');
-- Ohne Bearbeitung nach Hinweis + 30 Tagen: gelöscht
set local session_replication_role = replica;
update listings set edited_at = now() - interval '400 days', draft_notice_at = now() - interval '31 days' where id = :'d';
set local session_replication_role = origin;
insert into listing_photos (listing_id, sort_order) values (:'d', 0) returning storage_path as dphoto \gset
select is((private.run_trust_maintenance() ->> 'drafts_deleted')::int, 1, 'Nach Hinweis und 30 Tagen gelöscht');
select is((select count(*)::int from listings where id in (:'d', :'d2', :'a')), 2, 'Nur der verlassene Entwurf ist weg');
select is((select count(*)::int from listing_photos where listing_id = :'d'), 0, 'Fotozeilen per Kaskade weg');

-- ---------------------------------------------------------------------------
-- 3. Verifizierung: Anträge ohne Einreichung, Dokumente nach Frist, Dateien ohne Antrag
-- ---------------------------------------------------------------------------
select tests.authenticate_as(:'o');
select (begin_verification('jagdschein') ->> 'id') as v_unsub \gset
select tests.as_postgres();
set local session_replication_role = replica;
update verifications set created_at = now() - interval '25 hours' where id = :'v_unsub';
set local session_replication_role = origin;
-- Entschiedener Antrag mit Datei, 31 Tage alt
insert into verifications (user_id, document_type, document_path) values (:'o2', 'jagdkarte', :'o2' || '/alt') returning id as v_old \gset
select set_config('revier.verification', 'on', true);
update verifications set submitted_at = now() where id = :'v_old';
update verifications set status = 'rejected', reject_code = 'unreadable' where id = :'v_old';
select set_config('revier.verification', '', true);
set local session_replication_role = replica;
update verifications set decided_at = now() - interval '31 days' where id = :'v_old';
set local session_replication_role = origin;
insert into storage.objects (bucket_id, name, owner_id, created_at) values
  ('verification-docs', :'o2' || '/alt', :'o2', now() - interval '40 days'),
  ('verification-docs', :'o' || '/verwaist', :'o', now() - interval '25 hours'),
  ('verification-docs', :'o' || '/frisch', :'o', now() - interval '1 hour');

select is(tests.err($$ select * from maintenance_storage_objects('falsch') $$), '42501', 'Kandidaten nur mit Secret');
select is(
  array(select name || ':' || reason from maintenance_storage_objects(:'msecret') where bucket_id = 'verification-docs' order by reason),
  array[:'o2' || '/alt:verification_expired', :'o' || '/verwaist:verification_orphan'],
  'Abgelaufenes Dokument und Datei ohne Antrag, nicht die frische Datei');
select is((private.run_trust_maintenance() ->> 'unsubmitted')::int, 1, 'Antrag ohne Einreichung nach 24 h gelöscht');
select is((select count(*)::int from verifications where id = :'v_unsub'), 0, '… weg');
select is((select document_path from verifications where id = :'v_old'), :'o2' || '/alt', 'Pfad bleibt, solange die Datei liegt');
-- Die Function löscht über die Storage-API; hier simuliert
set local storage.allow_delete_query = 'true';
delete from storage.objects where bucket_id = 'verification-docs' and name = :'o2' || '/alt';
select is((private.run_trust_maintenance() ->> 'documents')::int, 1, 'Nach dem Löschen der Datei: Pfad entfernt');
select ok((select document_path is null and document_deleted_at is not null and status = 'rejected' from verifications where id = :'v_old'),
  'Metadaten bleiben');
select tests.authenticate_as(:'o2');
select is((select verification_status::text from profiles where user_id = :'o2'), 'rejected', 'Profilstatus unverändert');
select tests.as_postgres();

-- Entschiedene, junge Anträge und offene eingereichte bleiben
insert into verifications (user_id, document_type, document_path) values (:'o3', 'jagdschein', :'o3' || '/offen') returning id as v_open \gset
select set_config('revier.verification', 'on', true);
update verifications set submitted_at = now() where id = :'v_open';
select set_config('revier.verification', '', true);
insert into storage.objects (bucket_id, name, owner_id, created_at) values ('verification-docs', :'o3' || '/offen', :'o3', now() - interval '60 days');
select is((select count(*)::int from maintenance_storage_objects(:'msecret') where name = :'o3' || '/offen'), 0, 'Datei eines offenen Antrags bleibt');

-- ---------------------------------------------------------------------------
-- 4. Fristen der Warteschlange, Zähler, Beschwerden, Job
-- ---------------------------------------------------------------------------
select ok(exists (select 1 from cron.job where jobname = 'trust-maintenance'), 'Job trust-maintenance');
select ok(exists (select 1 from cron.job where jobname = 'trust-retention'), 'Job trust-retention');
select is(private.setting_int('draft_inactive_months'), 12, 'Frist Entwürfe 12 Monate (Platzhalter)');
select is(private.setting_int('draft_notice_days'), 30, 'Hinweis 30 Tage vorher (Platzhalter)');
select ok(not has_function_privilege('authenticated', 'private.run_trust_maintenance()', 'execute')
          and not has_function_privilege('service_role', 'private.run_trust_maintenance()', 'execute'), 'Job für keine API-Rolle');

select * from finish();
rollback;
