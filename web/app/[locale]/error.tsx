"use client";

import { useLocale, useTranslations } from "next-intl";
import { ErrorState } from "@/components/ui/ErrorState";
import { ui } from "@/components/ui/styles";

// 500 unterhalb des Layouts (M10): Kopf und Fuß bleiben, keine Fehlerdetails, nur die Fehlernummer (`digest`) für
// den Abgleich mit den Server-Logs. Texte kommen über das Layout (LAYOUT_CLIENT_NAMESPACES).
export default function LocaleError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const t = useTranslations("ServerError");
  const tn = useTranslations("NotFound");
  const locale = useLocale();
  return (
    <main id="main" className="mx-auto w-full max-w-2xl flex-1 px-4 py-8 sm:px-6 sm:py-12">
      <ErrorState
        code="500"
        title={<h1 className={`${ui.headingCaps} text-2xl leading-tight [overflow-wrap:anywhere] hyphens-auto sm:text-3xl`}>{t("title")}</h1>}
        text={
          <>
            <p className="max-w-md">{t("text")}</p>
            {error.digest && <p className="text-meta text-muted">{t("digest", { digest: error.digest })}</p>}
          </>
        }
      >
        <button type="button" onClick={() => retry()} className={ui.btnPrimary}>{t("retry")}</button>
        {/* Normaler Link: lädt nach einem Fehler die Startseite ganz neu. */}
        <a href={`/${locale}`} className={ui.btnSecondary}>{tn("backHome")}</a>
      </ErrorState>
    </main>
  );
}
