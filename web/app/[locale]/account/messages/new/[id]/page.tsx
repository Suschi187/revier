import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { Composer } from "@/components/chat/Composer";
import { Link } from "@/i18n/navigation";
import type { AppLocale } from "@/i18n/routing";
import { publicPath } from "@/lib/public/paths";
import { conversationForListing } from "@/lib/services/chat";
import { requireOnboardedUser } from "@/lib/services/gate";
import { cacheEpoch, getPublicListing } from "@/lib/services/public-listings";
import { startConversationAction } from "../../actions";

// Kontakt beginnen (ADR 017, Review A2): Anzeigen-ID im Pfad, damit der Login-Rücksprung sie behält. Den Status
// (404/410) setzt der Proxy über public_page_state; gibt es schon eine Unterhaltung, geht es dorthin.
export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Chat.new");
  return { title: t("metaTitle"), robots: { index: false, follow: false } };
}

type Props = { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function NewConversationPage(props: Props) {
  const locale = (await getLocale()) as AppLocale;
  const { id } = await props.params;
  const query = await props.searchParams;
  const user = await requireOnboardedUser(locale, `/${locale}/account/messages/new/${id}`);
  const existing = await conversationForListing(id, user.id);
  if (existing) redirect(`/${locale}/account/messages/${existing}`);
  const [t, listing] = await Promise.all([getTranslations("Chat"), cacheEpoch().then((epoch) => getPublicListing(id, epoch))]);

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-12">
      <Link href="/account/messages" className="underline">{t("conversation.backToList")}</Link>
      <h1 className="mt-4 text-3xl font-semibold">{t("new.title")}</h1>
      {!listing ? (
        <p className="mt-4">{t("new.unavailable")}</p>
      ) : (
        <>
          <p className="mt-2 [overflow-wrap:anywhere]">
            <a href={publicPath({ route: "listing", id: listing.id }, locale)} className="underline" lang={listing.contentLanguage}>{listing.title}</a>
          </p>
          {listing.ownerId === user.id ? (
            <p className="mt-4" role="status">{t("new.ownListing")}</p>
          ) : (
            <>
              <p className="mt-4">{t("new.intro")}</p>
              <p className="mt-4 rounded border border-amber-700 bg-amber-50 p-3 text-sm">{t("safety")}</p>
              <Composer action={startConversationAction} id={listing.id} locale={locale} initialError={typeof query.error === "string" ? query.error : undefined} />
            </>
          )}
        </>
      )}
    </main>
  );
}
