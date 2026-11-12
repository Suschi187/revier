import { getTranslations } from "next-intl/server";

// Gesperrte Konten (Moderation) sehen statt des Formulars einen Hinweis (QA M2 F4).
export async function BlockedNotice() {
  const t = await getTranslations("Account.profile");
  return (
    <p role="alert" className="mt-6 rounded border border-error bg-error-soft p-3 text-error">
      {t("blocked")}
    </p>
  );
}
