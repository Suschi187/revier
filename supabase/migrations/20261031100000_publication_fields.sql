-- M5 Commit 2 (Plan M5, ADR 015): Veröffentlichungszeitpunkte, eindeutige Regions-Slugs für die URLs,
-- Limit für Favoriten.

alter table public.listings
  add column published_at timestamptz,
  add column approved_at timestamptz;

-- Bestand: Anzeigen mit Ablaufdatum waren einmal freigegeben (auch pausierte, abgelaufene, entfernte), sonst
-- ergäben sie nach außen 404 statt „nicht mehr verfügbar“.
update public.listings
set published_at = expires_at - make_interval(days => private.setting_int('listing_active_days')),
    approved_at = expires_at - make_interval(days => private.setting_int('listing_active_days'))
where expires_at is not null and status in ('active', 'paused', 'expired', 'removed');

alter table public.listings
  add constraint listings_active_published check (status <> 'active' or published_at is not null),
  add constraint listings_approved_after_published check (approved_at is null or (published_at is not null and approved_at >= published_at));

-- „neueste“ (ADR 015): Keyset über (published_at desc, id desc).
create index listings_published_idx on public.listings (published_at desc, id desc) where status = 'active';

-- Auf allen Pfaden (auch Server und Definer, die der Guard überspringt). Freigabe ist jeder Wechsel nach
-- `active` außer dem Fortsetzen einer pausierten Anzeige. published_at bleibt nach der ersten Freigabe fest,
-- damit bearbeitete Anzeigen nicht wieder als „neu“ erscheinen (M8 meldet nur neue). Läuft nach
-- listings_zz_moderation_fields (alphabetisch).
create function private.listings_publication_fields()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    new.published_at := old.published_at;
    new.approved_at := old.approved_at;
  else
    new.published_at := null;
    new.approved_at := null;
  end if;
  if new.status = 'active' and (tg_op = 'INSERT' or old.status not in ('active', 'paused')) then
    new.approved_at := now();
    new.published_at := coalesce(new.published_at, now());
  end if;
  return new;
end;
$$;
revoke execute on function private.listings_publication_fields() from public, anon, authenticated;

create trigger listings_zz_publication_fields
  before insert or update on public.listings
  for each row execute function private.listings_publication_fields();

-- Inhalts-Hash ohne die neuen Verwaltungsspalten, sonst wären pausierte Anzeigen nicht mehr fortsetzbar.
create or replace function private.listing_content_hash(p_listing_id uuid)
returns bytea
language sql
stable
security definer
set search_path = ''
as $$
  select extensions.digest(jsonb_build_object(
    'listing', (select to_jsonb(l) - array['id', 'created_at', 'owner_id', 'country', 'status', 'reject_reason', 'reject_code', 'submitted_at',
                                          'published_at', 'approved_at', 'expires_at', 'search_vector', 'postal_prefix']
                from public.listings l where l.id = p_listing_id),
    'species', (select coalesce(jsonb_agg(s.species_code order by s.species_code), '[]'::jsonb)
                from public.listing_species s where s.listing_id = p_listing_id),
    'photos', (select coalesce(jsonb_agg(jsonb_build_array(p.id, p.sort_order, p.alt_text, p.processed_at)
                                         order by p.sort_order, p.id), '[]'::jsonb)
               from public.listing_photos p where p.listing_id = p_listing_id),
    'place', (select jsonb_build_array(pl.postal_code, pl.place_name)
              from public.listing_places pl where pl.listing_id = p_listing_id)
  )::text, 'sha256');
$$;

-- URLs (ADR 015): /{kind}/{state}/{district}. Bundesland-Slugs über alle Länder eindeutig, Kreis-Slugs je Land.
create unique index regions_state_slug_key on public.regions (slug) where level = 'state';
create unique index regions_district_parent_slug_key on public.regions (parent_id, slug) where level = 'district';

-- Favoriten: höchstens 500 je Konto; serialisiert je Nutzer, damit parallele Inserts das Limit nicht umgehen.
insert into private.app_settings (key, value, description) values
  ('favorites_max', '500', 'Höchstzahl Favoriten je Konto (ADR 015)');

create function private.favorites_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtext('favorites'), hashtext(new.user_id::text));
  if (select count(*) from public.favorites where user_id = new.user_id) >= private.setting_int('favorites_max') then
    raise exception 'Höchstens % Favoriten pro Konto', private.setting_int('favorites_max')
      using errcode = '23514', hint = '{"reason":"favorites_limit"}';
  end if;
  return new;
end;
$$;
revoke execute on function private.favorites_limit() from public, anon, authenticated;

create trigger favorites_limit
  before insert on public.favorites
  for each row execute function private.favorites_limit();
