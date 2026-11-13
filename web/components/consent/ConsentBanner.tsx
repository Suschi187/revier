import { useTranslations } from "next-intl";
import { ui } from "@/components/ui/styles";
import { Link } from "@/i18n/navigation";

/**
 * Gestaltung des Einwilligungs-Banners (ADR 021, SPEC M10a Schritt 3). Derzeit nur im Styleguide: Solange alle
 * Einträge im Inventar notwendig sind, gibt es nichts abzufragen. Mit dem ersten optionalen Eintrag kommen Cookie
 * `revier_consent`, Speichern und Widerruf dazu, und der Banner wird im Root-Layout eingebunden (Guard-Test in
 * `lib/consent/inventory.test.ts`). Ablehnen und Zustimmen sind gleichrangig und gleich gestaltet.
 */
export function ConsentBanner({ preview = false }: { preview?: boolean }) {
  const t = useTranslations("Cookies.banner");
  const tl = useTranslations("Legal.cookies");
  return (
    <section
      aria-labelledby="consent-title"
      className={`${preview ? "" : "fixed inset-x-0 bottom-0 z-50 "}on-dark border-t-4 border-brand bg-forest text-offwhite`}
    >
      <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-5 sm:px-6 lg:flex-row lg:items-center lg:gap-8">
        <div className="flex-1">
          <h2 id="consent-title" className={`${ui.headingCaps} text-lg`}>{t("title")}</h2>
          <p className="mt-1 text-sm leading-relaxed">
            {t("text")}{" "}
            <Link href="/cookies" className="font-semibold underline underline-offset-2">{tl("title")}</Link>
          </p>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:shrink-0">
          <button type="button" className={`${ui.btnPrimaryText} min-w-44`}>{t("reject")}</button>
          <button type="button" className={`${ui.btnPrimaryText} min-w-44`}>{t("accept")}</button>
        </div>
      </div>
    </section>
  );
}
