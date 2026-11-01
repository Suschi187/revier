# ADR 003: i18n-Routing

Status: angenommen (M0)

## Kontext
Vier Sprachen (de, en, cs, pl), fünf Märkte, vier Währungen. SEO verlangt ein Sprachpräfix, `hreflang` und Canonicals.

## Entscheidung
- next-intl. Das Sprachpräfix steht **immer** in der URL (`/de/...`, `/en/...`, `/cs/...`, `/pl/...`).
- Default-Locale `de`. `/` leitet auf `/de` um. Wenn es keine Locale-Angabe gibt, wird die Sprache über `Accept-Language` erkannt.
- en ist die Quelle der Message-Dateien. Ein Test stellt sicher, dass alle Sprachen dieselben Keys haben.
- **Sprache, Land/Markt und Währung sind unabhängig voneinander.** Ein Nutzer mit `cs` kann Anzeigen in AT mit Preisen in EUR sehen. Preise werden immer in der Originalwährung angezeigt und mit der UI-Locale formatiert.

- Der Proxy (`web/proxy.ts`) läuft für alle Pfade außer Next-Interna, `/api/`, `/static/` und den Metadaten-Dateien im Root (favicon, robots, sitemap, manifest). Öffentliche Dateien liegen deshalb unter `web/public/static/`.
- 404: `app/global-not-found.tsx` ist statisch und mehrsprachig, ein Abschnitt je Sprache mit eigenem `lang`, und gilt für alle unbekannten Pfade. `app/[locale]/not-found.tsx` ist die lokalisierte 404 für explizite `notFound()`-Aufrufe in Seiten. Grund: Unter `cacheComponents` liefert ein prerenderter Catch-all nur eine leere Fehler-Hülle (QA M0 F2).

## Alternativen
- Domain pro Land: zu viel Aufwand für das MVP.
- Default-Locale ohne Präfix: schlechter für eine konsistente `hreflang`-Struktur.

## Folgen
Kategorie- und Regionsslugs (M5): URL-Wörter je Sprache, Regions-Slugs sprachunabhängig, ein Pfad-Parser für Proxy, Seiten, Sprachumschalter, hreflang und Sitemap (ADR 015). Der Proxy läuft seit QA M5 N1 auf allen Pfaden außer `_next/` und reicht Sitemaps, `robots.txt`, `/api/`, `/static/` und Metadaten-Dateien ohne Sprachrouting durch.
