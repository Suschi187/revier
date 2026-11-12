# DESIGN – Reviro by Die Jagdbrüder (Arbeitsname)

Stand: M10a Schritt 1. Tokens (Schritt 2) und Komponenten (Schritt 3) folgen nach Freigabe von Logo und Seitenentwurf.
Grundlage für Web und später iOS (I1 bis I7). Quellen: `design/` (Designsystem, Logo Die Jagdbrüder, Shop-Beispiele) und SPEC M10a.

## 1. Briefing

**Marke:** Reviro ist eine **eigene Marke mit eigenem Logo** aus der Markenfamilie **Die Jagdbrüder**. Absender immer sichtbar: *REVIRO by Die Jagdbrüder*.
Vom Shop übernommen werden Farben, Schriften, Bildsprache und Tonalität (*Authentisch. Modern. Naturverbunden.*). Das Hirschkopf-Logo bleibt der Dachmarke vorbehalten.

**Bedienung:** wie ein großes Kleinanzeigen-Portal. Suchfeld mit „Was?“ und „Wo?“ im Kopf, „Anzeige aufgeben“ immer sichtbar, Kategorien als Einstieg, Ergebnisliste mit Filtern links, Detailseite mit Kontaktbox rechts. Übernommen werden nur diese allgemein üblichen Bedienmuster. Farben, Logo, Icons, Schriften und Texte fremder Portale werden nicht übernommen. Vor Abschluss prüft ein Mensch auf zu große Ähnlichkeit (SPEC M10a, Leitprinzip).

**Zielgruppen:** Jäger (Begehungsschein, Gastjagd, Jagdhelfer), Revierinhaber und Pächter, Jagdgenossenschaften, Veranstalter.

**Ton:** „Du“ in Deutsch wie im Shop, direkt und handlungsstark. Bei Pacht, Rechtsseiten und Hinweisen sachlich. cs/pl legen Muttersprachler fest.

## 2. Farben

Quelle: `design/Design_Master.png` („Festgelegtes Designsystem“). Die Werte stimmen mit dem Shop-Theme überein.

| Token | Hex | Verwendung |
|---|---|---|
| `forest` Waldgrün | `#202B23` | Text, Leiste oben, Footer, Suchbutton, aktive Zustände |
| `olive` Oliv | `#4A5A44` | Flächen, Platzhalterbilder, Avatar, Unterzeile im Lockup |
| `sand` | `#E8E3D8` | Linien, Chips, Hinweisboxen, Icon-Hintergründe |
| `offwhite` | `#F7F5EF` | Seitenhintergrund |
| `orange` | `#C46A32` | Logo, Icons, Flächen, große Schrift |
| `orange-strong` (neu) | `#A4531F` | Hauptaktions-Buttons, kleine orange Texte auf Offwhite |
| `orange-on-dark` (neu) | `#E0915E` | orange Schrift auf Waldgrün |
| `muted` (neu) | `#5E655F` | Nebentexte |
| `surface` | `#FFFFFF` | Karten, Eingabefelder |

**Kontraste (WCAG 2.x, gemessen):**

| Paar | Verhältnis | Ergebnis |
|---|---|---|
| Waldgrün auf Offwhite | 13,5 : 1 | AA |
| Waldgrün auf Sand | 11,5 : 1 | AA |
| Oliv auf Offwhite | 6,8 : 1 | AA |
| Weiß auf Oliv | 7,4 : 1 | AA |
| `muted` auf Offwhite / Sand | 5,5 / 4,7 : 1 | AA |
| Weiß auf Orange `#C46A32` | 3,9 : 1 | **nur große Schrift** |
| Weiß auf `orange-strong` | 5,5 : 1 | AA |
| `orange-strong` auf Offwhite | 5,0 : 1 | AA |
| `orange-strong` auf Sand | 4,3 : 1 | **nicht verwenden** |
| `orange-on-dark` auf Waldgrün | 5,9 : 1 | AA |

**Abweichung vom Designsystem (begründet):** Der Beispiel-Button im Designsystem trägt weiße Schrift auf `#C46A32`. Das sind 3,9 : 1 und damit unter AA für Buttontext. Reviro-Buttons nutzen deshalb `orange-strong`. Das Marken-Orange bleibt für Logo, Icons und Flächen.

## 3. Typografie

Montserrat (Überschriften und Buttons, 700 bis 900, Großbuchstaben, Überschriften mit Punkt am Ende) und Inter (Fließtext, Formulare, 400 bis 600).
Fließtext mindestens 16 px. Eyebrow 13 px, Laufweite 0.13em. Beide Schriften werden selbst gehostet (Latin und Latin Extended-A für cs/pl).

## 4. Logo (Vorschläge, Auswahl offen)

Eigenes Zeichen in der geometrischen Linienart und dem Orange des Hirschkopfs. Die Wortmarke REVIRO ist in Montserrat Black gesetzt, darunter steht „BY DIE JAGDBRÜDER“ in Montserrat Bold mit 0.2em Laufweite.

- **L1 Geweih-Pin:** Kartenmarker mit Geweih. Er sagt „Ort finden“, ist als Kartenmarker nutzbar und bleibt bei 24 px lesbar. **Empfehlung.**
- **L2 Hochsitz:** sehr jagdlich, wird in kleinen Größen aber zu fein.
- **L3 R mit Höhenlinien:** ruhig und gut skalierbar, aber am wenigsten eigenständig.

Nach der Auswahl folgen: SVG-Reinzeichnung, Schutzraum, Mindestgröße, Varianten für hell und dunkel, Favicon und App-Icon. Der Name steht weiter unter Vorbehalt der Markenrecherche (SPEC 7.1). Vor der Anmeldung einer Marke sollte ein Designer oder Anwalt das Zeichen auf Kollisionen prüfen.

## 5. Entwurf zur Freigabe

Zeichenfläche (privat): https://claude.ai/artifact/QanVEqfRCxRaD4f1DuuBk3
1. Logo-Vorschläge L1 bis L3 auf hellem und dunklem Grund, als App-Icon und in 24 px
2. Startseite: Kopf mit Suche, Kategorien als Icon-Kacheln, kompakter Markenbanner, neueste Anzeigen, Länder, Vertrauensbox
3. Suchergebnis: Filter links, Angebote/Gesuche, Sortierung, Liste/Karte, Suche speichern, Listenzeilen mit Bild links und Preis rechts
4. Anzeigen-Detail: Galerie, Eckdaten, Beschreibung, ungefähre Lage, Kontaktbox mit Verifizierung, Sicherheitshinweise, Melden

Alle Fotos und Wildarten-Icons sind Platzhalter.

## 6. Offene Punkte (Mensch)

1. Logo L1, L2 oder L3
2. Freigabe der Seitenentwürfe
3. Markenfotos mit Nutzungsrechten (auch KI-Bilder), ohne erkennbare Fremdmarken (in den Shop-Beispielen ist z. B. ein Fahrzeugschriftzug zu sehen)
4. Ob `design/` ins Repo soll (rund 14 MB PNG); sonst kommt `design/` in `.gitignore`
5. Name: Freigabe nach Markenrecherche (SPEC 7.1)

Entschieden laut SPEC: kein Dunkelmodus im ersten Stand; Ansprache „Du“ in Deutsch.

## 7. Lizenzen und Rechte

| Element | Quelle | Lizenz | Status |
|---|---|---|---|
| Montserrat | Julieta Ulanovsky u. a. | SIL OFL 1.1 | Lizenztext in Schritt 2 ablegen |
| Inter | Rasmus Andersson | SIL OFL 1.1 | Lizenztext in Schritt 2 ablegen |
| Reviro-Logo | eigene Gestaltung im Projekt | Projekt / Die Jagdbrüder | Entwurf |
| Hirschkopf Die Jagdbrüder | Die Jagdbrüder | Eigentum der Marke | nur Referenz, nicht im Reviro-Logo |
| Markenfotos | Die Jagdbrüder | Nutzungsrecht klären | ausstehend |
| Höhenlinien-Muster, Platzhalter-Icons | eigene Zeichnung | Projekt | im Entwurf |
