import { getTranslations } from "next-intl/server";
import { ErrorState } from "@/components/ui/ErrorState";
import { ui } from "@/components/ui/styles";
import { Link } from "@/i18n/navigation";

// 403 (ADR 014): für forbidden() im Admin-Bereich; Next setzt noindex und den Status.
export default async function Forbidden() {
  const t = await getTranslations("Admin.forbidden");
  return (
    <main id="main" className="mx-auto w-full max-w-2xl flex-1 px-4 py-8 sm:px-6 sm:py-12">
      <ErrorState
        code="403"
        title={<h1 className={`${ui.headingCaps} text-2xl leading-tight [overflow-wrap:anywhere] hyphens-auto sm:text-3xl`}>{t("title")}</h1>}
        text={<p>{t("text")}</p>}
      >
        <Link href="/" className={ui.btnPrimary}>{t("backHome")}</Link>
      </ErrorState>
    </main>
  );
}
