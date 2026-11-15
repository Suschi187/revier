import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { Icon, type IconName } from "@/components/ui/Icon";
import { ui } from "@/components/ui/styles";
import { Link } from "@/i18n/navigation";
import type { AppLocale } from "@/i18n/routing";
import { requireOnboardedUser } from "@/lib/services/gate";
import { getOwnProfile } from "@/lib/services/profile";

// Inhalt ohne Suspense-Grenze, damit der Weg zu „Meine Anzeigen“ ohne JavaScript sichtbar ist (QA M3 F1);
// `instant = false` erlaubt das Lesen der Session außerhalb einer Grenze.
export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Account");
  return { title: t("metaTitle"), robots: { index: false, follow: false } };
}

export default async function AccountPage() {
  const t = await getTranslations("Account");
  return (
    <main id="main" className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6">
      <h1 className="font-display text-2xl font-extrabold uppercase leading-tight [overflow-wrap:anywhere] hyphens-auto sm:text-3xl">{t("title")}</h1>
      <AccountContent />
    </main>
  );
}

async function AccountContent() {
  const locale = (await getLocale()) as AppLocale;
  const user = await requireOnboardedUser(locale, `/${locale}/account`);
  const [profile, t, tc] = await Promise.all([getOwnProfile(user.id), getTranslations("Account"), getTranslations("Chat")]);
  if (!profile) throw new Error("Profil nicht verfügbar");

  const main: [string, IconName, string][] = [
    ["/account/listings", "list", t("myListings")],
    ["/account/messages", "message", tc("title")],
    ["/account/favorites", "bookmark", t("favorites")],
    ["/account/searches", "bell", t("savedSearches")],
  ];
  const more: [string, IconName, string][] = [
    ["/account/verification", "shield", t("verificationLink")],
    ["/account/blocked", "block", tc("blocked.link")],
    ["/account/reports", "flag", t("myReports")],
    ["/account/decisions", "scale", t("decisions")],
    ["/account/data", "download", t("dataExport")],
    ["/account/delete", "trash", t("deleteAccount")],
  ];

  return (
    <div className="mt-6 grid gap-6 lg:grid-cols-[20rem_minmax(0,1fr)] lg:items-start">
      <section aria-label={t("displayName")} className={`${ui.card} flex flex-col gap-4 p-5`}>
        <div className="flex items-center gap-3">
          <span aria-hidden="true" className="flex size-12 shrink-0 items-center justify-center rounded-full bg-olive font-semibold text-offwhite">
            {profile.displayName.slice(0, 2).toUpperCase()}
          </span>
          <p className="min-w-0 font-semibold [overflow-wrap:anywhere]">{profile.displayName}</p>
        </div>
        {/* Eingeloggte Adresse sichtbar machen (Login-CSRF, ADR 010). */}
        <p className="text-sm text-muted [overflow-wrap:anywhere]">{t("signedInAs", { email: user.email ?? "–" })}</p>
        <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-sm">
          <dt className="text-muted">{t("accountType")}</dt>
          <dd className="font-semibold">
            {t(`accountTypes.${profile.accountType}`)}
            {profile.businessName ? ` (${profile.businessName})` : ""}
          </dd>
          <dt className="text-muted">{t("verification")}</dt>
          <dd className="font-semibold">{t(`verificationStatus.${profile.verificationStatus}`)}</dd>
        </dl>
        <Link href="/account/profile" className={ui.btnSecondary}>
          <Icon name="edit" size={16} />
          {t("editProfile")}
        </Link>
      </section>

      <div className="flex flex-col gap-6">
        <nav aria-label={t("title")}>
          <ul className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {main.map(([href, icon, label]) => (
              <li key={href}>
                <Link href={href} className={`${ui.card} flex h-full flex-col items-start gap-3 p-4 font-semibold text-forest no-underline hover:border-forest`}>
                  <span className="flex size-11 items-center justify-center rounded-full bg-sand"><Icon name={icon} size={22} /></span>
                  <span className="[overflow-wrap:anywhere] hyphens-auto">{label}</span>
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <ul className={`${ui.card} divide-y divide-sand`}>
          {more.map(([href, icon, label]) => (
            <li key={href}>
              <Link href={href} className="flex min-h-12 items-center gap-3 px-4 py-2.5 text-forest no-underline hover:bg-offwhite">
                <Icon name={icon} size={20} className="shrink-0 text-muted" />
                <span className="flex-1 [overflow-wrap:anywhere]">{label}</span>
                <Icon name="chevron" size={18} className="shrink-0 text-muted" />
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
