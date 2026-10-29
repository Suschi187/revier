-- M3 Commit 7 (Plan M3 2.8, Entscheidung 6, Auflage 12): Hinweis auf Waffen- und Munitionsbegriffe.
-- Beim Absenden zeigen Web und iOS einen deutlichen Hinweis mit den Fundstellen; Absenden bleibt möglich.
-- In M4 markiert derselbe Abgleich verdächtige Anzeigen für die Moderation.
-- Abgleich über alle 4 Sprachen, unabhängig von der Sprache der Anzeige: Titel, Beschreibung, Text-Attribute
-- und Alt-Texte der Fotos. PLZ und Ortsname sind nicht öffentlich und werden nicht geprüft.

create table private.content_terms (
  id smallint generated always as identity primary key,
  language public.language_code not null,
  category text not null check (category in ('weapon', 'ammunition')),
  term text not null,
  -- Regulärer Ausdruck (ARE, ohne Groß-/Kleinschreibung). Komposita wie „Jagdwaffe“ oder „Waffenschrank“
  -- treffen, „Waffel“ nicht.
  pattern text not null,
  unique (language, term)
);
alter table private.content_terms enable row level security;

insert into private.content_terms (language, category, term, pattern) values
  ('de', 'weapon', 'Waffe', 'waffen?\M|\mwaffen[[:alpha:]]+'),
  ('de', 'weapon', 'Gewehr', 'gewehre?\M|\mgewehr[[:alpha:]]+'),
  ('de', 'weapon', 'Büchse', 'b[uü]chsen?\M'),
  ('de', 'weapon', 'Flinte', 'flinten?\M'),
  ('de', 'weapon', 'Pistole', '\mpistolen?\M'),
  ('de', 'weapon', 'Revolver', '\mrevolver'),
  ('de', 'weapon', 'Repetierer', '\mrepetier'),
  ('de', 'weapon', 'Selbstlader', '\mselbstlader'),
  ('de', 'weapon', 'Schalldämpfer', 'schalld[aä]mpfer'),
  ('de', 'ammunition', 'Munition', 'munition'),
  ('de', 'ammunition', 'Patrone', 'patronen?\M|\mpatronen[[:alpha:]]+'),
  ('en', 'weapon', 'weapon', '\mweapons?\M'),
  ('en', 'weapon', 'gun', '\mguns?\M|\mshotguns?\M|\mhandguns?\M'),
  ('en', 'weapon', 'firearm', '\mfirearms?\M'),
  ('en', 'weapon', 'rifle', '\mrifles?\M'),
  ('en', 'weapon', 'pistol', '\mpistols?\M'),
  ('en', 'weapon', 'silencer', '\msilencers?\M|\msuppressors?\M'),
  ('en', 'ammunition', 'ammunition', '\mammunition\M|\mammo\M'),
  ('en', 'ammunition', 'cartridge', '\mcartridges?\M'),
  ('cs', 'weapon', 'zbraň', '\mzbra[nň]'),
  ('cs', 'weapon', 'puška', '\mpu[sš]k'),
  ('cs', 'weapon', 'kulovnice', '\mkulovnic'),
  ('cs', 'weapon', 'brokovnice', '\mbrokovnic'),
  ('cs', 'weapon', 'pistole', '\mpistol'),
  ('cs', 'weapon', 'tlumič', '\mtlumi[cč]'),
  ('cs', 'ammunition', 'střelivo', '\mst[rř]eliv'),
  ('cs', 'ammunition', 'náboj', '\mn[aá]boj'),
  ('pl', 'weapon', 'broń', '\mbro[nń]\M|\mbroni\M'),
  ('pl', 'weapon', 'sztucer', '\msztucer'),
  ('pl', 'weapon', 'strzelba', '\mstrzelb'),
  ('pl', 'weapon', 'karabin', '\mkarabin'),
  ('pl', 'weapon', 'pistolet', '\mpistolet'),
  ('pl', 'weapon', 'rewolwer', '\mrewolwer'),
  ('pl', 'weapon', 'tłumik', '\mt[lł]umik'),
  ('pl', 'ammunition', 'amunicja', '\mamunicj'),
  ('pl', 'ammunition', 'nabój', '\mnab[oó]j');

-- Fundstellen einer eigenen Anzeige: Feld und Begriff. Fremde und unbekannte Anzeigen ergeben dieselbe
-- (leere) Antwort. Liefert nie Werte aus listing_places.
create function public.listing_content_hints(p_listing_id uuid)
returns table (field text, term text, language public.language_code, category text)
language sql
stable
security definer
set search_path = ''
as $$
  with own as (
    select l.id, l.title, l.description, l.attributes from public.listings l
    where l.id = p_listing_id and l.owner_id = (select auth.uid())
  ),
  texts as (
    select 'title' as field, own.title as body from own
    union all select 'description', own.description from own
    union all select 'attributes.' || a.key, a.value #>> '{}' from own, jsonb_each(own.attributes) a
      where jsonb_typeof(a.value) = 'string'
    union all select 'attributes.' || a.key, e #>> '{}' from own, jsonb_each(own.attributes) a, jsonb_array_elements(a.value) e
      where jsonb_typeof(a.value) = 'array' and jsonb_typeof(e) = 'string'
    union all select 'photos.alt_text', p.alt_text from own join public.listing_photos p on p.listing_id = own.id
      where p.alt_text is not null
  )
  select distinct t.field, c.term, c.language, c.category
  from texts t join private.content_terms c on t.body ~* c.pattern
  order by 1, 3, 2;
$$;
revoke execute on function public.listing_content_hints(uuid) from public, anon;
grant execute on function public.listing_content_hints(uuid) to authenticated;
