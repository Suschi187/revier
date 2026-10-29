# ADR 010: Anmeldung, Session und AGB-Zustimmung (Web)

Status: angenommen (M2)

## Kontext
SPEC 4.4/6 M2: Das Web nutzt E-Mail/Magic Link und Sign in with Apple, Sessions laufen über `@supabase/ssr`, und die AGB-Zustimmung ist Pflicht. iOS (I1) nutzt dasselbe Backend und muss dieselben Regeln einhalten. Der Plan wurde vor M2 vom Architekten geprüft.

## Entscheidung

### Anmeldung ohne Passwort
- Registrieren und Anmelden sind derselbe Ablauf: `signInWithOtp({ email, shouldCreateUser: true })`. Die Seite antwortet immer gleich, auch bei Rate-Limit, gesperrten Konten oder ungültigen Adressen, damit niemand Konten erraten kann.
- Die Mail enthält einen Link und einen 6-stelligen Code.
- Gültigkeit 10 Minuten (`otp_expiry = 600`), neue Mail frühestens nach 60 s.
- Keine Passwörter: kein Reset-Ablauf, kein Leak-Risiko. `minimum_password_length = 10` steht nur für die Checkliste.
- `enable_confirmations = true`: Neue Nutzer bekommen die Vorlage `confirmation`, bestehende die Vorlage `magic_link`. Beide Vorlagen bauen den Link gleich (`type=email`), und beide Pfade sind per E2E getestet.

### Wo die Aufrufe laufen
- Code anfordern (`signInWithOtp`) und Code prüfen (`verifyOtp` mit `email` und `token`) laufen **im Browser** über `createBrowserClient` mit dem öffentlichen Key.
  - Grund: Liefen sie über den Web-Server, sähe Supabase Auth nur dessen IP. Alle Nutzer teilten sich dann die Limits (DoS), und es gäbe keine Drosselung pro Angreifer.
  - Ein Captcha-Token lässt sich später ebenso im Browser mitgeben.
- Der Link führt auf `/{locale}/auth/confirm?token_hash=…&type=…&next=…`.
  - **GET prüft nichts.** Die Seite zeigt nur den Button „Anmeldung bestätigen“. Mail-Scanner (Safe Links, Proofpoint) öffnen Links vorab und würden das Einmal-Token sonst verbrauchen.
  - Erst der Klick löst eine Server Action (POST) mit `verifyOtp({ type, token_hash })` aus und leitet dann weiter, sodass das Token aus URL und Verlauf verschwindet.
  - Die Seite ist `noindex`, sendet `Referrer-Policy: no-referrer` und lädt keine Fremdressourcen.
  - Ist der Link schon verbraucht, bleibt der Code als Ausweg.
- Apple: OAuth mit PKCE über `/{locale}/auth/callback` (`exchangeCodeForSession`).
  - Gestartet wird per GET-Link auf einen Route Handler, nicht per Formular-POST. Sonst würde CSP `form-action` den Redirect blockieren.
  - Der Button ist hinter `NEXT_PUBLIC_AUTH_APPLE_ENABLED` versteckt, solange kein Apple-Developer-Account existiert (SPEC 7.1).

### Rücksprungziel (`next`)
- Erlaubt sind nur Pfade, die mit `/{locale}/` beginnen, derselben Origin und aus einer Allowlist interner Präfixe.
- Abgelehnt werden `//`, `\`, kodierte Schrägstriche/Backslashes, Steuerzeichen und Schemata. Sonst geht es nach `/{locale}/account`.
- Das gilt für Login, Confirm, Callback und Logout und ist per Vitest geprüft.

### Session
- `proxy.ts` erzeugt zuerst die next-intl-Response, dann den Supabase-Client.
  - `setAll` schreibt auf die Request-Cookies **und** auf die Response, danach folgt `getClaims()`.
  - Gesetzte Cookies werden auch auf jede Redirect-Response kopiert. Wegen der Rotation der Refresh-Tokens ginge die Session sonst verloren.
  - Antworten mit `Set-Cookie` tragen `Cache-Control: private, no-store`.
- Ohne `sb-*`-Cookie überspringt der Proxy Supabase ganz. Das hält anonymen Traffic schnell.
- Das JWT wird mit ES256 signiert, lokal ist das Standard.
  - `getClaims()` prüft es lokal per JWKS, also ohne Netzwerkaufruf pro Request.
  - In der Cloud müssen asymmetrische Signing Keys aktiv sein (Checkliste ADR 005).
- Regel im Auth-Service:
  - `getClaims()` genügt für Lesen und Navigation, denn Rechte entscheidet ohnehin RLS. Logout, Sperre und Löschung wirken dabei erst nach Ablauf des JWT (`jwt_expiry` 3600 s).
  - Für sicherheitskritische Aktionen (`/admin` M4, Account löschen M9) wird `getUser()` aufgerufen.
- Der Proxy schützt nur optimistisch, autoritativ prüft das Layout der geschützten Routen auf dem Server.
  - Diese Routen rendern dynamisch.
  - Ihre statische Hülle enthält keine Nutzerdaten.
- Logout ist eine Server Action (POST mit Origin-Prüfung durch Next) mit `signOut({ scope: 'local' })`.
- Cookies sind `sameSite=lax`, in Produktion `secure`.
  - Sie sind nicht `httpOnly`, weil der Browser-Client (OTP, ab M7 Realtime) die Session braucht.
  - Abgesichert ist das über die CSP und eine kurze JWT-Laufzeit.

### AGB-Zustimmung
- Tabelle `public.legal_acceptances (user_id, document, version, source, accepted_at)`.
  - Mögliche Dokumente sind `terms` (Zustimmung) und `privacy` (zur Kenntnis genommen, Art. 13, keine Einwilligung).
  - Lesen dürfen der Nutzer selbst und Admins. Schreiben geht nur über die RPC `accept_legal(p_terms_version, p_privacy_version, p_source)`.
  - Die RPC prüft gegen die aktuellen Versionen in `private.app_settings`. Sie ist idempotent, eine neue Version löst eine neue Zustimmung aus.
- `legal_status()` liefert die aktuellen Versionen und ob der Nutzer zugestimmt hat.
  - Die Seite zeigt genau diese Versionen an und schickt sie zurück.
- UI-Gate: Nach dem Login fehlt die Zustimmung zur aktuellen Version, also geht es nach `/{locale}/welcome`.
  - Dort werden Anzeigename, Kontotyp, Land und Sprache abgefragt, dazu das Häkchen.
  - Reihenfolge: Profil speichern, dann `accept_legal`.
  - Es gibt keine Spalte `onboarded_at`.
- DB-Gate: `private.has_accepted_current_legal()` wird in M2 angelegt und getestet.
  - Ab M3 nutzen es die Insert-Policies und Status-Trigger der Anzeigen, ab M7 Chat und Nachrichten.
  - Meldungen sind bewusst nicht daran gebunden (DSA: Melden bleibt niedrigschwellig).
- Die Texte bleiben Platzhalter, bis der Anwalt liefert (SPEC 7.2).

### Mails
- Lokale Vorlagen liegen in `supabase/templates/`.
  - Sie wählen die Sprache über `{{ .Data.preferred_language }}` (aus `user_metadata`, nur zur Anzeige, nie für Rechte; ADR 005), Fallback de.
  - Die Link-Sprache kommt aus `{{ .RedirectTo }}`, also aus der UI-Locale beim Anfordern.
- Ändert jemand die Sprache im Profil, wird sie per `auth.updateUser({ data })` auch in `user_metadata` geschrieben.
- Cloud-Vorlagen und -Einstellungen werden nicht aus `config.toml` übernommen und gehören in die Cloud-Checkliste.
- Ein Send-Email-Hook mit EU-Mailanbieter folgt erst mit SPEC 7.11.

### CSP
- Feste CSP in `next.config.ts` ohne Nonce. Eine Nonce erzwingt dynamisches Rendering, und die vorgerenderte Hülle von `cacheComponents` enthält Inline-Skripte ohne Nonce.
  - `script-src 'self' 'unsafe-inline'`, im Dev-Modus zusätzlich `'unsafe-eval'`.
  - `connect-src` erlaubt Supabase per https und wss.
  - Außerdem `frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'self'` und `form-action 'self'`.
- Eine Nonce-CSP mit `strict-dynamic` kommt zuerst für `/admin` in M4, der Rest wird in M10 neu bewertet.

### URLs
- `/{locale}/login`, `/welcome`, `/account`, `/account/profile`, `/auth/confirm`, `/auth/callback`: feste Slugs, `noindex`.
- Lokalisierte Pfadnamen folgen in M5 für die SEO-Seiten.

## Alternativen
- **Passwort zusätzlich:** bringt einen Reset-Ablauf und Leak-Risiko, aber keinen Nutzen.
- **OTP über Server Actions:** Die Rate-Limits teilen sich dann alle Nutzer (siehe oben).
- **Token-Prüfung direkt per GET:** Mail-Scanner verbrauchen den Link.
- **Zustimmung als Profilspalte:** keine Historie, kein Re-Consent je Version.
- **Nur UI-Gate:** API und iOS würden es umgehen.

## Folgen
- Bis zur Einführung der Captcha sind die Rate-Limits von Supabase der einzige Schutz. Die Captcha ist harter Punkt der Liste vor dem Go-live.
- Bis M4 gilt `unsafe-inline` in `script-src`.
- Account löschen, E-Mail ändern und Datenexport folgen in M9. Bis dahin ist die UGC-Pflicht offen (CHANGELOG).
- Cloud-Checkliste (ergänzt ADR 005):
  - asymmetrische Signing Keys
  - OTP-Gültigkeit und Mail-Abstand
  - Redirect-URLs aller Locales für `/*/auth/confirm` und `/*/auth/callback`
  - beide Mail-Vorlagen
  - eigenes SMTP mit EU-Anbieter
  - Apple-Provider mit registrierter Absenderdomain für Private Relay
