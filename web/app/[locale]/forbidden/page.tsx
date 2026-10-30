import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { forbidden } from "next/navigation";

// Ziel des Proxy-Rewrites für /admin ohne Rolle (ADR 014): liefert die lokalisierte 403-Seite.
export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Admin.forbidden");
  return { title: t("metaTitle"), robots: { index: false, follow: false } };
}

export default function ForbiddenPage() {
  forbidden();
}
