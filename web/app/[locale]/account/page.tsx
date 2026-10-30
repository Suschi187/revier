import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
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
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-12">
      <h1 className="text-3xl font-semibold">{t("title")}</h1>
      <AccountContent />
    </main>
  );
}

async function AccountContent() {
  const locale = (await getLocale()) as AppLocale;
  const user = await requireOnboardedUser(locale, `/${locale}/account`);
  const [profile, t] = await Promise.all([getOwnProfile(user.id), getTranslations("Account")]);
  if (!profile) throw new Error("Profil nicht verfügbar");

  return (
    <div className="mt-6 flex flex-col gap-4">
      {/* Eingeloggte Adresse sichtbar machen (Login-CSRF, ADR 010). */}
      <p>{t("signedInAs", { email: user.email ?? "–" })}</p>
      <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1">
        <dt className="font-medium">{t("displayName")}</dt>
        <dd>{profile.displayName}</dd>
        <dt className="font-medium">{t("accountType")}</dt>
        <dd>
          {t(`accountTypes.${profile.accountType}`)}
          {profile.businessName ? ` (${profile.businessName})` : ""}
        </dd>
        <dt className="font-medium">{t("verification")}</dt>
        <dd>{t(`verificationStatus.${profile.verificationStatus}`)}</dd>
      </dl>
      <Link href="/account/profile" className="self-start underline">
        {t("editProfile")}
      </Link>
      <Link href="/account/listings" className="self-start underline">
        {t("myListings")}
      </Link>
    </div>
  );
}
