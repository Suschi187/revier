import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { CodeForm, EnrollTotp } from "@/components/admin/TotpForms";
import type { AppLocale } from "@/i18n/routing";
import { safeNextPath } from "@/lib/auth/paths";
import { requireAdminRole, verifiedTotpFactor } from "@/lib/services/admin";
import { confirmTotp, startEnrollment } from "./actions";

// `instant = false` nimmt die Seite aus der Instant-Navigation-Prüfung, damit sie die Session ohne
// Suspense-Grenze liest. Den Status (403, Login) setzt der Proxy; die Prüfung hier autorisiert nur und kann
// den schon gesendeten Status nicht mehr ändern (ADR 014, QA M4 F1).
// Rendern legt nie einen Faktor an (Review B3).
export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Admin.mfa");
  return { title: t("metaTitle"), robots: { index: false, follow: false } };
}

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function AdminMfaPage({ searchParams }: Props) {
  const locale = (await getLocale()) as AppLocale;
  const query = await searchParams;
  const user = await requireAdminRole(locale, `/${locale}/admin/mfa`);
  const requested = safeNextPath(query.next, locale);
  const next = requested.startsWith(`/${locale}/admin`) ? requested : `/${locale}/admin`;
  if (user.aal2) redirect(next);

  const [t, factor] = await Promise.all([getTranslations("Admin.mfa"), verifiedTotpFactor()]);
  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-4 py-12">
      <h1 className="text-3xl font-semibold">{t("title")}</h1>
      <p className="mt-3">{t("intro")}</p>
      {query.error === "code" && (
        <p role="alert" className="mt-4 text-red-800">
          {t("errors.code")}
        </p>
      )}
      {factor ? (
        <CodeForm action={confirmTotp} locale={locale} factorId={factor.id} next={next} />
      ) : (
        <EnrollTotp start={startEnrollment} confirm={confirmTotp} locale={locale} next={next} />
      )}
    </main>
  );
}
