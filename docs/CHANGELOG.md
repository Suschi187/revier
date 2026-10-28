# Changelog

Pro Backlog-Schritt ein Eintrag: was geändert wurde, wie man es testet, bekannte Lücken.

## M0 Fundament (in Arbeit)
- `.gitignore` um Build-, Test- und Secret-Muster ergänzt
- Doku-Gerüst: `CHANGELOG.md`, `GLOSSARY.md`, ADRs 001–004
- Web-Grundgerüst: Next.js 16.4.1, TypeScript strict, Tailwind 4, ESLint, Vitest, Node 24 LTS
- i18n mit next-intl 4.14.9:
  - `/` leitet auf `/de` um, bei passendem `Accept-Language` auf die erkannte Sprache
  - lokalisierte Startseite und 404
  - `hreflang`, Canonical, Sprachumschalter
  - Test prüft gleiche Keys in allen Sprachen
  - Lücke: cs/pl-Texte sind maschinennah formuliert und von Muttersprachlern ungeprüft (SPEC 7.6)
