"use server";

import { redirect } from "next/navigation";
import { isAppLocale } from "@/lib/auth/paths";
import { requireOnboardedUser } from "@/lib/services/gate";
import { invalidatePublicListing } from "@/lib/services/public-cache";
import { deleteDraft, pauseListing, resumeListing, withdrawListing, type ListingError } from "@/lib/services/listings";

// Aktionen auf „Meine Anzeigen“ (Plan M3 7). Rechte und Übergänge prüft die DB; hier nur Anmeldung und
// Rückmeldung über einen Hinweis in der URL.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
type Notice = "withdrawn" | "paused" | "resumed" | "resumedReview" | "deleted";

function errorParam(error: ListingError): string {
  if (error.kind === "legal") return "legal";
  return "failed";
}

export async function changeListing(form: FormData): Promise<void> {
  const rawLocale = String(form.get("locale") ?? "");
  const locale = isAppLocale(rawLocale) ? rawLocale : "de";
  const user = await requireOnboardedUser(locale, `/${locale}/account/listings`);

  const id = String(form.get("id") ?? "");
  const action = String(form.get("action") ?? "");
  const base = `/${locale}/account/listings`;
  if (!UUID.test(id)) redirect(`${base}?error=failed`);

  let notice: Notice;
  let result;
  switch (action) {
    case "withdraw":
      result = await withdrawListing(id);
      notice = "withdrawn";
      break;
    case "pause":
      result = await pauseListing(id);
      notice = "paused";
      break;
    case "resume":
      result = await resumeListing(id);
      notice = result.ok && result.value === "pending_review" ? "resumedReview" : "resumed";
      break;
    case "delete":
      result = await deleteDraft(id);
      notice = "deleted";
      break;
    default:
      redirect(`${base}?error=failed`);
  }
  if (result.ok) invalidatePublicListing(id, user.id);
  redirect(result.ok ? `${base}?notice=${notice}` : `${base}?error=${errorParam(result.error)}`);
}
