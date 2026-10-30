import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";

// 403 (ADR 014): für forbidden() im Admin-Bereich; Next setzt noindex und den Status.
export default async function Forbidden() {
  const t = await getTranslations("Admin.forbidden");
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-12">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      <p className="mt-3">{t("text")}</p>
      <Link href="/" className="mt-4 inline-block underline">
        {t("backHome")}
      </Link>
    </main>
  );
}
