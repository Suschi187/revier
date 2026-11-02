-- M6 Commit 6 (ADR 016): Mittelpunkt und Fläche je Region als Zahlen für den Startausschnitt der Karte. Öffentliche
-- Referenzdaten (wie regions), nur ohne Umweg über das Geo-Format von PostgREST.
create function public.region_geo()
returns table (code text, lng double precision, lat double precision, area_km2 numeric)
language sql
stable
set search_path = ''
as $$
  select r.code, extensions.st_x(r.centroid::extensions.geometry), extensions.st_y(r.centroid::extensions.geometry), r.area_km2
  from public.regions r;
$$;
revoke execute on function public.region_geo() from public;
grant execute on function public.region_geo() to anon, authenticated, service_role;
