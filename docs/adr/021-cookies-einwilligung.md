# ADR 021: Cookies, Browser-Speicher und Einwilligung (Web)

Status: angenommen (M9a, Plan `docs/plans/M9-plan.md` mit Architekt-Review Abschnitt 10, Freigabe durch den Nutzer 2026-11-08). **Keine Rechtsberatung:** Die Einordnung als „unbedingt erforderlich“ ist eine technische Annahme bis SPEC 7.2.

## Kontext
SPEC 6 M9a, Akzeptanz b: Ohne Einwilligung laufen keine nicht notwendigen Cookies.

Nutzer-Entscheidung vom 2026-11-08: kein Pop-up, solange nur notwendige Cookies laufen. Grundlage ist § 25 Abs. 2 Nr. 2 TTDSG (seit Mai 2024 TDDDG); für AT, CZ und PL gilt die jeweilige Umsetzung von Art. 5 Abs. 3 ePrivacy-Richtlinie (Anwalt). Eine Seite „Cookie-Einstellungen“ listet alle Cookies und Browser-Speicher; die Consent-Mechanik ist vorbereitet und greift, sobald etwas Optionales dazukommt.

Bestand: Supabase-Session-Cookies nach dem Login, PKCE-Verifier beim Apple-Login, `NEXT_LOCALE` auf jeder Antwort (QA M0 F7), kein `localStorage`/`sessionStorage` im eigenen Code, MapLibre ohne Cache Storage (E2E M6), Karte von der eigenen Origin (ADR 016).

## Entscheidung

### Inventar als eine Quelle
- `web/lib/consent/inventory.ts` beschreibt jeden Eintrag mit Name bzw. Muster, Zweck, Anbieter, Dauer, Kategorie (`necessary | optional`) und Art (`cookie | localStorage | sessionStorage | indexedDB | cache`). Dienste ohne Speicher (Karte) stehen als eigener Eintrag ohne Speicherart.
- Die Seite und die Tests lesen dasselbe Inventar.
- **Muster sind verankert**, keine freien Wildcards (Review A10).

| Eintrag | Muster | Art | Kategorie | Wann |
|---|---|---|---|---|
| Supabase-Session | `^sb-[a-z0-9]+-auth-token(\.\d+)?$` | cookie | necessary | nach dem Login |
| PKCE-Verifier | `^sb-[a-z0-9]+-auth-token-code-verifier$` | cookie | necessary | während des Apple-Logins |
| Karte (eigener Dienst, ADR 016) | – | kein Speicher | necessary | Karten- und Detailseiten |

- Die Dauer steht je Eintrag im Inventar und wird im E2E gegen das tatsächliche Ablaufdatum geprüft.
- Vor einer Nutzeraktion setzt die Seite **kein** Cookie; anonyme Antworten tragen kein `Set-Cookie`.

### Kein Sprach-Cookie
- `localeCookie: false` in `web/i18n/routing.ts`. Die Sprache steht immer in der URL (`localePrefix: "always"`), der Sprachumschalter wechselt die URL.
- `/` wählt nach `Accept-Language` und antwortet mit `Vary: Accept-Language` und `Cache-Control: private`, damit der Redirect nicht ohne `Vary` in einem geteilten Cache landet (H4).
- Vorteil: Datensparsamkeit, kein Klassifizierungsstreit, kein `Set-Cookie` mehr auf anonymen Antworten.

### Seite „Cookie-Einstellungen“
- Route `/{lang}/cookies`, im Footer neben Impressum, Datenschutz, Nutzungsbedingungen, Richtlinien und Datenquellen.
- Rendert das Inventar in 4 Sprachen (Zweck, Anbieter, Dauer, Kategorie), dazu den Satz, dass derzeit nur notwendige Speicher laufen und deshalb nichts abgefragt wird.
- `noindex`, solange die Datenschutztexte Platzhalter sind; öffentlich, ohne Session gerendert. Der erläuternde Text ist als Platzhalter markiert.

### Vorbereiteter Einwilligungs-Vertrag
Gilt erst, wenn ein Eintrag `optional` wird. In M9 gibt es keinen Banner-Code.
- **Cookie `revier_consent`:** Inhalt `{ v: <Version>, c: [<Kategorien>], t: <ISO UTC> }` (base64url), `Path=/`, `SameSite=Lax`, `Secure`, nicht `httpOnly` (der Client muss vor dem Laden entscheiden). Es ist selbst notwendig und kommt dann ins Inventar. Laufzeit klärt der Anwalt.
- **Regeln:**
  - Vor der Einwilligung lädt nichts Optionales: kein Skript, kein Request, kein Speicher.
  - Ablehnen ist so einfach wie Zustimmen (gleiche Ebene, gleiche Gestaltung).
  - Widerruf jederzeit auf `/cookies`; nach dem Widerruf werden die optionalen Speicher gelöscht.
  - Eine neue Version (`v`) oder neue Kategorie fragt erneut.
  - Die Einwilligung gilt je Browser, nicht je Konto. Ein serverseitiger Nachweis (Art. 7 Abs. 1 DSGVO) ist Anwaltsfrage.
- **Kategorien** werden erst mit dem ersten optionalen Eintrag festgelegt. Wechselt der Kachelanbieter zu einem eigenen Verantwortlichen oder außerhalb der EU, wird die Karte optional und lädt erst nach Einwilligung (ADR 016).

### Guard-Test (Vitest)
- Schlägt fehl, sobald ein Eintrag `optional` ist und kein Banner existiert (Komponente vorhanden und im Root-Layout eingebunden).
- Prüft, dass jedes Muster mit `^` beginnt und mit `$` endet.

### Nachweis von Akzeptanz b: E2E-Inventar (Review A10)
- **Seiten:** anonym Startseite, Liste, Karte, Detail, Anbieter, Rechtstexte, `/cookies` und Login; angemeldet Konto, Chat, Suchaufträge, Export, Löschen und Admin. Die Seiten aus M9b (Verifizierung, Melden, Entscheidungen, Admin-Meldungen) kommen mit M9b dazu.
- **Gesammelt** werden `context.cookies()`, die `Set-Cookie`-Header **aller** Antworten (auch Redirects, `/api/*`, Fehlerseiten), `localStorage`, `sessionStorage`, `indexedDB.databases()`, `caches.keys()` und `navigator.serviceWorker.getRegistrations()`.
- Alles muss einem Inventareintrag entsprechen und `necessary` sein. Dazu keine Requests an fremde Origins (erlaubt sind die eigene Origin und die Supabase-URL; die CSP bleibt `self` plus Supabase).
- **Selbsttest:** Ein künstlich gesetztes, nicht inventarisiertes Cookie lässt den Test fehlschlagen.
- Der Test läuft auch gegen eine `BASE_URL` (Stage, Produktion), weil CI Hosting- und CDN-Cookies (Bot-Schutz, Preview-Toolbars) nicht sieht.

## Alternativen
- **Banner schon jetzt:** fragt etwas ab, das es nicht gibt, und gewöhnt an Wegklicken.
- **`NEXT_LOCALE` als „notwendig“ einstufen:** vermeidbar, weil die Sprache in der URL steht.
- **Inventar nur als Text auf der Seite:** Seite und Wirklichkeit liefen auseinander; der Test hätte keine Quelle.

## Folgen
- **`docs/WEB-RELEASE.md` existiert noch nicht.** M10 legt die Checkliste an; Pflichtpunkt dort: „E2E-Cookie-Inventar gegen Stage und Produktion (`BASE_URL`) grün, inklusive Hosting- und CDN-Cookies“.
- Jede neue Abhängigkeit, die Speicher im Browser nutzt, braucht einen Inventareintrag; der E2E fällt sonst.
- iOS setzt keine Cookies; Speicher auf dem Gerät gehören ins Privacy Manifest (I7).
- Die Datenschutzerklärung (Platzhalter) verweist auf `/cookies` und nennt die Karte als eigenen Dienst.
