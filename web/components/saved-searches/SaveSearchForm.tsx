"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { saveSearchAction, type SaveState } from "@/app/[locale]/account/searches/actions";
import { errorParam, isErrorParam, type ErrorParam } from "@/lib/saved-searches/errors";
import { NAME_MAX } from "@/lib/saved-searches/rules";

const input = "w-full rounded border border-stone-400 px-2 py-1.5";

type Props = {
  locale: string;
  /** Geprüfte Filter der Seite als JSON (ohne sort). */
  filters: string;
  view: string;
  suggestedName: string;
  summary: string[];
  hasMapArea: boolean;
  /** Weg zur Zustimmung mit Rücksprung auf diese Suche (ohne Suchtext, H10). */
  legalHref: string;
  initialError?: ErrorParam;
};

/** Formular „Suche speichern“: ohne JavaScript per <details> und PRG, mit JavaScript per useActionState. */
export function SaveSearchForm({ locale, filters, view, suggestedName, summary, hasMapArea, legalHref, initialError }: Props) {
  const t = useTranslations("SavedSearches");
  const [state, formAction, pending] = useActionState(saveSearchAction, {
    error: null,
    name: suggestedName,
    cadence: "instant",
    notifyEmail: true,
  } satisfies SaveState);
  const shown = state.error ? errorParam(state.error) : isErrorParam(initialError) ? initialError : null;
  // Nach einem Fehler ohne JavaScript steht der Code in der URL, das Formular ist dann offen.
  const open = shown !== null || undefined;

  return (
    <details open={open} className="mt-6 rounded border border-stone-300 p-4">
      <summary className="cursor-pointer font-semibold">{t("save.open")}</summary>
      <form action={formAction} className="mt-4 grid gap-4" aria-describedby="save-intro">
        <p id="save-intro" className="text-sm text-stone-700">{t("save.intro")}</p>
        <input type="hidden" name="locale" value={locale} />
        <input type="hidden" name="filters" value={filters} />
        {view && <input type="hidden" name="view" value={view} />}

        <div>
          <p className="font-medium">{t("save.summary")}</p>
          {summary.length > 0 ? (
            <ul className="mt-1 list-disc ps-5 text-sm [overflow-wrap:anywhere]">
              {summary.map((part) => <li key={part}>{part}</li>)}
            </ul>
          ) : (
            <p className="mt-1 text-sm">{t("save.noFilters")}</p>
          )}
          {hasMapArea && <p className="mt-1 text-sm text-stone-700">{t("save.mapAreaHint")}</p>}
        </div>

        <div>
          <label htmlFor="save-name" className="block font-medium">{t("fields.name")}</label>
          <input
            id="save-name"
            name="name"
            required
            maxLength={NAME_MAX}
            defaultValue={state.name}
            key={state.name}
            aria-invalid={shown === "name" || undefined}
            aria-describedby="save-name-hint"
            className={input}
          />
          <p id="save-name-hint" className="text-sm text-stone-700">{t("fields.nameHint")}</p>
        </div>

        <fieldset>
          <legend className="font-medium">{t("fields.cadence")}</legend>
          <div className="mt-1 grid gap-1">
            {(["instant", "daily"] as const).map((cadence) => (
              <label key={cadence} className="flex items-start gap-2">
                <input type="radio" name="cadence" value={cadence} defaultChecked={state.cadence === cadence} className="mt-1" />
                <span>
                  {t(`cadence.${cadence}`)}
                  <span className="block text-sm text-stone-700">{t(`cadenceHint.${cadence}`)}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <label className="flex items-start gap-2">
          <input type="checkbox" name="notifyEmail" defaultChecked={state.notifyEmail} className="mt-1" />
          <span>{t("fields.notifyEmail")}</span>
        </label>

        <p className="text-sm text-stone-700">{t("save.runtime")}</p>

        <div className="flex flex-wrap items-center gap-4">
          <button type="submit" disabled={pending} className="rounded bg-stone-900 px-4 py-2 text-white disabled:opacity-60">
            {pending ? t("save.saving") : t("save.submit")}
          </button>
        </div>
        {shown && (
          <p role="alert" className="text-red-800">
            {t(`errors.${shown}`)}
            {shown === "legal" && (
              <>
                {" "}
                <a href={legalHref} className="underline">{t("legalLink")}</a>
              </>
            )}
            {shown === "limit" && (
              <>
                {" "}
                <a href={`/${locale}/account/searches`} className="underline">{t("manageLink")}</a>
              </>
            )}
          </p>
        )}
      </form>
    </details>
  );
}
