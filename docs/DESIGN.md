# DESIGN – Reviro (Arbeitsname)

Stand: M10a Schritt 1 (Designrichtung). Tokens (Schritt 2) und Komponenten (Schritt 3) folgen, sobald eine Richtung gewählt ist.
Dieses Dokument ist die gemeinsame Grundlage für Web und später iOS (I1 bis I7).

## 1. Briefing

**Marke:** REVIRO, Zusatz *Hunting Marketplace*, Label *by Die Jagdbrüder*. Claim-Kandidat *Klare Linien. Wilde Freiheit.*
Name und Logo sind nicht freigegeben (SPEC 7.1). Die Wortmarke wird bis dahin nur als Text gesetzt, damit ein Namenswechsel billig bleibt.

**Zielgruppen**
- *Jäger* (Begehungsschein, Gastjagd, Jagdhelfer): suchen schnell nach Region, Wildart und Preis, oft mobil und abends
- *Revierinhaber und Pächter:* inserieren selten, brauchen eine verständliche Anleitung und Vertrauen in die Plattform
- *Jagdgenossenschaften:* inserieren Jagdpachten, oft ältere Nutzer, legen Wert auf Seriosität und gut lesbare Texte
- *Veranstalter* (Gesellschaftsjagden, Gastjagden): mehrere Anzeigen, wiederkehrend, auch grenzüberschreitend (CZ, PL, AT)

**Tonalität:** verlässlich, ruhig, naturnah, respektvoll, nicht reißerisch. Keine Superlative und keine Dringlichkeit („Nur noch heute!“). Jagd wird als Handwerk und Naturverantwortung gezeigt, nicht als Trophäenschau.

**Abgrenzung zu klassischen Kleinanzeigenportalen**
- Übernommen werden nur allgemein übliche Bedienmuster: Suchfeld oben mit „Was?“ und „Wo?“, Kategorie-Kacheln, Anzeigenkarten mit Bild, Preis, Ort und Datum, Merken, Kontaktbox auf der Detailseite.
- Nicht übernommen: Farbschema (insbesondere kein Limettengrün), Logo, Schriften, Icons, Bilder, Wortlaut und Seitenaufbau im Detail eines bestehenden Portals.
- Eigenständig durch: jagdliche Farbwelt mit Signalorange als einzigem Akzent, Serifen-Überschriften, Höhenlinien-Muster, Wildarten-Icons.
- Vor Abschluss von M10a prüft ein Mensch Start-, Listen- und Detailseite gegen Screenshots bekannter Portale.

**Gestaltungsregeln (gelten für jede Richtung)**
- Signalorange nur für Hauptaktionen („Anzeige aufgeben“, „Suchen“, „Nachricht schreiben“), höchstens eine pro Bildschirmbereich
- Höhenlinien-Muster sparsam: Kopfbereich, Startseite, Platzhalterbilder; nie hinter Fließtext mit Kontrastproblem
- Bildsprache: Natur, Revier, Morgendunst, Landschaft; keine Trophäen- oder Schussbilder auf Start- und Kategorieseiten
- Kontraste nach WCAG AA, sichtbarer Fokus, Tippflächen mindestens 44 px
- Schriften mit vollem Latin-Extended-A-Umfang (cs, pl), selbst gehostet, keine Anfragen an Dritte

## 2. Richtungen zur Auswahl

Entwürfe (Startseitenausschnitt, Kategorien, Anzeigenkarten, Farbwelt, Schrift) auf der Zeichenfläche:
https://claude.ai/artifact/QanVEqfRCxRaD4f1DuuBk3 (privat, nur für den Projektinhaber)

Die Kategorie-Icons in den Entwürfen sind einfache Platzhalter. Die Wildarten-Silhouetten entstehen in Schritt 3.

### A · Revierkarte (kartografisch, kühl, präzise)
- Kopfbereich in Tannengrün mit Höhenlinien, Claim groß, Suche als weiße Leiste mit „Was?“/„Wo?“
- Kartenraster mit Bild oben, Preis in der Serife
- Farben: Tannengrün `#1F3A2E`, Moos `#5E6B4E`, Signalorange `#F26B1D` (mit dunkler Schrift), Kalkweiß `#F6F4EE`, Linie `#D6D1C4`, Tinte `#1B1F1C`
- Schrift: Fraunces (Überschriften), Inter (Text)

### B · Lodenstube (warm, traditionell, nahbar)
- Heller, warmer Kopf mit Suche im Kopfbereich, darunter eine Kategorieleiste in Loden
- Listenkarten quer mit Kurztext (mehr Information je Anzeige), größere Radien
- Farben: Loden `#4A5A3C`, Rindenbraun `#5C3D2E`, Signalorange tief `#C2410C` (mit weißer Schrift), Kalkweiß warm `#F3EEE3`, Heu `#E8DFCC`, Torf `#2A211B`
- Schrift: Alegreya (Überschriften), Source Sans 3 (Text)

### C · Hochsitz (modern, hell, sachlich)
- Viel Weißraum, Haarlinien, Höhenlinien nur rechts im Startbereich, Schnellfilter als Chips
- Kategorien als Linienraster, Karten ohne Rahmen
- Farben: Tannengrün tief `#17332A`, Moos `#2F6B4F`, Signalorange `#FF6A13` (mit dunkler Schrift), Kalkweiß `#FBFBF8`, Linie `#DDE2DC`, Tinte `#14201B`
- Schrift: Source Serif 4 (Überschriften), Public Sans (Text)

### Kontrastprüfung (WCAG 2.x, Textpaare der Entwürfe)

| Richtung | Paar | Verhältnis | AA Text |
|---|---|---|---|
| A | Tannengrün auf Kalkweiß | 11,2 : 1 | ja |
| A | Tinte auf Signalorange | 5,5 : 1 | ja |
| A | Moos auf Kalkweiß | 5,2 : 1 | ja |
| A | Signalorange auf Tannengrün | 4,1 : 1 | nur Fläche/große Schrift; Button trägt dunkle Schrift |
| B | Weiß auf Signalorange tief | 5,2 : 1 | ja |
| B | Loden auf Kalkweiß warm | 6,4 : 1 | ja |
| B | Rindenbraun auf Kalkweiß warm | 8,4 : 1 | ja |
| C | Tannengrün tief auf Kalkweiß | 13,1 : 1 | ja |
| C | Tinte auf Signalorange | 5,9 : 1 | ja |
| C | Grau `#5F6B66` auf Kalkweiß | 5,4 : 1 | ja |

## 3. Offene Entscheidungen (Mensch)

1. Richtung A, B oder C (oder Mischung, z. B. Farben aus A mit Aufbau aus C)
2. Dunkelmodus ja oder nein
3. Ansprache Du oder Sie, je Sprache
4. Logo: vorerst schlichte Wortmarke oder Designer beauftragen
5. Name: Freigabe nach Markenrecherche (SPEC 7.1)

## 4. Lizenzen

Alle Schriften der Entwürfe stehen unter der SIL Open Font License 1.1 und werden im Produkt selbst gehostet (Subset mit Latin und Latin Extended-A). Verbindlich wird nur die Schrift der gewählten Richtung.

| Element | Quelle | Lizenz | Verwendung |
|---|---|---|---|
| Fraunces | Undercase Type | SIL OFL 1.1 | Richtung A |
| Inter | Rasmus Andersson | SIL OFL 1.1 | Richtung A |
| Alegreya | Huerta Tipográfica | SIL OFL 1.1 | Richtung B |
| Source Sans 3 | Adobe | SIL OFL 1.1 | Richtung B |
| Source Serif 4 | Adobe | SIL OFL 1.1 | Richtung C |
| Public Sans | U.S. Web Design System | SIL OFL 1.1 | Richtung C |
| Höhenlinien-Muster, Platzhalter-Icons | eigene Zeichnung | Projekt | alle |
