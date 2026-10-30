# Glossar

Fachbegriffe müssen in Web (`web/messages/*.json`) und iOS (`Localizable.xcstrings`) identisch übersetzt sein.
en ist die Quellsprache. cs/pl-Begriffe sind **ungeprüft**, bis Muttersprachler sie freigegeben haben (SPEC 7.6).

| Code | en | de | cs | pl | Status |
|------|----|----|----|----|--------|
| `lease` | Hunting lease | Jagdpacht | Pronájem honitby | Dzierżawa obwodu łowieckiego | ungeprüft |
| `permit` | Hunting permit | Begehungsschein | Povolenka k lovu | Zezwolenie na polowanie | ungeprüft |
| `driven_hunt` | Driven hunt | Gesellschaftsjagd | Společný hon | Polowanie zbiorowe | ungeprüft |
| `trophy_hunt` | Trophy / guest hunt | Trophäen-/Gastjagd | Trofejový / hostovský lov | Polowanie trofeowe / gościnne | ungeprüft |
| `helper` | Hunting helper | Jagdhelfer/Mitjäger | Pomocník při lovu | Pomocnik myśliwego | ungeprüft |
| `offer` | Offer | Angebot | Nabídka | Oferta | ungeprüft |
| `wanted` | Wanted | Gesuch | Poptávka | Poszukiwane | ungeprüft |

## Status einer Anzeige (`listing_status`, M3)

| Code | en | de | cs | pl | Status |
|------|----|----|----|----|--------|
| `draft` | Draft | Entwurf | Koncept | Szkic | ungeprüft |
| `pending_review` | In review | In Prüfung | Ve schvalování | W weryfikacji | ungeprüft |
| `active` | Active | Aktiv | Aktivní | Aktywne | ungeprüft |
| `paused` | Paused | Pausiert | Pozastaveno | Wstrzymane | ungeprüft |
| `expired` | Expired | Abgelaufen | Vypršelo | Wygasłe | ungeprüft |
| `rejected` | Rejected | Abgelehnt | Zamítnuto | Odrzucone | ungeprüft |
| `removed` | Removed | Entfernt | Odstraněno | Usunięte | ungeprüft |
| my_listings | My listings | Meine Anzeigen | Moje inzeráty | Moje ogłoszenia | ungeprüft |
| create_listing | Create listing | Anzeige aufgeben | Podat inzerát | Dodaj ogłoszenie | ungeprüft |

## Wildarten (`game_species`)

Quelle: Migrationen `20261029100200_regions_species.sql` und `20261030090000_species_other_predators.sql`. cs/pl **ungeprüft**.

| Code | en | de | cs | pl | Status |
|------|----|----|----|----|--------|
| `roe_deer` | Roe deer | Rehwild | Srnčí zvěř | Sarna | ungeprüft |
| `red_deer` | Red deer | Rotwild | Jelení zvěř | Jeleń szlachetny | ungeprüft |
| `fallow_deer` | Fallow deer | Damwild | Dančí zvěř | Daniel | ungeprüft |
| `sika_deer` | Sika deer | Sikawild | Jelen sika | Jeleń sika | ungeprüft |
| `wild_boar` | Wild boar | Schwarzwild | Černá zvěř | Dzik | ungeprüft |
| `chamois` | Chamois | Gamswild | Kamzičí zvěř | Kozica | ungeprüft |
| `ibex` | Alpine ibex | Steinwild | Kozorožec horský | Koziorożec alpejski | ungeprüft |
| `mouflon` | Mouflon | Muffelwild | Mufloní zvěř | Muflon | ungeprüft |
| `hare` | Brown hare | Feldhase | Zajíc polní | Zając szarak | ungeprüft |
| `fox` | Red fox | Fuchs | Liška obecná | Lis | ungeprüft |
| `pheasant` | Pheasant | Fasan | Bažant obecný | Bażant | ungeprüft |
| `partridge` | Grey partridge | Rebhuhn | Koroptev polní | Kuropatwa | ungeprüft |
| `waterfowl` | Waterfowl | Wasserwild | Vodní pernatá zvěř | Ptactwo wodne | ungeprüft |
| `small_game` | Other small game | Sonstiges Niederwild | Ostatní drobná zvěř | Inna drobna zwierzyna | ungeprüft |
| `other_predators` | Other predators | Sonstiges Raubwild | Ostatní dravá zvěř | Inne drapieżniki | ungeprüft |

## Konto und Anmeldung (M2)

Werden in Web und iOS gleich verwendet. cs/pl **ungeprüft**.

| Schlüssel | en | de | cs | pl | Status |
|------|----|----|----|----|--------|
| account | Account | Konto | Účet | Konto | ungeprüft |
| display_name | Display name | Anzeigename | Zobrazované jméno | Nazwa wyświetlana | ungeprüft |
| account_type.private | Private | Privat | Soukromý | Prywatne | ungeprüft |
| account_type.business | Business | Gewerblich | Firemní | Firmowe | ungeprüft |
| business_name | Business name | Firmenname | Název firmy | Nazwa firmy | ungeprüft |
| sign_in | Sign in | Anmelden | Přihlásit se | Zaloguj się | ungeprüft |
| sign_out | Sign out | Abmelden | Odhlásit se | Wyloguj się | ungeprüft |
| login_code | Sign-in code | Anmeldecode | Přihlašovací kód | Kod logowania | ungeprüft |
| terms | Terms of use | Nutzungsbedingungen | Podmínky použití | Regulamin | ungeprüft |
| privacy_policy | Privacy policy | Datenschutzerklärung | Zásady ochrany osobních údajů | Polityka prywatności | ungeprüft |
| imprint | Legal notice | Impressum | Právní informace | Nota prawna | ungeprüft |
| account_blocked | Blocked (account, by moderation) | gesperrt | zablokovaný | zablokowane | ungeprüft |
