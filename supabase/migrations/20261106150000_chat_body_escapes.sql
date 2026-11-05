-- M7: private.chat_body_valid ohne unsichtbare Zeichen im Quelltext. Die Fassung aus 20261106100000 enthielt die
-- Bidi-Steuerzeichen U+202A–U+202E und U+2066–U+2069 wörtlich in der Regex (gleiche Wirkung, aber im Quelltext
-- unsichtbar, „Trojan Source“). Jetzt als Escapes; Verhalten unverändert (Fixture chat_rules.json).
create or replace function private.chat_body_valid(p_body text)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select p_body is not null
    and char_length(p_body) between 1 and 2000
    and p_body = private.trim_all(p_body)
    and p_body !~ '[\x01-\x08\x0B-\x1F\x7F-\x9F\u202A-\u202E\u2066-\u2069]';
$$;
