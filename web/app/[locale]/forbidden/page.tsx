import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { forbidden } from "next/navigation";

// Ziel des Proxy-Rewrites für /admin ohne Rolle (ADR 014): Den Status 403 setzt der Rewrite, forbidden()
// rendert die lokalisierte Seite. `instant = false` wie im Admin-Bereich (ohne Suspense-Grenze).
export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Admin.forbidden");
  return { title: t("metaTitle"), robots: { index: false, follow: false } };
}

export default function ForbiddenPage() {
  forbidden();
}
