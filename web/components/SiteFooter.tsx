import { getTranslations } from "next-intl/server";
import { Logo } from "@/components/brand/Logo";
import { ui } from "@/components/ui/styles";
import { Link } from "@/i18n/navigation";

// CLAUDE.md: Impressum und Datenschutz sind von jeder Seite erreichbar (QA M2 F3); dazu Cookie-Einstellungen und
// Datenquellen (ADR 021, Plan M9 5).
const LINKS = [
  ["/imprint", "imprint.title"],
  ["/privacy", "privacy.title"],
  ["/terms", "terms.title"],
  ["/guidelines", "guidelines.title"],
  ["/cookies", "cookies.title"],
  ["/sources", "sources.title"],
] as const;

export async function SiteFooter() {
  const t = await getTranslations("Legal");
  return (
    <footer className="on-dark mt-auto bg-forest text-offwhite">
      <div className={`${ui.container} flex flex-wrap items-center gap-x-10 gap-y-5 py-8`}>
        <Logo onDark compact />
        <nav aria-label={t("footerLabel")}>
          <ul className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
            {LINKS.map(([href, key]) => (
              <li key={href}>
                <Link href={href} className="text-offwhite underline underline-offset-2 hover:text-brand">
                  {t(key)}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </footer>
  );
}
