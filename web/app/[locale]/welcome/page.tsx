import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { BlockedNotice } from "@/components/profile/BlockedNotice";
import { WelcomeForm } from "@/components/profile/WelcomeForm";
import type { AppLocale } from "@/i18n/routing";
import { safeNextPath } from "@/lib/auth/paths";
import { requireSessionUser } from "@/lib/services/auth";
import { getLegalStatus } from "@/lib/services/legal";
import { getOwnProfile, PLACEHOLDER_DISPLAY_NAME } from "@/lib/services/profile";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Welcome");
  return { title: t("metaTitle"), robots: { index: false, follow: false } };
}

// Statische Hülle ohne Nutzerdaten; alles Persönliche lädt hinter der Suspense-Grenze.
export default async function WelcomePage({ searchParams }: PageProps<"/[locale]/welcome">) {
  const t = await getTranslations("Welcome");
  return (
    <main className="mx-auto w-full max-w-md flex-1 px-4 py-12">
      <h1 className="text-3xl font-semibold">{t("title")}</h1>
      <p className="mt-3">{t("intro")}</p>
      <Suspense fallback={null}>
        <WelcomeContent searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function WelcomeContent({ searchParams }: Pick<PageProps<"/[locale]/welcome">, "searchParams">) {
  const locale = (await getLocale()) as AppLocale;
  const next = safeNextPath((await searchParams).next, locale);
  const user = await requireSessionUser(locale, `/${locale}/welcome`);
  const [legal, profile] = await Promise.all([getLegalStatus(), getOwnProfile(user.id)]);
  if (legal?.accepted) redirect(next === `/${locale}/welcome` ? `/${locale}/account` : next);
  if (!legal || !profile) throw new Error("Profil oder Rechtsstatus nicht verfügbar");
  // Gesperrte können weder zustimmen noch das Profil ändern (accept_legal und RLS lehnen ab).
  if (profile.isBlocked) return <BlockedNotice />;

  const displayName =
    profile.displayName === PLACEHOLDER_DISPLAY_NAME ? (user.metadataName ?? "") : profile.displayName;
  return (
    <WelcomeForm
      locale={locale}
      next={next}
      termsVersion={legal.termsVersion}
      privacyVersion={legal.privacyVersion}
      initial={{
        displayName,
        accountType: profile.accountType,
        businessName: profile.businessName ?? "",
        country: profile.country,
        preferredLanguage: profile.preferredLanguage,
      }}
    />
  );
}
