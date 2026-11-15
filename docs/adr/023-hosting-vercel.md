# ADR 023: Hosting der Web-App auf Vercel

Status: angenommen (M10, Entscheidung des Menschen 2026-11-15; ersetzt den kurzzeitigen Plan „EU-Server mit Docker“, Commit bc3b6f7)

## Kontext
SPEC 7.9 verlangt einen Anbieter mit EU-Region und AVV. Die Web-App ist Next.js 16 mit `cacheComponents`, Proxy und Route Handlern. Die Kartendatei (ADR 016) ist über 1 GB groß und wird in Byte-Bereichen von der eigenen Origin geladen.

## Entscheidung
- **Vercel**, Funktionen in **fra1** (`web/vercel.json`), Projekt-Wurzel `web/`. Domain `huntery.de` (Hauptdomain), `www` leitet um.
- **Kartendatei in Supabase Storage** (Frankfurt, öffentlicher Bucket `tiles`, Cache-Control ein Jahr). Vercel schreibt `/tiles/<name>.pmtiles` per Rewrite (`beforeFiles`) auf `MAP_TILES_ORIGIN` um (`web/lib/map/tiles-rewrite.ts`). Die Karte bleibt auf der eigenen Origin, CSP unverändert.
- Ein Build je Umgebung (Preview/Stage, Production), weil `NEXT_PUBLIC_*`, CSP und Rewrites beim Build feststehen.
- Vercel Analytics, Speed Insights und Toolbar bleiben aus (keine Drittanfragen ohne Einwilligung, ADR 021/022).
- Fehler-Monitoring mit Sentry (EU-Datenregion), eigener Schritt.

## Alternativen
- EU-Server mit Docker und Caddy: volle Kontrolle über Logs und Kartendatei, aber eigener Betrieb (Updates, TLS, Ausfälle). Verworfen zugunsten des geringeren Betriebsaufwands; Stand in Commit bc3b6f7.
- Kartendatei im Vercel-Deployment: zu groß.

## Folgen
- Vercel ist ein US-Unternehmen: AVV mit Standardvertragsklauseln; Datenschutzerklärung nennt Vercel, Region und Log-Fristen (Anwalt, SPEC 7.2).
- Logs: Laufzeit-Logs bei Vercel nur kurz aufbewahrt (planabhängig); keine eigenen Zugriffslogs mit Tokens oder Byte-Bereichen (ADR 016, 018). Für die Kartendatei gelten die Logs von Supabase Storage (Frist laut Plan) – im Release prüfen.
- Rewrite auf Storage muss Range und `206` durchreichen; Nachweis gegen Stage (WEB-RELEASE C). Scheitert das, wird die Kartendatei über eine eigene Subdomain mit CORS ausgeliefert und die CSP erweitert (neues ADR).
- Supabase Storage braucht für eine Datei über 50 MB einen Plan mit höherer Dateigrenze und Upload per TUS.
- Rate-Limit über die Vercel-Firewall (Regeln für Suche, Foto-Route, `/api/map`, `/tiles/`).
