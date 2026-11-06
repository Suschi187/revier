import { getTranslations } from "next-intl/server";
import type { AppLocale } from "@/i18n/routing";
import { safeNextPath } from "@/lib/auth/paths";
import { isErrorParam } from "@/lib/saved-searches/errors";
import { describeFilters, suggestName } from "@/lib/saved-searches/rules";
import { filterTexts } from "@/lib/saved-searches/texts";
import type { Filters } from "@/lib/search/filters";
import { SaveSearchForm } from "./SaveSearchForm";

/**
 * „Suche speichern“ auf der Suche, Liste und Karte (ADR 018). Angemeldet ein kleines Formular (aufklappbar, ohne
 * JavaScript per <details>), anonym ein Link zum Login mit Rücksprung (ohne Suchtext, H10). Der Kartenausschnitt
 * wird mitgespeichert und im Formular genannt (H1).
 */
export async function SaveSearch({
  locale,
  filters,
  mapView,
  signedIn,
  back,
  error,
}: {
  locale: AppLocale;
  filters: Filters;
  mapView: boolean;
  signedIn: boolean;
  /** Aktuelle Seite mit Filtern, für den Login-Rücksprung. */
  back: string;
  /** Fehlercode aus der URL nach dem Speichern ohne JavaScript. */
  error: unknown;
}) {
  const t = await getTranslations("SavedSearches");
  if (!signedIn) {
    return (
      <p className="mt-6">
        <a href={`/${locale}/login?next=${encodeURIComponent(safeNextPath(back, locale))}`} className="underline">
          {t("save.signIn")}
        </a>
      </p>
    );
  }
  // Die Reihenfolge zählt für den Abgleich nicht, die DB entfernt sort ohnehin (ADR 018).
  const saved: Filters = { ...filters };
  delete saved.sort;
  const texts = await filterTexts(locale);
  return (
    <SaveSearchForm
      locale={locale}
      filters={JSON.stringify(saved)}
      view={mapView ? "map" : ""}
      suggestedName={suggestName(saved, texts)}
      summary={describeFilters(saved, locale, texts)}
      hasMapArea={saved.bbox !== undefined}
      legalHref={`/${locale}/welcome?next=${encodeURIComponent(safeNextPath(back, locale))}`}
      initialError={isErrorParam(error) ? error : undefined}
    />
  );
}
