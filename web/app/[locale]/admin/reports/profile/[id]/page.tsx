import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import type { AppLocale } from "@/i18n/routing";
import { requireAdmin } from "@/lib/services/admin";
import { ReportTargetPage } from "../../ReportTargetPage";

// Meldungen zu einem Profil (ADR 020). Status und CSP setzt der Proxy (ADR 014).
export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Admin.reports");
  return { title: t("detailMetaTitle"), robots: { index: false, follow: false } };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

type Props = { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function AdminProfileReportsPage(props: Props) {
  const locale = (await getLocale()) as AppLocale;
  const [{ id }, query] = await Promise.all([props.params, props.searchParams]);
  await requireAdmin(locale, `/${locale}/admin/reports/profile/${UUID.test(id) ? id : ""}`);
  if (!UUID.test(id)) notFound();
  return <ReportTargetPage locale={locale} type="profile" id={id} query={query} />;
}
