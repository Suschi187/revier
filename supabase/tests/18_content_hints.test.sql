begin;
\ir _helpers.psql
select plan(12);

-- Hinweis auf Waffen- und Munitionsbegriffe (Plan M3 2.8, Entscheidung 6, Auflage 12).
select tests.create_user('owner@test.local') as a_id \gset
select tests.create_user('fremd@test.local') as b_id \gset
select id as district from regions where code = 'DE-09162' \gset

select tests.authenticate_as(:'a_id');
insert into listings (kind, direction, title, description, content_language, region_id, attributes)
values ('trophy_hunt', 'offer', 'Gastjagd mit Leihwaffe', 'Wir stellen Munition und einen Repetierer, die Waffel gibt es dazu.',
  'de', :'district', '{"trophy_details": "Rifle and ammo provided", "legal_ack": true}') returning id as l \gset
insert into listings (kind, direction, title, description, content_language, region_id)
values ('helper', 'offer', 'Helfer für den Hochsitzbau', 'Wir bauen im Frühjahr zwei Hochsitze, Werkzeug ist vorhanden.', 'de', :'district')
returning id as clean \gset
insert into listing_photos (listing_id, sort_order, alt_text) values (:'clean', 0, 'Sprzedam broń i amunicja');

select set_eq(format($$ select field || ':' || term from listing_content_hints(%L) $$, :'l'),
  array['title:Waffe', 'description:Munition', 'description:Repetierer', 'attributes.trophy_details:rifle', 'attributes.trophy_details:ammunition'],
  'Fundstellen in Titel, Beschreibung und Attributen, über Sprachen hinweg; „Waffel“ trifft nicht');
select set_eq(format($$ select field || ':' || term || ':' || language from listing_content_hints(%L) $$, :'clean'),
  array['photos.alt_text:broń:pl', 'photos.alt_text:amunicja:pl'], 'Alt-Texte werden geprüft (Polnisch)');

-- Begriffe in allen 4 Sprachen, Groß- und Kleinschreibung, Komposita
update listings set title = 'Prodám ZBRAŇ a střelivo', description = 'Langwaffen, Waffenschrank und NABÓJ, dazu ein Shotgun und Tłumik.'
where id = :'clean';
select set_eq(format($$ select term from listing_content_hints(%L) where field in ('title', 'description') $$, :'clean'),
  array['zbraň', 'střelivo', 'Waffe', 'nabój', 'gun', 'tłumik'], 'cs, de, en, pl, Großbuchstaben und Komposita');

-- Keine Treffer in harmlosen Texten
update listings set title = 'Gunnar sucht Hochsitzbauer', description = 'Das Waffeleisen ist kein Thema, Kaliber egal, Gewehrkugel nein.'
where id = :'clean';
select is((select count(*)::int from listing_content_hints(:'clean') where field = 'title'), 0, 'Namen wie „Gunnar“ treffen nicht');
select set_eq(format($$ select term from listing_content_hints(%L) where field = 'description' $$, :'clean'),
  array['Gewehr'], 'Komposita mit Gewehr- treffen, „Waffeleisen“ nicht');

-- Fremde und unbekannte Anzeigen: dieselbe leere Antwort
select tests.authenticate_as(:'b_id');
select is((select count(*)::int from listing_content_hints(:'l')), 0, 'Fremde Anzeige: keine Fundstellen');
select is((select count(*)::int from listing_content_hints(gen_random_uuid())), 0, 'Unbekannte Anzeige: keine Fundstellen');

-- PLZ und Ort werden nicht geprüft und nie geliefert
select tests.authenticate_as(:'a_id');
select set_listing_location(:'clean', :'district', '80331', 'Waffenhausen');
select is((select count(*)::int from listing_content_hints(:'clean') where field like 'place%'), 0, 'Ortsname wird nicht ausgewertet');

-- Rechte
select tests.as_postgres();
select ok(not has_function_privilege('anon', 'public.listing_content_hints(uuid)', 'execute'), 'anon ruft die RPC nicht auf');
select ok(not has_table_privilege('authenticated', 'private.content_terms', 'select')
  and not has_table_privilege('anon', 'private.content_terms', 'select'), 'Begriffsliste ist für API-Rollen nicht lesbar');
select is((select count(distinct language)::int from private.content_terms), 4, 'Begriffe in allen 4 Sprachen');
select is((select count(*)::int from private.content_terms where 'probe' ~* pattern), 0, 'Alle Muster sind gültige reguläre Ausdrücke');

select * from finish();
rollback;
