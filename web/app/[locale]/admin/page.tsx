import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { Icon, type IconName } from "@/components/ui/Icon";
import { ui } from "@/components/ui/styles";
import { Link } from "@/i18n/navigation";
import type { AppLocale } from "@/i18n/routing";
import { requireAdmin } from "@/lib/services/admin";
import { countOpenAppeals, countOpenReports } from "@/lib/services/admin-reports";
import { countPendingVerifications } from "@/lib/services/admin-verifications";
import { countPendingListings, countStuckDeletions } from "@/lib/services/moderation";

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
  const [t, pending, verifications, reports, appeals, stuck] = await Promise.all([
    getTranslations("Admin.overview"),
    countPendingListings(me.id),
    countPendingVerifications(me.id),
    countOpenReports(),
    countOpenAppeals(),
    countStuckDeletions(),
  ]);
  // Kacheln mit offenen Vorgängen; was wartet, ist orange umrandet. Hängende Löschungen nur als Anzahl (ADR 019).
  const queues: [string, IconName, string, string, number][] = [
    ["/admin/listings", "list", t("queueLink"), t("pending", { count: pending }), pending],
    ["/admin/verifications", "shield", t("verificationsLink"), t("verificationsPending", { count: verifications }), verifications],
    ["/admin/reports", "flag", t("reportsLink"), t("reportsOpen", { count: reports }), reports],
    ["/admin/appeals", "scale", t("appealsLink"), t("appealsOpen", { count: appeals }), appeals],
  ];
  const tools: [string, IconName, string][] = [
    ["/admin/users", "user", t("usersLink")],
    ["/admin/audit", "edit", t("auditLink")],
    ["/admin/admins", "lock", t("adminsLink")],
  ];
  return (
    <main id="main" className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6">
      <h1 className="font-display text-2xl font-extrabold uppercase leading-tight [overflow-wrap:anywhere] hyphens-auto sm:text-3xl">{t("title")}</h1>
      {stuck !== null && stuck > 0 && (
        <p className="mt-4 rounded-card border border-error bg-error-soft p-3 font-semibold text-error" role="status">{t("stuckDeletions", { count: stuck })}</p>
      )}
      <ul className="mt-6 grid gap-4 sm:grid-cols-2">
        {queues.map(([href, icon, label, text, count]) => (
          <li key={href}>
            <Link href={href} className={`${ui.card} flex h-full items-start gap-4 p-5 no-underline hover:bg-sand/40 ${count > 0 ? "border-brand" : ""}`}>
              <span aria-hidden="true" className={`flex size-11 shrink-0 items-center justify-center rounded-full ${count > 0 ? "bg-brand text-forest" : "bg-sand text-forest"}`}>
                <Icon name={icon} size={22} />
              </span>
              <span className="min-w-0">
                <span className="block font-display font-bold text-forest underline underline-offset-2 [overflow-wrap:anywhere]">{label}</span>
                <span className="mt-1 block text-sm text-forest">{text}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
      <ul className={`${ui.card} mt-6 divide-y divide-sand`}>
        {tools.map(([href, icon, label]) => (
          <li key={href}>
            <Link href={href} className="flex min-h-11 items-center gap-3 px-5 py-3 font-semibold text-forest no-underline hover:bg-sand/40">
              <Icon name={icon} size={20} />
              <span className="underline underline-offset-2">{label}</span>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
