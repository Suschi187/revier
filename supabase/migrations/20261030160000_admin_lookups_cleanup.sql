-- QA M4 F5: Kontosuchen (Rate-Limit) verschwinden mit dem Konto und nach Ablauf des Fensters.
-- Die Zeilen enthalten nur Akteur und Zeitpunkt; gebraucht wird höchstens die letzte Stunde.

delete from private.admin_lookups l where not exists (select 1 from auth.users u where u.id = l.actor_id);
alter table private.admin_lookups
  add constraint admin_lookups_actor_id_fkey foreign key (actor_id) references auth.users (id) on delete cascade;

-- Bei jeder neuen Suche alte Zeilen aller Admins entfernen (kleine Tabelle, kein Cron nötig).
create function private.admin_lookups_prune()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from private.admin_lookups where created_at < now() - interval '1 hour';
  return null;
end;
$$;
revoke execute on function private.admin_lookups_prune() from public, anon, authenticated;

create trigger admin_lookups_prune
after insert on private.admin_lookups
for each statement execute function private.admin_lookups_prune();
