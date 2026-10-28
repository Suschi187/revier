import { hasLocale } from "next-intl";
import { getRequestConfig } from "next-intl/server";
import { locale as rootLocale } from "next/root-params";
import { routing } from "./routing";

export default getRequestConfig(async ({ locale: explicitLocale }) => {
  const candidate = explicitLocale ?? (await rootLocale());
  const locale = hasLocale(routing.locales, candidate)
    ? candidate
    : routing.defaultLocale;

  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default,
  };
});
