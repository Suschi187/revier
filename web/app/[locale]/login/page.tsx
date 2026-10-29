import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { LoginForm } from "@/components/auth/LoginForm";
import type { AppLocale } from "@/i18n/routing";
import { safeNextPath } from "@/lib/auth/paths";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Auth.login");
  return { title: t("metaTitle"), robots: { index: false, follow: false } };
}

export default async function LoginPage({ searchParams }: PageProps<"/[locale]/login">) {
  const t = await getTranslations("Auth.login");
  return (
    <main className="mx-auto w-full max-w-md flex-1 px-4 py-12">
      <h1 className="text-3xl font-semibold">{t("title")}</h1>
      <p className="mt-3">{t("intro")}</p>
      <Suspense fallback={null}>
        <LoginFormWithParams searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function LoginFormWithParams({ searchParams }: Pick<PageProps<"/[locale]/login">, "searchParams">) {
  const locale = (await getLocale()) as AppLocale;
  const { next } = await searchParams;
  return <LoginForm locale={locale} next={safeNextPath(next, locale)} />;
}
