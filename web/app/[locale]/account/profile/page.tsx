import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { BlockedNotice } from "@/components/profile/BlockedNotice";
import { ProfileForm } from "@/components/profile/ProfileForm";
import { ui } from "@/components/ui/styles";
import { Link } from "@/i18n/navigation";
import type { AppLocale } from "@/i18n/routing";
import { requireOnboardedUser } from "@/lib/services/gate";
import { getNotifyChatEmail, getOwnProfile } from "@/lib/services/profile";
import { saveNotifications } from "./actions";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Account.profile");
  return { title: t("metaTitle"), robots: { index: false, follow: false } };
}

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function ProfilePage(props: Props) {
  const t = await getTranslations("Account");
  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-4 py-8 sm:px-6">
      <Link href="/account" className="text-sm underline underline-offset-2">
        ← {t("profile.back")}
      </Link>
      <h1 className="mt-4 font-display text-2xl font-extrabold uppercase leading-tight [overflow-wrap:anywhere] hyphens-auto sm:text-3xl">{t("profile.title")}</h1>
      <div className={`${ui.card} mt-6 p-5 sm:p-6`}>
        <Suspense fallback={null}>
          <ProfileContent />
        </Suspense>
      </div>
      <Suspense fallback={null}>
        <NotificationSettings searchParams={props.searchParams} />
      </Suspense>
    </main>
  );
}

async function ProfileContent() {
  const locale = (await getLocale()) as AppLocale;
  const user = await requireOnboardedUser(locale, `/${locale}/account/profile`);
  const profile = await getOwnProfile(user.id);
  if (!profile) throw new Error("Profil nicht verfügbar");
  if (profile.isBlocked) return <BlockedNotice />;
  return (
    <ProfileForm
      locale={locale}
      initial={{
        displayName: profile.displayName,
        accountType: profile.accountType,
        businessName: profile.businessName ?? "",
        country: profile.country,
        preferredLanguage: profile.preferredLanguage,
      }}
    />
  );
}

/** E-Mail bei neuen Nachrichten (ADR 017). Eigenes Formular, damit das Onboarding unverändert bleibt. */
async function NotificationSettings({ searchParams }: Props) {
  const locale = (await getLocale()) as AppLocale;
  const user = await requireOnboardedUser(locale, `/${locale}/account/profile`);
  const [t, enabled, query] = await Promise.all([getTranslations("Chat.notifications"), getNotifyChatEmail(user.id), searchParams]);
  if (enabled === null) return null;
  return (
    <section aria-labelledby="notifications-heading" className={`${ui.card} mt-6 p-5 sm:p-6`}>
      <h2 id="notifications-heading" className={`${ui.headingCaps} text-lg`}>{t("title")}</h2>
      {query.notice === "notifications" && <p className="mt-2" role="status">{t("saved")}</p>}
      {query.notice === "notificationsFailed" && <p className="mt-2" role="alert">{t("failed")}</p>}
      <form action={saveNotifications} className="mt-3 grid gap-3">
        <input type="hidden" name="locale" value={locale} />
        <label className="flex min-h-11 items-start gap-2">
          <input type="checkbox" name="notifyChatEmail" defaultChecked={enabled} className="mt-1" aria-describedby="notify-hint" />
          <span>{t("chatEmail")}</span>
        </label>
        <p id="notify-hint" className="text-sm text-muted">{t("hint")}</p>
        <button type="submit" className={`justify-self-start ${ui.btnSecondary}`}>{t("save")}</button>
      </form>
    </section>
  );
}
