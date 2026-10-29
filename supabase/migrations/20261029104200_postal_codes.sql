-- M3 (ADR 012, Plan M3 6.1): Postleitzahlen als Referenzdaten für die Prüfung „PLZ passt zum Kreis“.
-- Öffentlich lesbar (kein Personenbezug), schreibbar nur per Migration. Die PLZ einer Anzeige liegt
-- getrennt in listing_places (Plan M3 Commit 5b) und ist nie öffentlich.
-- Zusammengesetzte Schlüssel statt `id` wie bei listing_species (SPEC 3.1).

create table public.postal_codes (
  country public.country_code not null,
  code text not null,
  primary key (country, code),
  constraint postal_code_format check (
    (country = 'DE' and code ~ '^\d{5}$') or (country = 'AT' and code ~ '^\d{4}$')
  )
);

create table public.postal_code_regions (
  country public.country_code not null,
  code text not null,
  region_id uuid not null references public.regions (id) on delete restrict,
  primary key (country, code, region_id),
  foreign key (country, code) references public.postal_codes (country, code) on delete cascade
);
create index postal_code_regions_region_idx on public.postal_code_regions (region_id);

create table public.postal_code_places (
  country public.country_code not null,
  code text not null,
  place_name text not null check (char_length(place_name) between 1 and 100),
  primary key (country, code, place_name),
  foreign key (country, code) references public.postal_codes (country, code) on delete cascade
);

alter table public.postal_codes enable row level security;
alter table public.postal_code_regions enable row level security;
alter table public.postal_code_places enable row level security;

create policy postal_codes_select_all on public.postal_codes for select to anon, authenticated using (true);
create policy postal_code_regions_select_all on public.postal_code_regions for select to anon, authenticated using (true);
create policy postal_code_places_select_all on public.postal_code_places for select to anon, authenticated using (true);

grant select on public.postal_codes, public.postal_code_regions, public.postal_code_places to anon, authenticated;
