import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { ConfirmForm } from "@/components/auth/ConfirmForm";
import { ClientMessages } from "@/components/i18n/ClientMessages";
import type { AppLocale } from "@/i18n/routing";
import { LogoMark } from "@/components/brand/Logo";
import { ui } from "@/components/ui/styles";

// noindex; Referrer-Policy no-referrer kommt aus next.config.ts (ADR 010).
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Auth.confirm");
  return { title: t("metaTitle"), robots: { index: false, follow: false } };
}

// GET prüft nichts: Mail-Scanner, die den Link vorab öffnen, verbrauchen so kein Token.
export default async function ConfirmPage({ searchParams }: PageProps<"/[locale]/auth/confirm">) {
  const t = await getTranslations("Auth.confirm");
  return (
    <main id="main" className="mx-auto w-full max-w-md flex-1 px-4 py-8 sm:py-12">
      <div className={`${ui.card} p-5 sm:p-8`}>
      <LogoMark size={44} />
      <h1 className="mt-4 font-display text-2xl font-extrabold uppercase leading-tight [overflow-wrap:anywhere] hyphens-auto sm:text-3xl">{t("title")}</h1>
      <p className="mt-3">{t("text")}</p>
      <Suspense fallback={null}>
        <ConfirmFormWithParams searchParams={searchParams} />
      </Suspense>
      </div>
    </main>
  );
}

async function ConfirmFormWithParams({ searchParams }: Pick<PageProps<"/[locale]/auth/confirm">, "searchParams">) {
  const locale = (await getLocale()) as AppLocale;
  const params = await searchParams;
  const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? "";
  return <ClientMessages namespaces={["Auth.confirm"]}><ConfirmForm locale={locale} tokenHash={first(params.token_hash)} redirectTo={first(params.redirect_to)} /></ClientMessages>;
}
