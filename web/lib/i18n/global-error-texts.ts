import type { AppLocale } from "@/i18n/routing";

// Texte der globalen Fehlerseite (app/global-error.tsx). Sie läuft ohne Layout und ohne next-intl und ist eine
// Client-Komponente; die Message-Dateien ganz einzubinden wäre zu groß. Deshalb hier gespiegelt, der Vitest
// global-error-texts.test.ts hält sie gleich mit `ServerError` und `NotFound.backHome` in web/messages.
export const GLOBAL_ERROR_TEXTS: Record<AppLocale, { title: string; text: string; retry: string; backHome: string; digest: string }> = {
  de: {
    title: "Etwas ist schiefgelaufen",
    text: "Bitte versuche es gleich noch einmal. Wenn der Fehler bleibt, schreib uns (Kontakt im Impressum).",
    retry: "Erneut versuchen",
    backHome: "Zur Startseite",
    digest: "Fehlernummer: {digest}",
  },
  en: {
    title: "Something went wrong",
    text: "Please try again in a moment. If the problem persists, contact us (details in the legal notice).",
    retry: "Try again",
    backHome: "Back to the home page",
    digest: "Error code: {digest}",
  },
  cs: {
    title: "Něco se pokazilo",
    text: "Zkus to prosím za chvíli znovu. Pokud chyba trvá, napiš nám (kontakt v tiráži).",
    retry: "Zkusit znovu",
    backHome: "Na úvodní stránku",
    digest: "Kód chyby: {digest}",
  },
  pl: {
    title: "Coś poszło nie tak",
    text: "Spróbuj ponownie za chwilę. Jeśli błąd nie znika, napisz do nas (kontakt w nocie prawnej).",
    retry: "Spróbuj ponownie",
    backHome: "Powrót do strony głównej",
    digest: "Kod błędu: {digest}",
  },
};
