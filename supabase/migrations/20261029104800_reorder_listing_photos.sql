-- M3 Commit 12 (Plan M3 7, Fotos per Tastatur umsortieren): Reihenfolge der Fotos in einem Schritt.
-- (listing_id, sort_order) ist eindeutig und nur innerhalb einer Transaktion zurückstellbar; über PostgREST
-- lässt sich ein Tausch deshalb nicht in Einzel-Updates ausdrücken. Security invoker: RLS, Kinder-Guard
-- (zurück in die Prüfung, Legal-Gate) und Spaltenrechte gelten wie bei einem direkten Update.
create function public.reorder_listing_photos(p_listing_id uuid, p_photo_ids uuid[])
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not private.owns_editable_listing(p_listing_id) then
    raise exception 'Anzeige nicht gefunden' using errcode = '42501';
  end if;
  -- Genau alle Fotos der Anzeige, jedes einmal
  if cardinality(p_photo_ids) is distinct from (select count(*) from public.listing_photos where listing_id = p_listing_id)
     or cardinality(p_photo_ids) <> (select count(distinct x) from unnest(p_photo_ids) x)
     or exists (select 1 from unnest(p_photo_ids) x
                where not exists (select 1 from public.listing_photos p where p.id = x and p.listing_id = p_listing_id)) then
    raise exception 'Fotoliste passt nicht zur Anzeige' using errcode = '22023';
  end if;
  set constraints public.listing_photos_listing_id_sort_order_key deferred;
  update public.listing_photos p set sort_order = o.position - 1
  from unnest(p_photo_ids) with ordinality as o (id, position)
  where p.id = o.id and p.sort_order is distinct from o.position - 1;
  set constraints public.listing_photos_listing_id_sort_order_key immediate;
end;
$$;
revoke execute on function public.reorder_listing_photos(uuid, uuid[]) from public, anon;
grant execute on function public.reorder_listing_photos(uuid, uuid[]) to authenticated;
