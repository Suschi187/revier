import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";

export default async function NotFound() {
  const t = await getTranslations("NotFound");
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-12">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      <Link href="/" className="mt-4 inline-block underline">
        {t("backHome")}
      </Link>
    </main>
  );
}
