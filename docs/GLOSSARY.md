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

## Anzeigenattribute (`attributes`, M3)

Quelle: `web/messages/*.json` (`Listings.attributes`, `Listings.options`, `Listings.priceUnits`), Schlüssel aus SPEC 3.2. iOS (I4) übernimmt diese Begriffe. cs/pl **ungeprüft**.

| Schlüssel | en | de | cs | pl | Status |
|-----------|----|----|----|----|--------|
| `lease_type` | Type of lease | Pachtart | Druh pronájmu | Rodzaj dzierżawy | ungeprüft |
| `revier_type` | Type of hunting ground | Reviertyp | Typ honitby | Typ obwodu | ungeprüft |
| `submission_deadline` | Application deadline | Abgabefrist | Termín podání | Termin składania ofert | ungeprüft |
| `lease_duration_years` | Lease term in years | Pachtdauer in Jahren | Doba pronájmu v letech | Okres dzierżawy w latach | ungeprüft |
| `shooting_plan` | Shooting plan | Abschussplan | Plán lovu | Plan odstrzału | ungeprüft |
| `hunting_hut` | Hunting lodge available | Jagdhütte vorhanden | K dispozici myslivecká chata | Dostępny domek myśliwski | ungeprüft |
| `co_lessee_slots` | Places for co-lessees | Plätze für Mitpächter | Místa pro spolunájemce | Miejsca dla współdzierżawców | ungeprüft |
| `paid` | Paid | Entgeltlich | Placené | Odpłatne | ungeprüft |
| `permit_scope` | Scope | Umfang | Rozsah | Zakres | ungeprüft |
| `season` | Season | Saison | Sezóna | Sezon | ungeprüft |
| `species_limits` | Shooting limits | Abschussgrenzen | Limity odstřelu | Limity odstrzału | ungeprüft |
| `event_date` | Date | Datum | Datum | Data | ungeprüft |
| `spots_available` | Places available | Freie Plätze | Volná místa | Wolne miejsca | ungeprüft |
| `meeting_point_description` | Meeting point | Treffpunkt | Místo srazu | Miejsce zbiórki | ungeprüft |
| `dogs_required` | Dogs required | Hunde erforderlich | Psi nutní | Wymagane psy | ungeprüft |
| `legal_ack` | I know the legal requirements for trophies, firearms and import/export. | Ich kenne die rechtlichen Voraussetzungen für Trophäen, Waffen sowie Ein- und Ausfuhr. | Znám právní požadavky na trofeje, zbraně a dovoz/vývoz. | Znam wymogi prawne dotyczące trofeów, broni oraz przywozu i wywozu. | ungeprüft |
| `trophy_details` | Trophy details | Trophäendetails | Podrobnosti o trofeji | Szczegóły trofeum | ungeprüft |
| `includes_accommodation` | Accommodation included | Mit Unterkunft | S ubytováním | Z zakwaterowaniem | ungeprüft |
| `import_export_note` | Note on import and export | Hinweis zu Ein- und Ausfuhr | Poznámka k dovozu a vývozu | Uwagi dotyczące przywozu i wywozu | ungeprüft |
| `experience_level` | Experience | Erfahrung | Zkušenosti | Doświadczenie | ungeprüft |
| `tasks` | Tasks | Aufgaben | Úkoly | Zadania | ungeprüft |

### Auswahlwerte

| Schlüssel | en | de | cs | pl | Status |
|-----------|----|----|----|----|--------|
| `lease_type.eigenjagd` | Private hunting ground | Eigenjagd | Vlastní honitba | Obwód własny | ungeprüft |
| `lease_type.genossenschaft` | Communal hunting ground | Genossenschaftsjagd | Společenstevní honitba | Obwód dzierżawny (wspólnota) | ungeprüft |
| `lease_type.pachtnachfolge` | Lease succession | Pachtnachfolge | Převzetí pronájmu | Przejęcie dzierżawy | ungeprüft |
| `lease_type.anteil` | Share of a lease | Pachtanteil | Podíl na pronájmu | Udział w dzierżawie | ungeprüft |
| `revier_type.hochwild` | Big game | Hochwild | Vysoká zvěř | Zwierzyna gruba | ungeprüft |
| `revier_type.niederwild` | Small game | Niederwild | Drobná zvěř | Zwierzyna drobna | ungeprüft |
| `revier_type.feld` | Fields | Feld | Pole | Pola | ungeprüft |
| `revier_type.wald` | Forest | Wald | Les | Las | ungeprüft |
| `revier_type.berg` | Mountains | Gebirge | Hory | Góry | ungeprüft |
| `revier_type.wasser` | Water | Wasser | Voda | Wody | ungeprüft |
| `permit_scope.selbststaendig` | Independent | Selbstständig | Samostatně | Samodzielnie | ungeprüft |
| `permit_scope.begleitet` | Accompanied | In Begleitung | S doprovodem | Z osobą towarzyszącą | ungeprüft |

### Preiseinheiten (`price_unit`)

| Code | en | de | cs | pl | Status |
|------|----|----|----|----|--------|
| `total` | total | gesamt | celkem | łącznie | ungeprüft |
| `per_year` | per year | pro Jahr | za rok | za rok | ungeprüft |
| `per_hectare_year` | per hectare and year | pro Hektar und Jahr | za hektar a rok | za hektar rocznie | ungeprüft |
| `per_day` | per day | pro Tag | za den | za dzień | ungeprüft |
| `per_animal` | per animal | pro Stück Wild | za kus zvěře | za sztukę zwierzyny | ungeprüft |

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
