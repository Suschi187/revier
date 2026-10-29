import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { BlockedNotice } from "@/components/profile/BlockedNotice";
import { ProfileForm } from "@/components/profile/ProfileForm";
import { Link } from "@/i18n/navigation";
import type { AppLocale } from "@/i18n/routing";
import { requireOnboardedUser } from "@/lib/services/gate";
import { getOwnProfile } from "@/lib/services/profile";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Account.profile");
  return { title: t("metaTitle"), robots: { index: false, follow: false } };
}

export default async function ProfilePage() {
  const t = await getTranslations("Account");
  return (
    <main className="mx-auto w-full max-w-md flex-1 px-4 py-12">
      <Link href="/account" className="underline">
        {t("profile.back")}
      </Link>
      <h1 className="mt-4 text-3xl font-semibold">{t("profile.title")}</h1>
      <Suspense fallback={null}>
        <ProfileContent />
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
