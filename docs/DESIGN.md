# DESIGN – Reviro by Die Jagdbrüder (Arbeitsname)

Stand: M10a Schritt 1 (Markenübertragung). Tokens (Schritt 2) und Komponenten (Schritt 3) folgen nach Freigabe des Entwurfs.
Grundlage für Web und später iOS (I1 bis I7). Verbindliche Vorgaben: SPEC Abschnitt 6, M10a.

## 1. Briefing

**Marke:** Reviro ist Teil von **Die Jagdbrüder** und übernimmt deren Auftritt aus dem Webshop. Positionierung: *Authentisch. Modern. Naturverbunden.*
Lockup: **REVIRO** mit Zusatz *Hunting Marketplace* und Label *by Die Jagdbrüder*. Name und Domain sind erst nach der Markenrecherche (SPEC 7.1) fest.

**Zielgruppen**
- *Jäger* (Begehungsschein, Gastjagd, Jagdhelfer): suchen schnell nach Region, Wildart und Preis, oft mobil
- *Revierinhaber und Pächter:* inserieren selten und brauchen eine klare Anleitung
- *Jagdgenossenschaften:* inserieren Jagdpachten, legen Wert auf Seriosität und gut lesbare Texte
- *Veranstalter* (Gesellschafts- und Gastjagden): mehrere Anzeigen, auch grenzüberschreitend

**Ton:** wie im Shop mit „Du“ (de), direkt und handlungsstark. Bei Pacht, Rechtsseiten und Hinweisen sachlich. cs/pl legen Muttersprachler fest.

**Was aus dem Shop übernommen wird:** dunkelgrüne Leiste oben, Offwhite-Header, Hauptnavigation in Großbuchstaben, Überschriften in Großbuchstaben mit Punkt am Ende, kleine Eyebrow-Überschrift in Orange, vollflächiges Foto mit Text links und Button mit Pfeil, Offwhite- und Sand-Abschnitte, quadratische Bildkarten mit Text darunter, Link „Alle … →“, kleine Radien bei Buttons (2 px), größere bei Eingabefeldern (8 px), Pills (40 px).

**Was nicht übernommen wird:** Shop-Technik (Shopify), Warenkorb, Produktraster für Waren. Von fremden Portalen (Kleinanzeigen, eBay) werden nur allgemein übliche Bedienmuster übernommen, nie Farben, Logo, Schrift, Icons, Bilder oder Texte.

## 2. Farben

Quelle: CSS-Variablen des Shop-Themes auf www.jagdbrueder.de, am 2026-11-12 aus dem Seitenquelltext gelesen (nicht aus Screenshots geschätzt).
**Status: vorläufig, Bestätigung durch den Markeninhaber oder aus den Markenunterlagen steht aus.**

| Token (Vorschlag) | Hex | Herkunft | Verwendung |
|---|---|---|---|
| `forest` Waldgrün | `#202B23` | Shop `--palette-darkest` | Text, Leiste oben, Footer, sekundäre Buttons |
| `forest-light` Waldgrün hell | `#415747` | Shop Button-Hover | Hover, Bildflächen |
| `offwhite` | `#F7F5EF` | Shop `--palette-lightest` | Seitenhintergrund |
| `sand` | `#EFEADE` | Shop Hover sekundär | Abschnitte, Chips, Hinweise |
| `sand-line` | `#E8E3D8` | Shop Eingabefeld-Rahmen | Linien, Rahmen |
| `orange` Marken-Orange | `#C46A32` | Shop Hintergrundschema | Flächen, Icons, große Schrift |
| `orange-text` | `#A4531F` | **neu**, abgeleitet | kleine Schrift in Orange, Hauptaktions-Buttons |
| `orange-on-dark` | `#E0915E` | **neu**, abgeleitet | orange Schrift auf Waldgrün |
| `muted` | `#5E655F` | **neu** | Nebentexte |
| `error` | `#8B0000` | Shop | Fehler (nie Orange für Fehler) |
| `success` | `#006400` | Shop | Erfolg |

**Kontraste (WCAG 2.x, gemessen):**

| Paar | Verhältnis | Ergebnis |
|---|---|---|
| Waldgrün auf Offwhite | 13,5 : 1 | AA |
| Marken-Orange auf Offwhite | 3,5 : 1 | nur große Schrift, Icons, Flächen |
| Weiß auf Marken-Orange | 3,9 : 1 | nur große Schrift |
| Waldgrün auf Marken-Orange | 3,8 : 1 | nur große Schrift |
| `orange-text` auf Offwhite | 5,0 : 1 | AA |
| Weiß auf `orange-text` | 5,5 : 1 | AA |
| `orange-text` auf Sand | 4,6 : 1 | AA |
| `orange-on-dark` auf Waldgrün | 5,9 : 1 | AA |
| `muted` auf Offwhite | 5,5 : 1 | AA |

**Abweichung vom Shop (begründet):** Der Shop nutzt für Hauptbuttons Waldgrün. Reviro nutzt laut SPEC Orange für Hauptaktionen. Das Marken-Orange erreicht mit Text kein AA, deshalb tragen Buttons und kleine orange Texte `orange-text`.

## 3. Typografie

Aus dem Shop-Theme: Überschriften **Montserrat** 700, Fließtext **Inter** 400. Montserrat wird für Überschriften in Großbuchstaben gesetzt.
Shop-Skala (zur Übernahme in Schritt 2): h1 `clamp(3rem, 8.8vw, 5.5rem)`, h2 `clamp(2.25rem, 4.8vw, 3rem)`, h3 2rem, h4 1.5rem, Fließtext 0.875 bis 1rem, Laufweite Überschriften −0.03em, Eyebrow 0.13em.
Für Reviro wird Fließtext mindestens 1rem (16 px) groß, wegen Lesbarkeit für ältere Nutzer.
Beide Schriften werden selbst gehostet (Latin und Latin Extended-A für cs/pl), keine Anfrage an Google Fonts.

## 4. Logo

Original-Hirschkopf der Marke in Orange, Wortmarke in Waldgrün. **Das Logo als SVG fehlt noch** und wird vom Markeninhaber geliefert. Bis dahin steht im Entwurf ein Platzhalter.
Schutzraum, Mindestgröße, Verhalten auf hellem und dunklem Grund und das Lockup *REVIRO by Die Jagdbrüder* werden festgelegt, sobald das SVG vorliegt.

## 5. Entwurf zur Freigabe

Zeichenfläche (privat): https://claude.ai/artifact/QanVEqfRCxRaD4f1DuuBk3
- Startseite: Leiste, Header, Fotobereich „FINDE DEIN REVIER.“, Suche, Kategorien, neueste Anzeigen, Länder, Vertrauensleiste, Hinweis auf die Gemeinschaft
- Bausteine: Anzeigenkarte (Raster und Liste), Kategorie-Kachel K1 (Foto) oder K2 (Icon auf Sand), Kontaktbox C1 (hell) oder C2 (dunkelgrüner Kopf)

Fotos sind Platzhalter. Die Icons sind einfache Platzhalter, die Wildarten-Icons in der Linienart des Hirschkopfs folgen in Schritt 3.

## 6. Offene Punkte (Mensch)

1. Farbwerte bestätigen (oder aus Markenunterlagen korrigieren)
2. Logo (Hirschkopf und Wortmarke) als SVG liefern
3. Kategorie-Kachel K1 oder K2, Kontaktbox C1 oder C2
4. Markenfotos mit Nutzungsrechten (auch KI-Bilder), ohne erkennbare Fremdmarken
5. Name: Freigabe nach Markenrecherche (SPEC 7.1)

Entschieden laut SPEC: kein Dunkelmodus im ersten Stand; Ansprache „Du“ in Deutsch.

## 7. Lizenzen und Rechte

| Element | Quelle | Lizenz | Status |
|---|---|---|---|
| Montserrat | Julieta Ulanovsky u. a. | SIL OFL 1.1 | Lizenztext in Schritt 2 ablegen |
| Inter | Rasmus Andersson | SIL OFL 1.1 | Lizenztext in Schritt 2 ablegen |
| Hirschkopf-Logo, Wortmarke | Die Jagdbrüder | Eigentum der Marke | SVG ausstehend |
| Markenfotos | Die Jagdbrüder | Nutzungsrecht klären | ausstehend |
| Höhenlinien-Muster, Platzhalter-Icons | eigene Zeichnung | Projekt | im Entwurf |
