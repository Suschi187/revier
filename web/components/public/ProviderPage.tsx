import { getTranslations } from "next-intl/server";
import type { AppLocale } from "@/i18n/routing";
import { publicPath } from "@/lib/public/paths";
import type { ListingPage, PublicProvider } from "@/lib/services/public-listings";
import { Breadcrumbs } from "./Breadcrumbs";
import { ListingList } from "./ListingCard";

/** Öffentliches Anbieterprofil (SPEC 4.3 v0.7): Name, Privat/Gewerbe, Badge, aktive Anzeigen; kein „dabei seit“. */
export async function ProviderPage({
  provider,
  listings,
  locale,
  regions,
  cursor,
}: {
  provider: PublicProvider;
  listings: ListingPage;
  locale: AppLocale;
  regions: Record<string, string>;
  cursor: string | null;
}) {
  const [t, tProfile, tHome] = await Promise.all([getTranslations("Public.provider"), getTranslations("Profile"), getTranslations("Public.home")]);
  const path = publicPath({ route: "provider", id: provider.id }, locale);
  const name = providerName(provider);
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-12">
      <Breadcrumbs crumbs={[{ name: tHome("crumb"), href: publicPath({ route: "home" }, locale) }, { name, href: path }]} label={t("breadcrumb")} />
      <h1 className="mt-2 text-3xl font-semibold break-words">{name}</h1>
      <p className="mt-1">
        {tProfile(`accountTypes.${provider.account_type}`)}
        {provider.verified && <> · <strong>{t("verified")}</strong></>}
      </p>
      <section aria-labelledby="provider-listings" className="mt-8">
        <h2 id="provider-listings" className="text-xl font-semibold">{t("listings")}</h2>
        <ListingList items={listings.items} locale={locale} regions={regions} empty={t("empty")} />
        {(listings.nextCursor || cursor) && (
          <nav aria-label={t("paging")} className="mt-6 flex gap-4">
            {cursor && <a href={path} className="underline">{t("first")}</a>}
            {listings.nextCursor && <a href={`${path}?cursor=${encodeURIComponent(listings.nextCursor)}`} rel="next" className="underline">{t("next")}</a>}
          </nav>
        )}
      </section>
    </main>
  );
}

export function providerName(provider: PublicProvider): string {
  return provider.account_type === "business" && provider.business_name ? provider.business_name : provider.display_name;
}
