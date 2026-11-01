-- M6 Commit 2 (ADR 016, Review B1 a): Fläche je Region als Zahl, ohne Polygone (ADR 007). Die Werte setzt die
-- generierte Migration regions_area_data; danach Pflicht (map_point).
alter table public.regions add column area_km2 numeric(9, 1) check (area_km2 > 0);
