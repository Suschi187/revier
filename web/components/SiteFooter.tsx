import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";

// CLAUDE.md: Impressum und Datenschutz sind von jeder Seite erreichbar (QA M2 F3).
export async function SiteFooter() {
  const t = await getTranslations("Legal");
  return (
    <footer className="mt-auto border-t border-neutral-300 p-4">
      <nav aria-label={t("footerLabel")}>
        <ul className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
          <li>
            <Link href="/imprint" className="underline">
              {t("imprint.title")}
            </Link>
          </li>
          <li>
            <Link href="/privacy" className="underline">
              {t("privacy.title")}
            </Link>
          </li>
          <li>
            <Link href="/terms" className="underline">
              {t("terms.title")}
            </Link>
          </li>
        </ul>
      </nav>
    </footer>
  );
}
