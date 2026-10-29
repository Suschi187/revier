-- Seed-Daten (game_species, regions) folgen in M1.

-- Nur lokal (db reset / start, nie in der Cloud): API- und E2E-Tests legen je Lauf viele Anzeigen mit
-- frischen Konten an. Das Rate-Limit (3 bzw. 10 in 24 h, Migration listing_rules) prüft pgTAP mit
-- ausdrücklich gesetzten Werten (17_listing_rules).
update private.app_settings set value = '1000'
where key in ('listing_create_daily_limit_new', 'listing_create_daily_limit');
