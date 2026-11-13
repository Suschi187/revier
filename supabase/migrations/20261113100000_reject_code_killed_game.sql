-- M10a Schritt 6 (Entscheidung 2026-11-13): Fotos von erlegtem Wild sind nicht erlaubt. Admins lehnen solche Anzeigen
-- mit eigenem Grund ab, damit der Besitzer weiß, was zu ändern ist. Neuer Code `killed_game` für listings.reject_code
-- und für resolve_reports (Entfernen nach Meldung). Liste wie in web/lib/moderation.ts (moderation.test.ts vergleicht).

alter table public.listings drop constraint listings_reject_code_check;
alter table public.listings
  add constraint listings_reject_code_check check (reject_code in ('incomplete', 'wrong_category', 'weapons', 'prohibited_content',
                                                                   'duplicate', 'contact_in_text', 'implausible', 'killed_game', 'other'));

-- resolve_reports (Migration qa_m9b_fixes) prüft die Codes selbst. Nur diese Liste ändern, statt die ganze Funktion zu
-- kopieren; greift die Ersetzung nicht, bricht die Migration ab. create or replace behält Rechte und Eigentümer.
do $$
declare
  def text;
  changed text;
begin
  def := pg_get_functiondef('public.resolve_reports(report_target, uuid, text, text, text, text)'::regprocedure);
  changed := replace(def, '''contact_in_text'', ''implausible'', ''other''', '''contact_in_text'', ''implausible'', ''killed_game'', ''other''');
  if changed = def then
    raise exception 'resolve_reports: Code-Liste nicht gefunden';
  end if;
  execute changed;
end;
$$;
