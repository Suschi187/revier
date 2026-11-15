import { Suspense } from "react";
import { getLocale, getTranslations } from "next-intl/server";
import { AuthNav, AuthNavFallback } from "@/components/auth/AuthNav";
import { Logo } from "@/components/brand/Logo";
import { LocaleSwitcher, LocaleSwitcherFallback } from "@/components/LocaleSwitcher";
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
 *
 * Bewusst synchron: Die Suspense-Grenzen (Sprachwahl liest den Query-String, Konto die Session) beginnen so
 * gleichzeitig mit der Seite und stehen meist fertig im ersten HTML (QA M5). Läge eine Grenze in einer
 * async-Komponente, rendert sie erst nach deren `await` und käme nur noch gestreamt (verborgen ohne JS).
 * Ist die Seite schneller (z. B. `/de/jagdpacht/bayern?cur=EUR`), greifen die Platzhalter: Sie funktionieren
 * ohne JavaScript (Sprachwechsel über `/api/locale`, Konto-Link).
 */
export function SiteHeader() {
  return (
    <>
      <div className="on-dark bg-forest text-xs text-offwhite">
        <div className={`${ui.container} flex flex-wrap items-center gap-x-5 gap-y-1 py-1.5`}>
          <TopBarText />
          <div className="ml-auto flex flex-wrap items-center gap-x-5">
            <ShopLink />
            <Suspense fallback={<LocaleSwitcherFallback />}>
              <LocaleSwitcher />
            </Suspense>
          </div>
        </div>
      </div>
      <header className="border-b border-sand bg-offwhite">
        <div className={`${ui.container} flex flex-wrap items-center gap-x-5 gap-y-3 py-3`}>
          <HomeLink />
          <HeaderSearch />
          <div className="ml-auto flex flex-wrap items-center justify-end gap-1 lg:ml-0">
            <Suspense fallback={<AuthNavFallback />}>
              <AuthNav />
            </Suspense>
            <CreateLink />
          </div>
        </div>
      </header>
    </>
  );
}

// Claim im Stil des Shops (SPEC 4.1, QA F2), auch bei 360 px sichtbar; Shop-Link und Sprachwahl rücken dann darunter.
async function TopBarText() {
  const tb = await getTranslations("Brand");
  return <p className="font-display font-semibold uppercase tracking-claim">{tb("claim")}</p>;
}

async function ShopLink() {
  const tb = await getTranslations("Brand");
  return (
    <a href={SHOP_URL} rel="noopener" aria-label={tb("shopLabel")} className="py-1.5 hover:text-brand">
      {tb("shop")}
    </a>
  );
}

async function HomeLink() {
  const tb = await getTranslations("Brand");
  return (
    <Link href="/" aria-label={tb("homeLabel")} className="text-forest no-underline">
      <Logo />
    </Link>
  );
}

async function CreateLink() {
  const t = await getTranslations("Header");
  return (
    <Link href="/account/listings/new" prefetch={false} className={`${ui.btnPrimary} ml-2`}>
      <Icon name="plus" size={16} />
      {t("create")}
    </Link>
  );
}

async function HeaderSearch() {
  const locale = (await getLocale()) as AppLocale;
  const [t, tc, names] = await Promise.all([getTranslations("Header"), getTranslations("Profile.countries"), regionNames(locale)]);
  const states = allRegionRefs()
    .filter((r) => r.level === "state")
    .map((r) => ({ ...r, name: names[r.code] ?? r.code }))
    .sort((a, b) => a.name.localeCompare(b.name, locale));
  const countries = [...new Set(states.map((s) => s.country))];

  return (
    <form
      action={publicPath({ route: "search" }, locale)}
      method="get"
      role="search"
      className="order-last flex w-full overflow-hidden rounded-card border-(length:--stroke-strong) border-forest bg-surface lg:order-none lg:w-auto lg:flex-1"
    >
      <div className="flex min-w-40 flex-[2] items-center gap-2 px-3">
        <Icon name="search" size={18} className="shrink-0 text-muted" />
        <label htmlFor="header-q" className="sr-only">{t("searchWhat")}</label>
        <input id="header-q" name={PARAM_NAMES.q} type="search" maxLength={200} placeholder={t("searchWhat")}
          className="min-w-0 flex-1 bg-transparent py-2.5 placeholder:text-muted focus-visible:outline-offset-4" />
      </div>
      <div className="hidden min-w-44 flex-1 items-center gap-2 border-l border-sand px-3 sm:flex">
        <Icon name="pin" size={18} className="shrink-0 text-muted" />
        <label htmlFor="header-where" className="sr-only">{t("searchWhere")}</label>
        <select id="header-where" name={PARAM_NAMES.region} defaultValue="" className="min-w-0 flex-1 bg-transparent py-2.5">
          <option value="">{t("searchWhereAny")}</option>
          {countries.map((country) => (
            <optgroup key={country} label={tc(country)}>
              {states.filter((s) => s.country === country).map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}
            </optgroup>
          ))}
        </select>
      </div>
      <button type="submit" className="bg-forest px-5 font-display text-meta font-bold uppercase tracking-caps text-offwhite hover:bg-forest-hover">
        {t("searchButton")}
      </button>
    </form>
  );
}
