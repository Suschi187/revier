import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import type { AppLocale } from "@/i18n/routing";
import { requireAdmin } from "@/lib/services/admin";
import { countPendingListings } from "@/lib/services/moderation";

// `instant = false` nimmt die Seite aus der Instant-Navigation-Prüfung, damit sie die Session ohne
// Suspense-Grenze liest. Den Status (403, Login) setzt der Proxy; die Prüfung hier autorisiert nur und kann
// den schon gesendeten Status nicht mehr ändern (ADR 014, QA M4 F1).
export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Admin.overview");
  return { title: t("metaTitle"), robots: { index: false, follow: false } };
}

export default async function AdminPage() {
  const locale = (await getLocale()) as AppLocale;
  const me = await requireAdmin(locale, `/${locale}/admin`);
  const [t, pending] = await Promise.all([getTranslations("Admin.overview"), countPendingListings(me.id)]);
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-12">
      <h1 className="text-3xl font-semibold">{t("title")}</h1>
      <p className="mt-4">{t("pending", { count: pending })}</p>
      <Link href="/admin/listings" className="mt-2 block underline">
        {t("queueLink")}
      </Link>
      <Link href="/admin/audit" className="mt-2 block underline">
        {t("auditLink")}
      </Link>
      <Link href="/admin/admins" className="mt-2 block underline">
        {t("adminsLink")}
      </Link>
    </main>
  );
}
