"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { routing } from "@/i18n/routing";
import { isAppLocale } from "@/lib/auth/paths";
import { requireOnboardedUser } from "@/lib/services/gate";
import { createDraft } from "@/lib/services/listings";
import { LISTING_DIRECTIONS, LISTING_KINDS, titleSchema } from "@/lib/validation/listing";

const draftSchema = z.object({
  kind: z.enum(LISTING_KINDS),
  direction: z.enum(LISTING_DIRECTIONS),
  title: titleSchema,
  contentLanguage: z.enum(routing.locales),
  regionId: z.uuid(),
});

/** Erster Schritt: legt den Entwurf an (Art, Richtung, Titel, Sprache, Kreis sind Pflichtspalten). */
export async function createListing(form: FormData): Promise<void> {
  const rawLocale = String(form.get("locale") ?? "");
  const locale = isAppLocale(rawLocale) ? rawLocale : "de";
  await requireOnboardedUser(locale, `/${locale}/account/listings/new`);
  const base = `/${locale}/account/listings/new`;

  const parsed = draftSchema.safeParse({
    kind: form.get("kind"),
    direction: form.get("direction"),
    title: form.get("title") ?? "",
    contentLanguage: form.get("contentLanguage"),
    regionId: form.get("regionId"),
  });
  if (!parsed.success) {
    const codes = [...new Set(parsed.error.issues.map((i) => (i.path[0] === "regionId" ? "district" : i.path[0] === "title" ? "title" : "form")))];
    redirect(`${base}?errors=${codes.join(",")}`);
  }

  const result = await createDraft(parsed.data);
  if (!result.ok) {
    if (result.error.kind === "legal") redirect(`/${locale}/welcome?next=${encodeURIComponent(base)}`);
    if (result.error.kind === "rateLimited") {
      redirect(`${base}?error=rateLimited${result.error.retryAfter ? `&retry=${encodeURIComponent(result.error.retryAfter)}` : ""}`);
    }
    redirect(`${base}?errors=form`);
  }
  redirect(`/${locale}/account/listings/${result.value}/edit?step=location`);
}
