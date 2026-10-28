# ADR 003: i18n-Routing

Status: angenommen (M0)

## Kontext
Vier Sprachen (de, en, cs, pl), fünf Märkte, vier Währungen. SEO verlangt ein Sprachpräfix, `hreflang` und Canonicals.

## Entscheidung
- next-intl. Das Sprachpräfix steht **immer** in der URL (`/de/...`, `/en/...`, `/cs/...`, `/pl/...`).
- Default-Locale `de`. `/` leitet auf `/de` um. Wenn es keine Locale-Angabe gibt, wird die Sprache über `Accept-Language` erkannt.
- en ist die Quelle der Message-Dateien. Ein Test stellt sicher, dass alle Sprachen dieselben Keys haben.
- **Sprache, Land/Markt und Währung sind unabhängig voneinander.** Ein Nutzer mit `cs` kann Anzeigen in AT mit Preisen in EUR sehen. Preise werden immer in der Originalwährung angezeigt und mit der UI-Locale formatiert.

## Alternativen
- Domain pro Land: zu viel Aufwand für das MVP.
- Default-Locale ohne Präfix: schlechter für eine konsistente `hreflang`-Struktur.

## Folgen
Kategorie- und Regionsslugs (M5) werden pro Sprache lokalisiert. Das wird dort entschieden.
