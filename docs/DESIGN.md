# DESIGN – Reviro by Die Jagdbrüder (Arbeitsname)

Stand: M10a Schritte 1, 2 und 4.1 bis 4.4 umgesetzt (Logo, Tokens, Kopf/Fuß, Start, Suche, Detail). Offen: Styleguide-Seite (Schritt 3) und die übrigen Seiten (4.5 bis 4.10).
Grundlage für Web und später iOS (I1 bis I7). Quellen: `design/` (Designsystem, Logo Die Jagdbrüder, Shop-Beispiele) und SPEC M10a.

## 1. Briefing

**Marke:** Reviro ist eine **eigene Marke mit eigenem Logo** aus der Markenfamilie **Die Jagdbrüder**. Absender immer sichtbar: *REVIRO by Die Jagdbrüder*.
Vom Shop übernommen werden Farben, Schriften, Bildsprache und Tonalität (*Authentisch. Modern. Naturverbunden.*). Das Hirschkopf-Logo bleibt der Dachmarke vorbehalten.

**Bedienung:** wie ein großes Kleinanzeigen-Portal. Suchfeld mit „Was?“ und „Wo?“ im Kopf, „Anzeige aufgeben“ immer sichtbar, Kategorien als Einstieg, Ergebnisliste mit Filtern links, Detailseite mit Kontaktbox rechts. Übernommen werden nur diese allgemein üblichen Bedienmuster. Farben, Logo, Icons, Schriften und Texte fremder Portale werden nicht übernommen. Vor Abschluss prüft ein Mensch auf zu große Ähnlichkeit (SPEC M10a, Leitprinzip).

**Zielgruppen:** Jäger (Begehungsschein, Gastjagd, Jagdhelfer), Revierinhaber und Pächter, Jagdgenossenschaften, Veranstalter.

**Ton:** „Du“ in Deutsch wie im Shop, direkt und handlungsstark. Bei Pacht, Rechtsseiten und Hinweisen sachlich. cs/pl legen Muttersprachler fest.

## 2. Farben

Quelle: `design/Design_Master.png`; das Marken-Orange ist laut Vorgabe des Markeninhabers (2026-11-12) **#FF914D**, auch im Logo.
Tokens stehen in `web/app/globals.css` (`@theme`) und sind als Tailwind-Klassen nutzbar (`bg-forest`, `text-brand-ink` …).

| Token | Hex | Verwendung |
|---|---|---|
| `forest` Waldgrün | `#202B23` | Text, Leiste oben, Footer, Suchbutton, aktive Zustände |
| `forest-hover` | `#415747` | Hover auf Waldgrün |
| `olive` Oliv | `#4A5A44` | Platzhalterflächen, Avatar, Unterzeile im Lockup |
| `sand` | `#E8E3D8` | Linien, Chips, Hinweisboxen, Icon-Hintergründe |
| `offwhite` | `#F7F5EF` | Seitenhintergrund |
| `surface` | `#FFFFFF` | Karten, Eingabefelder |
| `brand` Orange | `#FF914D` | Logo, Hauptaktions-Buttons (mit Waldgrün-Schrift), Eyebrow auf Dunkel, Flächen |
| `brand-hover` | `#FFA66E` | Hover der Hauptaktion |
| `brand-ink` | `#9A4410` | orange Schrift und Fokusrahmen auf hellem Grund |
| `muted` | `#5E655F` | Nebentexte |
| `field` | `#7C8279` | Rahmen von Eingabefeldern (≥ 3 : 1, WCAG 1.4.11) |
| `error` / `error-soft` | `#8B0000` / `#FBEAEA` | Fehler (nie Orange) |
| `success` / `success-soft` | `#006400` / `#E8F1E4` | Erfolg |
| `notice` / `notice-soft` | `#6B4A00` / `#FFF1DC` | Hinweise |

**Kontraste (WCAG 2.x, gemessen):**

| Paar | Verhältnis | Ergebnis |
|---|---|---|
| Waldgrün auf Offwhite / Sand | 13,5 / 11,5 : 1 | AA |
| Waldgrün auf Orange `#FF914D` (Buttons) | 6,6 : 1 | AA |
| Orange auf Waldgrün (Eyebrow, Fußzeile) | 6,6 : 1 | AA |
| Weiß auf Orange | 2,2 : 1 | **nicht verwenden** |
| Orange auf Offwhite | 2,1 : 1 | **nur Logo und Flächen**, Text in `brand-ink` |
| `brand-ink` auf Offwhite / Sand / Weiß | 6,0 / 5,1 / 6,6 : 1 | AA |
| `muted` auf Offwhite / Sand | 5,5 / 4,7 : 1 | AA |
| Oliv auf Offwhite, Weiß auf Oliv | 6,8 / 7,4 : 1 | AA |
| `field` auf Offwhite | 3,6 : 1 | AA für Bedienelemente |
| Fehler / Erfolg auf Offwhite | 9,2 / 6,8 : 1 | AA |

Logos sind von den Kontrastregeln ausgenommen (WCAG 1.4.3), deshalb bleibt der Pin auf hellem Grund im Marken-Orange.

## 3. Typografie

Montserrat (Überschriften und Buttons, 700 bis 900, Großbuchstaben, Überschriften mit Punkt am Ende) und Inter (Fließtext, Formulare, 400 bis 600).
Fließtext mindestens 16 px. Eyebrow 13 px, Laufweite 0.13em. Beide Schriften werden selbst gehostet (Latin und Latin Extended-A für cs/pl). Dateinamen tragen eine Version (`.v1`), weil `/static/fonts` ein Jahr unveränderlich gecacht wird; bei jeder Änderung hochzählen. Dazu kommt `inter-czech-wght-normal.v1.woff2` (2 KB, nur Č č Š š, mit fonttools aus der Latin-Extended-Datei geschnitten, SIL OFL erlaubt Teilmengen): Die Sprachwahl zeigt „Čeština“ auf jeder Seite, ohne dass de/en-Seiten die 84 KB große Latin-Extended-Datei laden. Montserrat und Inter (Latin) werden vorgeladen, auf cs/pl auch Latin Extended.

### Tokens (`web/app/globals.css`, `@theme`)

Seiten verwenden nur Tokens oder Tailwind-Stufen, keine festen Werte in eckigen Klammern.

| Gruppe | Token | Wert | Verwendung |
|---|---|---|---|
| Schrift | `text-logo-sub` | 9 px | Zusatz unter der Wortmarke |
| | `text-micro` | 11 px | Beschriftung der Navigation unten, Zähler-Badges |
| | `text-meta` | 13 px | Eyebrow, Chips, Ort und Datum, Suchbutton |
| | `text-compact` | 15 px | Titel in Anzeigenkarten, Kontaktbutton |
| | `text-price` | 17 px | Preis in Anzeigenkarten |
| | `text-title` | 28 px | Titel und Preis der Detailseite (ab `sm`) |
| Laufweite | `tracking-wordmark` / `caps` / `claim` / `eyebrow` / `logo-sub` / `code` | 0.02 / 0.06 / 0.1 / 0.13 / 0.2 / 0.3 em | Wortmarke, Buttons, Claim, Eyebrow, Logo-Zusatz, Einmalcode |
| Radius | `rounded-btn` / `card` / `pill` | 4 / 8 / 40 px | Buttons, Bilder, kleine Flächen / Karten, Felder / Chips, Badges |
| | `rounded-bubble`, `rounded-*-tail` | 16 / 2 px | Chat-Blase und ihre Spitze zur Absenderseite |
| | `rounded-full` | Kreis | nur runde Elemente (Avatar, Punkt, Kartenmarker) |
| Seitenverhältnis | `aspect-photo` / `aspect-hero` | 4:3 / 16:10 | Anzeigenfotos / Hauptbild der Detailseite |
| Schatten | `--shadow-marker` | | Kartenmarker |
| ohne Klasse (`:root`) | `--stroke-strong`, `--color-map-land` | 1.5 px, `#eceee6` | Rahmen der Suchleiste, Kartengrund ohne Kacheln |

Erlaubte feste Werte, weil sie Layout und keine Gestaltung sind: Spaltenaufteilungen (`grid-cols-[…]`), `max-w-[85%]` (Chat-Blase), `max-h-[80vh]` (Dokumentvorschau im Admin), `flex-[2]` (Suchfeld neben der Regionswahl), `[overflow-wrap:anywhere]` (lange Wörter in cs/pl). Größen für Karte, Seitenleiste und Tabellen kommen aus der Abstandsskala (`h-112`, `w-88`, `min-w-160`).

### Bausteine (`web/components`, Styleguide `/[locale]/styleguide`)

Vorschlag freigegeben 2026-11-13 (Zeichenfläche: https://claude.ai/artifact/FucY7ECVcTrRrV7AaopEk7).

| Baustein | Komponente | Regel |
|---|---|---|
| Rückfrage („Dialog“) | `ui/ConfirmPanel` | Ohne JavaScript als eigene Ansicht nach einem Link. Titel als Frage, ein Satz zur Folge, „Abbrechen“ links, Aktion rechts in Fehlerrot. |
| Reiter | `ui/Tabs` → `TabLinks` | Aktive Lasche mit 3 px Orange darunter, Text bleibt Waldgrün. |
| Umschalter | `ui/Tabs` → `SegmentLinks` | Pille, aktive Wahl in Waldgrün (Liste/Karte). |
| Blättern | `ui/Pager` | Cursor-Suche, daher „Zum Anfang“ und „Weiter“ statt Seitenzahlen; Kacheln ab 44 px. |
| Assistent | `listings/WizardChrome` → `StepNav` | Ein Balken je Schritt: erledigt Waldgrün, aktuell Orange, offen Sand. Namen ab `sm`, mobil nur der aktuelle. |
| Chat | `chat/ChatBubble`, `ChatNotice` | Eigene rechts in Waldgrün, fremde links weiß; Radius 16 px, Spitze 2 px. Systemhinweise mittig ohne Blase. |
| Zähler | `ui.countBadge` | Orange mit Waldgrün, 11 px fett. |
| Kartenpopup | `.map-popup` (`globals.css`) | Nur Landkreis, Radius 8 px, Schatten `--shadow-popup`, Schließen-Knopf für Tastatur. |
| Laden | `ui/Skeleton` → `SkeletonCard` | Flächen in Sand, Pulsieren nur ohne reduzierte Bewegung. |
| Offline | `ui/OfflineNotice` | Band unter dem Kopf, solange der Browser offline ist. |
| Fehlerseiten | `ui/ErrorState` | Code groß in `brand-ink`, Titel, Wege zurück (404, 410). |
| Wildarten | `brand/SpeciesIcon` | Raster 40, Linie 2, eckige Enden, Akzent in `brand-ink` (auf `.on-dark` Marken-Orange). Immer mit Namen. |

Wildarten-Icons: 13 Zeichnungen für 15 Wildarten. Sikawild nutzt Rotwild, „Sonstiges Raubwild“ den Fuchs, „Sonstiges Niederwild“ den Hasen; `dog` steht für Hundeführer und Nachsuche. Rehwild in Variante C (Gehörn aus der Bildmarke abgeleitet, gewählt 2026-11-13). iOS übernimmt die Pfade aus `SpeciesIcon.tsx`.

Noch nicht umgesetzt aus dem Vorschlag: Filterleiste mit entfernbaren Chips der aktiven Filter und Zähler am Filter-Knopf.

## 4. Logo: L1 Geweih-Pin (gewählt 2026-11-12)

Kartenmarker in Marken-Orange `#FF914D` mit ausgespartem Geweih und Kopf. Die Wortmarke REVIRO ist in Montserrat Black gesetzt (Waldgrün, auf Dunkel Offwhite), darunter steht „BY DIE JAGDBRÜDER“ in Montserrat Bold mit 0.2em Laufweite (Oliv, auf Dunkel Orange).
- Umsetzung: `web/components/brand/Logo.tsx` (`LogoMark`, `Logo`), App-Icon `web/app/icon.svg` (Pin auf Waldgrün)
- Die Aussparung nimmt die Hintergrundfarbe an (Offwhite auf hellem, Waldgrün auf dunklem Grund)
- Mindestgröße: Bildmarke 24 px, Lockup 120 px breit. Schutzraum: halbe Pin-Breite rundum
- Offen: Reinzeichnung durch einen Designer und Kollisionsprüfung vor einer Markenanmeldung; Name unter Vorbehalt SPEC 7.1

## 5. Entwurf (freigegeben 2026-11-12)

Zeichenfläche (privat): https://claude.ai/artifact/QanVEqfRCxRaD4f1DuuBk3
1. Logo-Vorschläge L1 bis L3 auf hellem und dunklem Grund, als App-Icon und in 24 px
2. Startseite: Kopf mit Suche, Kategorien als Icon-Kacheln, kompakter Markenbanner, neueste Anzeigen, Länder, Vertrauensbox
3. Suchergebnis: Filter links, Angebote/Gesuche, Sortierung, Liste/Karte, Suche speichern, Listenzeilen mit Bild links und Preis rechts
4. Anzeigen-Detail: Galerie, Eckdaten, Beschreibung, ungefähre Lage, Kontaktbox mit Verifizierung, Sicherheitshinweise, Melden

Alle Fotos sind Platzhalter. Die Wildarten-Icons sind eigene Zeichnungen (siehe „Bausteine“).

## 6. Offene Punkte (Mensch)

1. Markenfotos mit Nutzungsrechten (auch KI-Bilder), ohne erkennbare Fremdmarken (in den Shop-Beispielen ist z. B. ein Fahrzeugschriftzug zu sehen)
2. Ob `design/` ins Repo soll (rund 14 MB PNG); sonst kommt `design/` in `.gitignore`
3. Name: Freigabe nach Markenrecherche (SPEC 7.1)

Entschieden laut SPEC: kein Dunkelmodus im ersten Stand; Ansprache „Du“ in Deutsch.

## 7. Lizenzen und Rechte

| Element | Quelle | Lizenz | Status |
|---|---|---|---|
| Montserrat | Julieta Ulanovsky u. a. | SIL OFL 1.1 | `web/public/static/fonts/Montserrat-OFL.txt` |
| Inter | Rasmus Andersson | SIL OFL 1.1 | `web/public/static/fonts/Inter-OFL.txt` |
| Reviro-Logo L1 | eigene Gestaltung im Projekt | Projekt / Die Jagdbrüder | umgesetzt, Reinzeichnung offen |
| Hirschkopf Die Jagdbrüder | Die Jagdbrüder | Eigentum der Marke | nur Referenz, nicht im Reviro-Logo |
| Markenfotos | Die Jagdbrüder | Nutzungsrecht klären | ausstehend |
| Höhenlinien-Muster, Kategorie- und UI-Icons | eigene Zeichnung | Projekt | umgesetzt |
| Inter-Teilmenge `inter-czech-wght-normal.v1.woff2` | aus Inter (Latin Extended) geschnitten | SIL OFL 1.1 (kein Reserved Font Name) | `pyftsubset inter-latin-ext-wght-normal.v1.woff2 --unicodes="U+010C-010D,U+0160-0161" --flavor=woff2 --layout-features='*' --name-IDs='*'` (fonttools 4.55) |
| App-Icon `web/app/icon.svg` | eigene Gestaltung (Logo L1) | Projekt | umgesetzt |
| Kartenschrift Noto Sans | Google / Protomaps basemaps-assets | SIL OFL 1.1 | Seite „Datenquellen“ |
| MapLibre GL JS | MapLibre-Community | BSD-3-Clause | npm-Abhängigkeit, Lizenz im Paket |
| Kartendaten | OpenStreetMap-Mitwirkende, Protomaps | ODbL 1.0 / BSD-3-Clause | Seite „Datenquellen“, Vermerk in der Karte |
| Markenunterlagen in `design/` | Die Jagdbrüder | Eigentum der Marke, nur interne Referenz | nicht ausgeliefert, nicht im Web verwendet |
