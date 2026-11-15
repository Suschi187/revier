import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { LoginForm } from "@/components/auth/LoginForm";
import { LogoMark } from "@/components/brand/Logo";
import { ClientMessages } from "@/components/i18n/ClientMessages";
import { ui } from "@/components/ui/styles";
import { Link } from "@/i18n/navigation";
import type { AppLocale } from "@/i18n/routing";
import { safeNextPath } from "@/lib/auth/paths";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Auth.login");
  return { title: t("metaTitle"), robots: { index: false, follow: false } };
}

export default async function LoginPage({ searchParams }: PageProps<"/[locale]/login">) {
  const t = await getTranslations("Auth.login");
  return (
    <main className="mx-auto w-full max-w-md flex-1 px-4 py-8 sm:py-12">
      <div className={`${ui.card} p-5 sm:p-8`}>
      <LogoMark size={44} />
      <h1 className="mt-4 font-display text-2xl font-extrabold uppercase leading-tight [overflow-wrap:anywhere] hyphens-auto sm:text-3xl">{t("title")}</h1>
      <p className="mt-3">{t("intro")}</p>
      {/* Art. 13 DSGVO: Information beim Erheben der E-Mail-Adresse (QA M2 F3). */}
      <p className="mt-3 text-sm text-muted">
        {t.rich("privacyHint", {
          link: (chunks) => (
            <Link href="/privacy" className={ui.link}>
              {chunks}
            </Link>
          ),
        })}
      </p>
      <Suspense fallback={null}>
        <LoginFormWithParams searchParams={searchParams} />
      </Suspense>
      </div>
    </main>
  );
}

async function LoginFormWithParams({ searchParams }: Pick<PageProps<"/[locale]/login">, "searchParams">) {
  const locale = (await getLocale()) as AppLocale;
  const { next } = await searchParams;
  return <ClientMessages namespaces={["Auth.login"]}><LoginForm locale={locale} next={safeNextPath(next, locale)} /></ClientMessages>;
}
