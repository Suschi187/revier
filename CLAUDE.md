# CLAUDE.md – Revier (Arbeitstitel)

Kleinanzeigen-Plattform für Jagdgelegenheiten (Jagdpacht, Begehungsscheine, Gesellschaftsjagden, Trophäen-/Gastjagden; jeweils Angebot oder Gesuch).
Märkte: DE, AT, CH, CZ, PL. Sprachen: de, en, cs, pl. Währungen: EUR, CHF, CZK, PLN.
Plattformen: **Web-App** (vollwertig, öffentlich, SEO-fähig) und **iOS-App** (App Store). **Kein Android, keine anderen Plattformen.**
Beide Clients nutzen dasselbe Supabase-Backend. Die vollständige Spezifikation steht in `docs/SPEC.md`. Lies sie vor jeder größeren Aufgabe.

## Stack
- Web-App: Next.js (App Router) mit TypeScript, Tailwind CSS, `next-intl` (de/en/cs/pl), `@supabase/ssr`. Öffentliche Seiten serverseitig gerendert (SEO). Admin-Bereich unter `/admin` in derselben App.
- iOS: Swift 5.9+, SwiftUI, iOS 17+, Swift Package Manager, `supabase-swift`
- Backend: Supabase (Postgres, Auth, Storage, Realtime, Edge Functions), Region EU (Frankfurt)
- Lokalisierung: String Catalogs (`Localizable.xcstrings`) in iOS, Message-Dateien (`web/messages/{de,en,cs,pl}.json`) im Web; nie Strings hartcodieren

## Repo-Struktur
- `web/` Web-App inkl. Admin-Bereich
- `ios/` iOS-App
- `supabase/` Migrationen, Seeds, Edge Functions
- `docs/` Spezifikation, ADRs, Changelog, Glossar, QA-Berichte
- Web und iOS teilen **keinen Code**, nur das Backend-Schema. Fachbegriffe stehen in `docs/GLOSSARY.md` und müssen auf beiden Plattformen gleich übersetzt sein.

## Arbeitsweise
1. Arbeite immer nur an **einem Backlog-Schritt** aus `docs/SPEC.md` (Abschnitt 6). Nicht vorgreifen.
2. Vor dem Coden: kurzer Plan (welche Dateien, welche Tabellen). Bei Unklarheit fragen statt raten.
3. Nach jedem Schritt: Build muss grün sein, Tests laufen, Akzeptanzkriterien des Schritts einzeln abhaken.
4. Kleine Commits, ein Commit pro logischer Änderung, klare Messages.
5. Keine neuen Abhängigkeiten ohne kurze Begründung.

## Verbindliche Regeln
- **Sicherheit:** Jede Tabelle hat Row Level Security. Keine Tabelle ohne Policy. Policies werden mit Tests abgesichert (ein User darf nie fremde Daten lesen oder ändern).
- **Secrets:** Keine Schlüssel im Repo. `.env` und Xcode-Config-Dateien mit Secrets sind in `.gitignore`. In Web-Client und iOS-App nur der öffentliche `anon`-Key. Der `service_role`-Key existiert nur in Edge Functions und serverseitigem Web-Code, nie mit `NEXT_PUBLIC_` Präfix und nie im Browser-Bundle.
- **Sensible Daten:** Jagdschein-Uploads liegen in einem privaten Bucket, nur für den Besitzer und Admins lesbar.
- **Standorte:** Exakte Revierkoordinaten werden nie öffentlich gespeichert oder angezeigt. Anzeigen verwenden nur Region/Landkreis oder einen verfremdeten Punkt (siehe SPEC 3.3).
- **Geld:** Preise als ganze Zahl in der kleinsten Einheit (`price_minor`) plus `currency`. Nie Gleitkomma. Keine automatische Umrechnung, die den Originalpreis ersetzt.
- **UGC (App-Store-Pflicht und DSA):** Melden, Blockieren, Account-Löschung und Zustimmung zu den Nutzungsbedingungen müssen in **Web und iOS** vorhanden bleiben. Nicht entfernen oder umgehen.
- **Web-Datenschutz:** Cookie-/Consent-Banner, bevor nicht notwendige Cookies oder Tracker laufen. Standardmäßig kein Tracking. Impressum und Datenschutz sind von jeder Seite erreichbar.
- **Öffentliche Webseiten:** Anzeigen-Detailseiten sind öffentlich lesbar (SEO), zeigen aber nie Kontaktdaten und nie exakte Lage. Kontakt nur nach Login über den Chat. Nicht freigegebene Anzeigen haben `noindex` und sind nicht abrufbar.
- **Rechtstexte:** AGB, Datenschutz und Impressum sind Platzhalter, bis ein Anwalt sie liefert. Nie selbst als „fertig“ ausgeben.
- **Keine Waffen- oder Munitionsverkäufe** in Kategorien oder Texten. Die App vermittelt nur Jagdgelegenheiten.
- **Keine Inhalte kopieren** von Konkurrenzseiten (Texte, Bilder, Daten).

## Code-Konventionen (Web)
- TypeScript strict, keine `any` ohne Begründung; Eingaben mit Zod validieren
- Server Components als Standard, Client Components nur für Interaktion; Datenzugriff über eine eigene Service-Schicht (`web/lib/services/`)
- Pro Seite: lokalisierte Meta-Tags, `hreflang`, Canonical-URL, strukturierte Daten; URLs enthalten das Sprachpräfix (`/de/...`, `/cs/...`)
- Responsive ab 360 px, Tastaturbedienung, Kontrast nach WCAG AA, Alt-Texte für Bilder
- Tests: Vitest für Logik, Playwright für Kernflows (Registrieren, Inserieren, Suchen, Chat, Melden, Account löschen)
- Linting und Typecheck (`npm run lint`, `npm run typecheck`) müssen vor jedem Commit grün sein

## Code-Konventionen (iOS)
- MVVM mit `@Observable`; Views klein halten, Logik in ViewModels/Services.
- Netzwerk/Backend nur über eine Service-Schicht (`ListingService`, `AuthService`, …) hinter Protokollen, damit Tests mit Mocks laufen.
- Fehler dem Nutzer verständlich anzeigen (lokalisiert), nie stumm schlucken.
- Accessibility: Dynamic Type, VoiceOver-Labels für alle Buttons und Bilder.
- Tests: Unit-Tests für Services und ViewModels, mindestens ein UI-Test pro Kernflow.

## Definition of Done (pro Schritt)
- [ ] Build ohne Warnungen in neuen Dateien (Web: Lint und Typecheck grün; iOS: Xcode-Build)
- [ ] Tests grün
- [ ] Alle neuen Texte in 4 Sprachen (iOS: String Catalog, Web: Message-Dateien; en als Quelle, de/cs/pl ergänzt; Fachbegriffe in `docs/GLOSSARY.md` abstimmen)
- [ ] Bei Funktionen, die es auf beiden Plattformen gibt: beide umgesetzt oder die Lücke in `docs/CHANGELOG.md` vermerkt
- [ ] RLS-Policies für neue Tabellen vorhanden und getestet
- [ ] Kurze Notiz in `docs/CHANGELOG.md`: was geändert, wie testen
