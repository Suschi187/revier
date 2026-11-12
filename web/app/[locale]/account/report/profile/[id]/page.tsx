import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import type { AppLocale } from "@/i18n/routing";
import { requireSessionUser } from "@/lib/services/auth";
import { reportableTarget } from "@/lib/services/reports";
import { ReportForm } from "../../ReportForm";

// Melden (ADR 020): Das Ziel steht im Pfad, damit der Login-Rücksprung es behält (wie Review A2 im Chat). Ohne
// Legal-Gate und für gesperrte Konten (Review A4).
export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Report");
  return { title: t("metaTitle"), robots: { index: false, follow: false } };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

type Props = { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function ReportProfilePage(props: Props) {
  const locale = (await getLocale()) as AppLocale;
  const [{ id }, query] = await Promise.all([props.params, props.searchParams]);
  const user = await requireSessionUser(locale, `/${locale}/account/report/profile/${UUID.test(id) ? id : ""}`);
  const target = UUID.test(id) ? await reportableTarget("profile", id, user.id) : null;
  return <ReportForm locale={locale} type="profile" target={target} error={query.error} />;
}
