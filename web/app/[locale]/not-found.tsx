import { getLocale, getTranslations } from "next-intl/server";
import { ErrorState } from "@/components/ui/ErrorState";
import { ui } from "@/components/ui/styles";
import { Link } from "@/i18n/navigation";
import type { AppLocale } from "@/i18n/routing";
import { publicPath } from "@/lib/public/paths";

export default async function NotFound() {
  const [t, tg, locale] = await Promise.all([getTranslations("NotFound"), getTranslations("Public.gone"), getLocale()]);
  return (
    <main id="main" className="mx-auto w-full max-w-2xl flex-1 px-4 py-8 sm:px-6 sm:py-12">
      <ErrorState
        code="404"
        title={<h1 className={`${ui.headingCaps} text-2xl leading-tight [overflow-wrap:anywhere] hyphens-auto sm:text-3xl`}>{t("title")}</h1>}
      >
        <Link href="/" className={ui.btnPrimary}>{t("backHome")}</Link>
        <a href={publicPath({ route: "search" }, locale as AppLocale)} className={ui.btnSecondary}>{tg("toSearch")}</a>
      </ErrorState>
    </main>
  );
}
