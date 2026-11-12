import { Suspense } from "react";
import { getLocale, getTranslations } from "next-intl/server";
import { AuthNav } from "@/components/auth/AuthNav";
import { Logo } from "@/components/brand/Logo";
import { LocaleSwitcher } from "@/components/LocaleSwitcher";
import { Icon } from "@/components/ui/Icon";
import { ui } from "@/components/ui/styles";
import { Link } from "@/i18n/navigation";
import type { AppLocale } from "@/i18n/routing";
import { publicPath } from "@/lib/public/paths";
import { allRegionRefs } from "@/lib/public/regions";
import { PARAM_NAMES } from "@/lib/search/filters";
import { regionNames } from "@/lib/services/regions";

const SHOP_URL = "https://www.jagdbrueder.de/";

/**
 * Kopf auf allen Seiten (SPEC M10a Schritt 4.1): dunkelgrüne Leiste, Wortmarke, Suche mit „Was?“ und „Wo?“
 * (Bundesland, als GET-Formular ohne JavaScript), Konto-Links und die Hauptaktion „Anzeige aufgeben“.
 */
export async function SiteHeader() {
  const locale = (await getLocale()) as AppLocale;
  const [t, tb, tc, names] = await Promise.all([
    getTranslations("Header"),
    getTranslations("Brand"),
    getTranslations("Profile.countries"),
    regionNames(locale),
  ]);
  const states = allRegionRefs()
    .filter((r) => r.level === "state")
    .map((r) => ({ ...r, name: names[r.code] ?? r.code }))
    .sort((a, b) => a.name.localeCompare(b.name, locale));
  const countries = [...new Set(states.map((s) => s.country))];

  return (
    <>
      <div className="on-dark bg-forest text-xs text-offwhite">
        <div className={`${ui.container} flex flex-wrap items-center gap-x-5 gap-y-1 py-1.5`}>
          <p className="hidden font-display font-semibold uppercase tracking-[0.1em] sm:block">{tb("claim")}</p>
          <div className="ml-auto flex flex-wrap items-center gap-x-5">
            <a href={SHOP_URL} rel="noopener" aria-label={tb("shopLabel")} className="py-1.5 hover:text-brand">
              {tb("shop")}
            </a>
            <Suspense fallback={null}>
              <LocaleSwitcher />
            </Suspense>
          </div>
        </div>
      </div>
      <header className="border-b border-sand bg-offwhite">
        <div className={`${ui.container} flex flex-wrap items-center gap-x-5 gap-y-3 py-3`}>
          <Link href="/" aria-label={tb("homeLabel")} className="text-forest no-underline">
            <Logo />
          </Link>
          <form
            action={publicPath({ route: "search" }, locale)}
            method="get"
            role="search"
            className="order-last flex w-full overflow-hidden rounded-card border-[1.5px] border-forest bg-surface lg:order-none lg:w-auto lg:flex-1"
          >
            <label className="flex min-w-0 flex-[2] items-center gap-2 px-3">
              <Icon name="search" size={18} className="shrink-0 text-muted" />
              <span className="sr-only">{t("searchWhat")}</span>
              <input name={PARAM_NAMES.q} type="search" maxLength={200} placeholder={t("searchWhat")}
                className="min-w-0 flex-1 bg-transparent py-2.5 placeholder:text-muted focus-visible:outline-offset-4" />
            </label>
            <label className="hidden min-w-0 flex-1 items-center gap-2 border-l border-sand px-3 sm:flex">
              <Icon name="pin" size={18} className="shrink-0 text-muted" />
              <span className="sr-only">{t("searchWhere")}</span>
              <select name={PARAM_NAMES.region} defaultValue="" className="min-w-0 flex-1 bg-transparent py-2.5">
                <option value="">{t("searchWhereAny")}</option>
                {countries.map((country) => (
                  <optgroup key={country} label={tc(country)}>
                    {states.filter((s) => s.country === country).map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}
                  </optgroup>
                ))}
              </select>
            </label>
            <button type="submit" className="bg-forest px-5 font-display text-[0.8125rem] font-bold uppercase tracking-caps text-offwhite hover:bg-forest-hover">
              {t("searchButton")}
            </button>
          </form>
          <div className="ml-auto flex items-center gap-1 lg:ml-0">
            <Suspense fallback={null}>
              <AuthNav />
            </Suspense>
            <Link href="/account/listings/new" prefetch={false} className={`${ui.btnPrimary} ml-2`}>
              <Icon name="plus" size={16} />
              {t("create")}
            </Link>
          </div>
        </div>
      </header>
    </>
  );
}
