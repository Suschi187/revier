import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { PlaceholderNote } from "@/components/legal/LegalOutline";
import { Link } from "@/i18n/navigation";
import { localeAlternates } from "@/i18n/metadata";
import type { AppLocale } from "@/i18n/routing";
import { CONSENT_INVENTORY, consentRequired } from "@/lib/consent/inventory";

// Cookie-Einstellungen (ADR 021): rendert das Inventar, ohne Session und ohne Abfrage. Solange nur Notwendiges
// läuft, gibt es nichts einzustellen; der erläuternde Text ist Platzhalter, deshalb noindex.
export async function generateMetadata(): Promise<Metadata> {
  const locale = (await getLocale()) as AppLocale;
  const t = await getTranslations("Legal.cookies");
  return { title: t("title"), robots: { index: false, follow: true }, alternates: localeAlternates(locale, "/cookies") };
}

export default async function CookiesPage() {
  const t = await getTranslations("Cookies");
  const tl = await getTranslations("Legal");
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-12">
      <h1 className="text-3xl font-semibold">{tl("cookies.title")}</h1>
      <PlaceholderNote />
      <p className="mt-4">{t("intro")}</p>
      <p className="mt-2 font-medium">{consentRequired() ? t("optionalPresent") : t("onlyNecessary")}</p>
      {/* Bei 360 px scrollt die Tabelle waagerecht; der Container ist dafür per Tastatur erreichbar (QA M9a F5). */}
      <div className="mt-6 overflow-x-auto" tabIndex={0} role="region" aria-label={t("tableCaption")}>
        <table className="w-full min-w-[40rem] border-collapse text-left text-sm">
          <caption className="sr-only">{t("tableCaption")}</caption>
          <thead>
            <tr className="border-b border-neutral-400">
              <th scope="col" className="py-2 pr-4">{t("columns.name")}</th>
              <th scope="col" className="py-2 pr-4">{t("columns.purpose")}</th>
              <th scope="col" className="py-2 pr-4">{t("columns.provider")}</th>
              <th scope="col" className="py-2 pr-4">{t("columns.duration")}</th>
              <th scope="col" className="py-2 pr-4">{t("columns.kind")}</th>
              <th scope="col" className="py-2">{t("columns.category")}</th>
            </tr>
          </thead>
          <tbody>
            {CONSENT_INVENTORY.map((entry) => (
              <tr key={entry.id} className="border-b border-neutral-200 align-top">
                <th scope="row" className="py-2 pr-4 font-medium">{t(`entries.${entry.id}.name`)}</th>
                <td className="py-2 pr-4">{t(`entries.${entry.id}.purpose`)}</td>
                <td className="py-2 pr-4">{t(`entries.${entry.id}.provider`)}</td>
                <td className="py-2 pr-4">{t(`entries.${entry.id}.duration`)}</td>
                <td className="py-2 pr-4">{t(`kinds.${entry.kind ?? "none"}`)}</td>
                <td className="py-2">{t(`categories.${entry.category}`)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-6">{t("noThirdParties")}</p>
      <p className="mt-6">
        <Link href="/privacy" className="underline">
          {tl("privacy.title")}
        </Link>
      </p>
    </main>
  );
}
