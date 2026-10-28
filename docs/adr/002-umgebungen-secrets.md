# ADR 002: Umgebungen und Secrets

Status: angenommen (M0)

## Kontext
Die SPEC nennt dev/prod. Die Architektur sieht dev/stage/prod vor. Das Hosting (SPEC 7.9) ist noch offen.

## Entscheidung
- **M0:** nur lokal (`supabase start`). Es gibt noch kein Cloud-Projekt.
- **Ab M2:** ein Supabase-Cloud-Projekt in der EU (Frankfurt). Stage kommt spätestens in M10 dazu.
- Env-Variablen im Web:
  - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` – öffentlich
  - `SUPABASE_SERVICE_ROLE_KEY` – nur serverseitig, nie mit `NEXT_PUBLIC_`-Präfix. Wird in M0 nicht verwendet.
- Die Env wird beim Start mit Zod validiert (`web/lib/env.ts`). Das Server-Modul importiert `server-only`.
- Ins Repo kommt nur `.env.example`. Echte Werte liegen in `.env.local` (ignoriert).
- iOS ab I1: committetes `Config.xcconfig` bindet ein ignoriertes `Secrets.xcconfig` ein, als Vorlage dient `Secrets.example.xcconfig`. Die App bekommt nur den anon-Key.
- CI läuft ohne Secrets. Ein Guard bricht ab, wenn `NEXT_PUBLIC_*SERVICE*` im Code auftaucht.

## Alternativen
Das Cloud-Projekt schon in M0 anzulegen ist für das M0-Kriterium nicht nötig und würde Konto-/AVV-Fragen vorziehen.

## Folgen
Vor M2 müssen Konto-Eigentümer (privat oder Firma) und Redirect-URLs geklärt sein.
