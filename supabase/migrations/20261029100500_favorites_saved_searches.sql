-- M1 Favoriten und Suchaufträge (SPEC 3.1). Beides ist ausschließlich für den Besitzer sichtbar.

create table public.favorites (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  user_id uuid not null default auth.uid() references public.profiles (user_id) on delete cascade,
  listing_id uuid not null references public.listings (id) on delete cascade,
  unique (user_id, listing_id)
);
create index favorites_listing_idx on public.favorites (listing_id);

alter table public.favorites enable row level security;

create policy favorites_select_own on public.favorites
  for select to authenticated
  using (user_id = (select auth.uid()));

-- Nur sichtbare Anzeigen (RLS der listings greift im Subselect), sonst ließe sich die Existenz
-- fremder Entwürfe ausprobieren.
create policy favorites_insert_own on public.favorites
  for insert to authenticated
  with check (user_id = (select auth.uid()) and exists (select 1 from public.listings l where l.id = listing_id));

create policy favorites_delete_own on public.favorites
  for delete to authenticated
  using (user_id = (select auth.uid()));

grant select, delete on public.favorites to authenticated;
grant insert (listing_id) on public.favorites to authenticated;

-- notify_email ergänzt SPEC 3.1: Das Web benachrichtigt per E-Mail (SPEC 2, M8), iOS per Push.
create table public.saved_searches (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  user_id uuid not null default auth.uid() references public.profiles (user_id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 100),
  filters jsonb not null default '{}'::jsonb
    check (jsonb_typeof(filters) = 'object' and pg_column_size(filters) <= 4096),
  notify_push boolean not null default false,
  notify_email boolean not null default true,
  last_notified_at timestamptz
);
create index saved_searches_user_idx on public.saved_searches (user_id);

alter table public.saved_searches enable row level security;

create policy saved_searches_own on public.saved_searches
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

grant select, delete on public.saved_searches to authenticated;
grant insert (name, filters, notify_push, notify_email) on public.saved_searches to authenticated;
grant update (name, filters, notify_push, notify_email) on public.saved_searches to authenticated;

-- Jeder Suchauftrag wird bei jeder Freigabe geprüft (M8), daher begrenzt.
create function private.saved_searches_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select count(*) from public.saved_searches where user_id = new.user_id) >= 25 then
    raise exception 'Höchstens 25 Suchaufträge pro Konto' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke execute on function private.saved_searches_limit() from public, anon, authenticated;

create trigger saved_searches_limit
  before insert on public.saved_searches
  for each row execute function private.saved_searches_limit();
