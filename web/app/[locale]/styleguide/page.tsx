import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { KindIcon } from "@/components/brand/KindIcon";
import { Logo, LogoMark } from "@/components/brand/Logo";
import { ListingCard } from "@/components/public/ListingCard";
import { Icon, type IconName } from "@/components/ui/Icon";
import { StatusBadge, type ListingStatus } from "@/components/ui/StatusBadge";
import { ui } from "@/components/ui/styles";
import type { AppLocale } from "@/i18n/routing";
import { regionFromSlugs } from "@/lib/public/regions";
import { siteIndexable } from "@/lib/public/robots";
import type { ListingCard as Card } from "@/lib/services/public-listings";
import { regionNames } from "@/lib/services/regions";
import { LISTING_KINDS } from "@/lib/validation/listing";

// Interne Bibliothek (SPEC M10a Schritt 3): nur lokal und in Staging, nie indexiert. In Prod antwortet schon der
// Proxy mit 404; die Prüfung hier sichert den direkten Aufruf ab.
export const metadata: Metadata = { robots: { index: false, follow: false } };

const COLORS = ["forest", "forest-hover", "olive", "sand", "offwhite", "surface", "brand", "brand-hover", "brand-ink", "muted", "field", "error", "success", "notice"] as const;
const SWATCH: Record<(typeof COLORS)[number], string> = {
  forest: "bg-forest", "forest-hover": "bg-forest-hover", olive: "bg-olive", sand: "bg-sand", offwhite: "bg-offwhite", surface: "bg-surface",
  brand: "bg-brand", "brand-hover": "bg-brand-hover", "brand-ink": "bg-brand-ink", muted: "bg-muted", field: "bg-field",
  error: "bg-error", success: "bg-success", notice: "bg-notice",
};
const ICONS: IconName[] = ["search", "pin", "message", "bookmark", "user", "plus", "arrow", "shield", "lock", "flag", "bell", "share", "list", "download", "trash", "block", "scale", "edit", "chevron", "logout"];
const STATUSES: ListingStatus[] = ["draft", "pending_review", "active", "paused", "expired", "rejected", "removed"];

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-4 border-t border-sand pt-8">
      <h2 id={id} className={`${ui.headingCaps} text-xl`}>{title}</h2>
      {children}
    </section>
  );
}

export default async function StyleguidePage() {
  if (siteIndexable()) notFound();
  const locale = (await getLocale()) as AppLocale;
  const [t, th, tf, tl, tlist, tfav, tp, names] = await Promise.all([
    getTranslations("Styleguide"),
    getTranslations("Header"),
    getTranslations("Public.filters"),
    getTranslations("Listings"),
    getTranslations("Public.list"),
    getTranslations("Favorites"),
    getTranslations("Public.detail"),
    regionNames(locale),
  ]);
  const district = regionFromSlugs("bayern", "rosenheim-landkreis");
  const state = regionFromSlugs("bayern");
  const sample = (kind: Card["kind"], direction: Card["direction"], price: number | null): Card => ({
    id: "00000000-0000-4000-8000-000000000000",
    kind,
    direction,
    title: t("sampleTitle"),
    content_language: locale,
    country: "DE",
    district_code: district?.code ?? "",
    state_code: state?.code ?? "",
    postal_prefix: null,
    price_minor: price,
    currency: price === null ? null : "EUR",
    price_unit: price === null ? "on_request" : "per_year",
    area_hectares: 420,
    start_date: null,
    end_date: null,
    event_date: null,
    published_at: "2026-11-12T08:00:00Z",
    point: { lng: 12.1, lat: 47.9 },
    approx: "district",
    photo: null,
    provider: null,
  });

  return (
    <main className={`${ui.container} flex flex-1 flex-col gap-8 py-8`}>
      <div>
        <p className={ui.eyebrow}>M10a</p>
        <h1 className={`${ui.headingCaps} text-3xl`}>{t("title")}</h1>
        <p className="mt-2 text-muted">{t("intro")}</p>
      </div>

      <Section id="sg-logo" title={t("logo")}>
        <div className="flex flex-wrap items-center gap-6">
          <div className={`${ui.card} p-5`}><Logo /></div>
          <div className="on-dark rounded-card bg-forest p-5"><Logo onDark /></div>
          <LogoMark size={24} />
          <LogoMark size={64} />
        </div>
      </Section>

      <Section id="sg-colors" title={t("colors")}>
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
          {COLORS.map((c) => (
            <li key={c} className="text-sm">
              <div className={`h-14 rounded-btn border border-sand ${SWATCH[c]}`} />
              <code className="mt-1 block">{c}</code>
            </li>
          ))}
        </ul>
      </Section>

      <Section id="sg-type" title={t("typography")}>
        <p className={ui.eyebrow}>{th("create")}</p>
        <p className={`${ui.headingCaps} text-4xl leading-none sm:text-5xl`}>{t("headingSample")}</p>
        <p className={`${ui.headingCaps} text-2xl`}>{t("headingSample")}</p>
        <p className="font-display text-xl font-bold">{t("headingSample")}</p>
        <p className="max-w-2xl leading-relaxed">{t("bodySample")}</p>
        <p className="text-sm text-muted">{t("bodySample")}</p>
      </Section>

      <Section id="sg-buttons" title={t("buttons")}>
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className={ui.btnPrimary}><Icon name="plus" size={16} />{th("create")}</button>
          <button type="button" className={ui.btnPrimaryText}><Icon name="message" size={16} />{tp("contact")}</button>
          <button type="button" className={ui.btnDark}>{th("searchButton")}</button>
          <button type="button" className={ui.btnSecondary}><Icon name="bookmark" size={16} />{tfav("save")}</button>
          <button type="button" className={ui.btnPrimary} disabled>{t("disabled")}</button>
          <a href="#sg-buttons" className={ui.link}>{tf("reset")}</a>
        </div>
      </Section>

      <Section id="sg-fields" title={t("fields")}>
        <div className="grid max-w-xl gap-5">
          <div>
            <label htmlFor="sg-f1" className={ui.label}>{t("fieldLabel")}</label>
            <p id="sg-f1-hint" className="mb-1 text-sm text-muted">{t("fieldHint")}</p>
            <input id="sg-f1" className={ui.input} aria-describedby="sg-f1-hint" />
          </div>
          <div>
            <label htmlFor="sg-f2" className={ui.label}>{t("fieldLabel")}</label>
            <input id="sg-f2" className={`${ui.input} border-error`} aria-invalid aria-describedby="sg-f2-error" />
            <p id="sg-f2-error" className="mt-1 text-sm text-error">{t("fieldError")}</p>
          </div>
          <div>
            <label htmlFor="sg-f3" className={ui.label}>{tf("sort")}</label>
            <select id="sg-f3" className={ui.input}><option>{tf("sorts.newest")}</option></select>
          </div>
          <fieldset className="flex flex-wrap gap-x-5 gap-y-2">
            <legend className={ui.label}>{tl("fields.direction")}</legend>
            <label className="flex items-center gap-2"><input type="radio" name="sg-r" defaultChecked />{tl("directions.offer")}</label>
            <label className="flex items-center gap-2"><input type="radio" name="sg-r" />{tl("directions.wanted")}</label>
            <label className="flex items-center gap-2"><input type="checkbox" defaultChecked />{tf("verifiedOnly")}</label>
          </fieldset>
        </div>
      </Section>

      <Section id="sg-badges" title={t("badges")}>
        <div className="flex flex-wrap gap-2">
          {STATUSES.map((s) => <StatusBadge key={s} status={s} label={tl(`status.${s}`)} />)}
        </div>
        <div className="flex flex-wrap gap-2">
          {LISTING_KINDS.map((k) => <span key={k} className={ui.chip}>{tl(`kinds.${k}`)}</span>)}
          <span className={ui.chip}><Icon name="shield" size={14} />{tp("verified")}</span>
        </div>
      </Section>

      <Section id="sg-notices" title={t("notices")}>
        <p className="rounded-card border border-notice bg-notice-soft p-3 text-notice">{tlist("empty")}</p>
        <p role="alert" className="rounded-card border border-error bg-error-soft p-3 text-error">{tlist("failed")}</p>
        <p className="rounded-card border border-success bg-success-soft p-3 text-success">{tp("contactPrivate")}</p>
      </Section>

      <Section id="sg-cards" title={t("cards")}>
        <div className="grid gap-4 md:grid-cols-[16rem_minmax(0,1fr)] md:items-start">
          <ListingCard card={sample("permit", "offer", 120000)} locale={locale} regions={names} layout="grid" />
          <div className="flex flex-col gap-3">
            <ListingCard card={sample("lease", "offer", 1850000)} locale={locale} regions={names} />
            <ListingCard card={sample("helper", "wanted", null)} locale={locale} regions={names} />
          </div>
        </div>
      </Section>

      <Section id="sg-icons" title={t("icons")}>
        <ul className="flex flex-wrap gap-3">
          {LISTING_KINDS.map((k) => (
            <li key={k} className="flex size-14 items-center justify-center rounded-full bg-sand" title={tl(`kinds.${k}`)}><KindIcon kind={k} /></li>
          ))}
        </ul>
        <ul className="flex flex-wrap gap-4">
          {ICONS.map((name) => <li key={name} className="flex flex-col items-center gap-1 text-xs text-muted"><Icon name={name} size={24} className="text-forest" /><code>{name}</code></li>)}
        </ul>
      </Section>

      <Section id="sg-states" title={t("states")}>
        <div className={`${ui.card} flex flex-col items-center gap-3 p-8 text-center`}>
          <span className="flex size-16 items-center justify-center rounded-full bg-sand text-olive"><Icon name="search" size={30} /></span>
          <p className="max-w-md">{tlist("empty")}</p>
          <a href="#sg-states" className={ui.btnSecondary}>{tf("reset")}</a>
        </div>
      </Section>
    </main>
  );
}
