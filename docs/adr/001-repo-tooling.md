# ADR 001: Repo- und Tooling-Struktur

Status: angenommen (M0)

## Kontext
Web-App und iOS-App teilen nur das Supabase-Backend, keinen Code (CLAUDE.md).

## Entscheidung
- Ein Repo mit `web/`, `ios/`, `supabase/`, `docs/`, ohne Workspace-Tooling.
- Web: npm (mit Node gebündelt, keine zusätzliche Abhängigkeit), Node aktuelle LTS (mindestens 22), gepinnt über `web/.nvmrc` und `engines`.
- Next.js 16 (App Router), next-intl, Tailwind, Vitest, ESLint. Versionen exakt in `package-lock.json`.
- Supabase-CLI für die lokale Entwicklung (braucht Docker).
- iOS: Das Xcode-Projekt wird in I1 direkt in Xcode angelegt. In M0 gibt es kein iOS-Gerüst.

## Alternativen
- pnpm-/Turborepo-Workspaces: nicht nötig, weil kein Code geteilt wird.
- XcodeGen/Tuist: eine zusätzliche Abhängigkeit ohne Nutzen für ein einzelnes App-Target.

## Folgen
- Jede neue Laufzeit-Abhängigkeit wird im Commit oder per ADR begründet.
- Das Xcode-Projekt (`.xcodeproj`) wird ab I1 committet, `xcuserdata/` bleibt ignoriert.
