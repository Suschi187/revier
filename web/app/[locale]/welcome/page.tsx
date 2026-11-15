import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { ClientMessages } from "@/components/i18n/ClientMessages";
import { BlockedNotice } from "@/components/profile/BlockedNotice";
import { WelcomeForm } from "@/components/profile/WelcomeForm";
import { LogoMark } from "@/components/brand/Logo";
import { ui } from "@/components/ui/styles";
import type { AppLocale } from "@/i18n/routing";
import { safeNextPath } from "@/lib/auth/paths";
import { Link } from "@/i18n/navigation";
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
    <main id="main" className="mx-auto w-full max-w-md flex-1 px-4 py-8 sm:py-12">
      <div className={`${ui.card} p-5 sm:p-8`}>
      <LogoMark size={44} />
      <h1 className="mt-4 font-display text-2xl font-extrabold uppercase leading-tight [overflow-wrap:anywhere] hyphens-auto sm:text-3xl">{t("title")}</h1>
      <p className="mt-3">{t("intro")}</p>
      <Suspense fallback={null}>
        <WelcomeContent searchParams={searchParams} />
      </Suspense>
      </div>
      {/* Auch ohne Zustimmung erreichbar (ADR 019, Review A4). */}
      <nav aria-label={t("accountLinks")} className="mt-6 flex flex-col gap-2 px-1 text-sm">
        <Link href="/account/data" className={ui.link}>{t("dataExport")}</Link>
        <Link href="/account/delete" className={ui.link}>{t("deleteAccount")}</Link>
      </nav>
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
  if (profile.isBlocked) return <div className="mt-6"><BlockedNotice /></div>;

  const displayName =
    profile.displayName === PLACEHOLDER_DISPLAY_NAME ? (user.metadataName ?? "") : profile.displayName;
  return (
    <ClientMessages namespaces={["Welcome", "Profile", "LocaleSwitcher.names"]}>
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
    </ClientMessages>
  );
}
