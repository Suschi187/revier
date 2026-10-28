-- M1 Referenzdaten: Regionen und Wildarten (SPEC 3.1, docs/adr/007-regionendaten.md).
-- Die Regionsdaten selbst lädt die generierte Migration 20261029100300_regions_data.sql.

create table public.regions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  country public.country_code not null,
  level public.region_level not null,
  parent_id uuid references public.regions (id) on delete restrict,
  code text not null unique check (code ~ '^[A-Z]{2}-[0-9A-Z]{1,5}$'),
  slug text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name_de text not null,
  name_en text not null,
  name_cs text not null,
  name_pl text not null,
  centroid extensions.geography(point, 4326) not null,
  unique (country, level, slug),
  constraint parent_matches_level check (
    (level = 'state' and parent_id is null) or (level = 'district' and parent_id is not null)
  )
);

create index regions_parent_idx on public.regions (parent_id);
create index regions_country_level_idx on public.regions (country, level);

alter table public.regions enable row level security;

create policy regions_select_all on public.regions
  for select to anon, authenticated
  using (true);

grant select on public.regions to anon, authenticated;

create table public.game_species (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  code text not null unique check (code ~ '^[a-z][a-z_]*$'),
  name_de text not null,
  name_en text not null,
  name_cs text not null,
  name_pl text not null
);

alter table public.game_species enable row level security;

create policy game_species_select_all on public.game_species
  for select to anon, authenticated
  using (true);

grant select on public.game_species to anon, authenticated;

-- cs/pl-Namen sind ungeprüft, bis Muttersprachler sie freigeben (SPEC 7.6, docs/GLOSSARY.md).
insert into public.game_species (code, name_de, name_en, name_cs, name_pl) values
  ('roe_deer',    'Rehwild',      'Roe deer',        'Srnčí zvěř',          'Sarna'),
  ('red_deer',    'Rotwild',      'Red deer',        'Jelení zvěř',         'Jeleń szlachetny'),
  ('fallow_deer', 'Damwild',      'Fallow deer',     'Dančí zvěř',          'Daniel'),
  ('sika_deer',   'Sikawild',     'Sika deer',       'Jelen sika',          'Jeleń sika'),
  ('wild_boar',   'Schwarzwild',  'Wild boar',       'Černá zvěř',          'Dzik'),
  ('chamois',     'Gamswild',     'Chamois',         'Kamzičí zvěř',        'Kozica'),
  ('ibex',        'Steinwild',    'Alpine ibex',     'Kozorožec horský',    'Koziorożec alpejski'),
  ('mouflon',     'Muffelwild',   'Mouflon',         'Mufloní zvěř',        'Muflon'),
  ('hare',        'Feldhase',     'Brown hare',      'Zajíc polní',         'Zając szarak'),
  ('fox',         'Fuchs',        'Red fox',         'Liška obecná',        'Lis'),
  ('pheasant',    'Fasan',        'Pheasant',        'Bažant obecný',       'Bażant'),
  ('partridge',   'Rebhuhn',      'Grey partridge',  'Koroptev polní',      'Kuropatwa'),
  ('waterfowl',   'Wasserwild',   'Waterfowl',       'Vodní pernatá zvěř',  'Ptactwo wodne'),
  ('small_game',  'Sonstiges Niederwild', 'Other small game', 'Ostatní drobná zvěř', 'Inna drobna zwierzyna');
