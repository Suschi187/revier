# Bildvorgaben: KI-Markenfotos für Huntroy (Stand 2026-11-15)

Die Fotos erzeugt der Mensch mit einem Bildgenerator (Entscheidung 2026-11-15); Claude baut sie danach ein. Grundlage: SPEC M10a („Bildsprache: Natur, Revier, Hochsitz, Jagdhund, Gemeinschaft; keine Trophäen- oder Schussbilder auf Start- und Kategorieseiten“), Farben aus `docs/DESIGN.md` Abschnitt 2, Ton *Authentisch. Modern. Naturverbunden.*

## Regeln für alle Bilder

**Inhalt**
- Mitteleuropäische Natur: Mischwald, Feldflur, Waldränder, Voralpen, Mittelgebirge. Keine erkennbaren Orte oder Sehenswürdigkeiten.
- Menschen nur von hinten, seitlich oder klein in der Ferne, ohne erkennbares Gesicht. Erwachsene. Neutrale Outdoor-Kleidung ohne Logos; Signalorange (Hutband, Weste) als Akzent ist erwünscht.
- **Nicht im Bild:** Waffen und Munition, erlegtes Wild, Blut, Trophäen, Schüsse; Schrift, Logos, Wasserzeichen, Fahrzeugschriftzüge, Markenkleidung; Drohnen- oder Fischaugenoptik.
- Lebendes Wild nur klein und natürlich (z. B. Reh am Feldrand in der Ferne), nie bedrängt.

**Look**
- Fotorealistisch, wie mit Vollformat und Festbrennweite (35–85 mm), natürliches Licht: Morgennebel, goldene Stunde, bedeckter Herbsttag.
- Farbgebung gedeckt und erdig, passend zu Waldgrün `#202B23`, Oliv `#4A5A44`, Sand `#E8E3D8`, Offwhite `#F7F5EF`; warmes Licht, kein übersättigtes Grün, keine HDR-Optik.
- Ruhige Bildaufteilung mit Freiraum für Text, wo unten angegeben.

**Für jedes Bild notieren** (gehört in `docs/DESIGN.md` Abschnitt 7): Generator und Version, Datum, vollständiger Prompt, Konto bzw. Lizenzstufe. Nur Generatoren verwenden, deren Bedingungen die **kommerzielle Nutzung** erlauben, und die Bedingungen einmal als PDF ablegen. Bilder mit Fehlern (Hände, verzerrte Hochsitze, unlogische Spuren, Schriftreste) verwerfen.

**Lieferung:** JPEG (Qualität ≥ 90) oder PNG in der angegebenen Größe oder größer, Dateinamen wie unten, z. B. in `design/ki-fotos/`. Zuschnitt, WebP/JPEG-Größen und Einbau übernimmt Claude.

**Negativ-Prompt** (bei Generatoren, die ihn unterstützen, sonst ans Ende des Prompts als „Avoid: …“):
`weapon, rifle, gun, ammunition, dead animal, blood, trophy, antlers on wall, hunting kill, text, letters, logo, watermark, brand, signature, face close-up, recognizable face, child, oversaturated, HDR, cartoon, illustration, 3d render, fisheye, drone shot`

## Die Bilder

### B1 Startseiten-Banner – `huntroy-hero.jpg`
Breit, **3200 × 1200 px (8 : 3)**. Text und Button stehen links, das Motiv rechts; das linke Drittel ruhig und eher dunkel (dort liegt eine waldgrüne Abdunklung).
> Photorealistic wide landscape photograph, early morning in a Central European mixed forest edge, a wooden hunting high seat (raised hide) at the edge of a misty meadow on the right third of the frame, soft golden sunrise light through fog, dew on the grass, calm dark green forest on the left side of the frame leaving empty space, muted earthy color grading, deep forest green and olive tones with warm light, shot on full-frame camera 35mm lens, natural, authentic, no people.

Variante B1-m für Handy, **1200 × 1200 px (1 : 1)**, gleiches Motiv mit dem Hochsitz mittig unten und ruhigem Himmel oben: `huntroy-hero-mobile.jpg`.

Alt-Text: dekorativ (der Banner trägt Text), daher `alt=""`.

### B2 Jagdpacht – `kind-lease.jpg`
**1600 × 1200 px (4 : 3)**.
> Photorealistic photograph of a wide Central European hunting ground in autumn, rolling fields bordered by mixed forest, a dirt track leading towards the woods, low warm afternoon sun, light haze, small roe deer grazing far away at the field edge, muted earthy colors, olive and forest green, authentic documentary style, 50mm lens.

Alt (de): „Feldflur mit Waldrand im Herbst“

### B3 Begehungsschein – `kind-permit.jpg`
**1600 × 1200 px**.
> Photorealistic photograph of a lone hunter seen from behind, walking quietly along a narrow forest path at dawn, wearing a neutral green jacket and a hat with a thin orange band, no visible equipment, morning mist between spruce and beech trees, soft backlight, muted forest greens, authentic and calm mood, 85mm lens, shallow depth of field.

Alt (de): „Jäger von hinten auf einem Pirschweg im Morgennebel“

### B4 Gesellschaftsjagd – `kind-driven-hunt.jpg`
**1600 × 1200 px**.
> Photorealistic photograph of a small group of hunters and beaters gathering at the edge of a forest on a frosty late-autumn morning, seen from behind and at a distance, wearing blaze orange vests and hats, two hunting dogs on leashes, breath visible in the cold air, warm low sunlight, no visible weapons, sense of community and tradition, muted earthy colors with orange accents, 35mm lens, documentary style.

Alt (de): „Jagdgesellschaft in Signalwesten am Waldrand an einem frostigen Morgen“

### B5 Trophäen-/Gastjagd – `kind-guest-hunt.jpg`
**1600 × 1200 px**. Ohne Trophäen: Gastjagd als Reise in ein Revier.
> Photorealistic photograph of a rustic wooden hunting lodge at the edge of a mountain forest in the Alpine foothills, warm light in the windows at blue hour, misty slopes and spruce forest behind, a bench and stacked firewood in front, no people, no antlers or trophies, cozy and authentic, muted forest green and warm amber tones, 35mm lens.

Alt (de): „Holzhütte am Bergwald zur blauen Stunde“

### B6 Jagdhelfer/Mitjäger – `kind-helper.jpg`
**1600 × 1200 px**.
> Photorealistic photograph of two people building a wooden high seat at a forest edge, seen from the side at medium distance with faces not recognizable, work gloves, fresh timber, a hunting dog (German wirehaired pointer) resting nearby, bright overcast spring day, authentic teamwork, muted natural colors with a small orange accent on a cap, 50mm lens, documentary style.

Alt (de): „Zwei Helfer bauen einen Hochsitz am Waldrand, daneben ein Jagdhund“

### B7 Platzhalter für Anzeigen ohne Foto – `listing-placeholder.jpg`
**1600 × 1000 px (16 : 10)**. Sehr ruhig und kontrastarm, damit es nicht wie ein echtes Anzeigenfoto wirkt; darüber legt Claude das Icon der Anzeigenart.
> Photorealistic soft-focus photograph of a misty forest edge and meadow, very low contrast, pale sand and muted olive tones, minimal detail, lots of calm empty space, no animals, no people, no structures, gentle morning light.

Alt: dekorativ (`alt=""`), die Anzeige hat eigenen Text.

### B8 Vorschaubild für soziale Netzwerke – `og-default.jpg`
**1200 × 630 px**. Ohne Schrift; Logo und Unterzeile setzt Claude ein. Linke Hälfte ruhig.
> Photorealistic photograph of a high seat at a forest edge at golden hour, positioned in the right third, calm empty meadow and soft sky on the left half, muted forest green and warm light, authentic, no people, no text.

## Danach (Claude)
- Zuschnitte und Größen (WebP und JPEG, 480–2048 px) unter `web/public/static/brand/`, Dateinamen mit Version (`.v1`) wie bei den Schriften.
- B1 im Startseiten-Banner mit waldgrüner Abdunklung links (Kontrast AA für den Text messen), Höhenlinien bleiben als Rückfall.
- B2–B6 als Kopfbild der Kategorieseiten, B7 in Listen und Detail ohne Foto, B8 als `og:image` der Seiten ohne eigenes Foto.
- Alt-Texte in 4 Sprachen in den Message-Dateien; Lizenzzeile je Bild in `docs/DESIGN.md` Abschnitt 7.
- Lighthouse-Messung danach (Start ≥ 90 halten, Banner mit `fetchpriority="high"` und passender `srcset`).
