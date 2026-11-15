import type { Metadata } from "next";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { ChatLive } from "@/components/chat/ChatLive";
import { Link } from "@/i18n/navigation";
import type { AppLocale } from "@/i18n/routing";
import { counterpartName } from "@/lib/chat/names";
import { listConversations } from "@/lib/services/chat";
import { requireSessionUser } from "@/lib/services/auth";

// Unterhaltungsliste (ADR 017). Ohne Suspense, damit sie ohne JavaScript sichtbar ist; Nonce-CSP aus dem Proxy.
export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Chat");
  return { title: t("metaTitle"), robots: { index: false, follow: false } };
}

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function MessagesPage(props: Props) {
  const locale = (await getLocale()) as AppLocale;
  // Nur angemeldet, ohne Zustimmungs-Pflicht: Blockieren und Melden müssen immer erreichbar sein (QA M7 F1).
  const user = await requireSessionUser(locale, `/${locale}/account/messages`);
  const query = await props.searchParams;
  const cursor = typeof query.cursor === "string" && query.cursor.length <= 200 ? query.cursor : undefined;
  const [t, format, page] = await Promise.all([getTranslations("Chat"), getFormatter(), listConversations(cursor)]);

  return (
    <main id="main" className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6">
      <ChatLive userId={user.id} />
      <Link href="/account" className="text-sm underline underline-offset-2">← {t("back")}</Link>
      <h1 className="mt-4 font-display text-2xl font-extrabold uppercase leading-tight [overflow-wrap:anywhere] hyphens-auto sm:text-3xl">{t("title")}</h1>
      {!page && <p className="mt-4" role="alert">{t("loadFailed")}</p>}
      {page && page.items.length === 0 && <p className="mt-4">{t("empty")}</p>}
      {page && page.items.length > 0 && (
        <ul className="mt-6 grid grid-cols-[minmax(0,1fr)] gap-3">
          {page.items.map((item) => (
            <li key={item.id}>
              <Link
                href={`/account/messages/${item.id}`}
                prefetch={false}
                className={`flex min-w-0 gap-3 rounded-card border bg-surface p-3.5 text-forest no-underline hover:border-forest ${item.unread > 0 ? "border-forest" : "border-sand"}`}
                aria-label={item.unread > 0 ? `${counterpartName(item, t("accountUnavailable"))}, ${t("unread", { count: item.unread })}` : undefined}
              >
                <span aria-hidden="true" className="flex size-11 shrink-0 items-center justify-center rounded-full bg-olive font-semibold text-offwhite">
                  {counterpartName(item, t("accountUnavailable")).slice(0, 2).toUpperCase()}
                </span>
                <span className="block min-w-0 flex-1">
                <span className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-semibold [overflow-wrap:anywhere]">{counterpartName(item, t("accountUnavailable"))}</span>
                  {item.last_message_at && (
                    <time dateTime={item.last_message_at} className="text-sm text-muted">
                      {format.dateTime(new Date(item.last_message_at), { dateStyle: "medium", timeStyle: "short" })}
                    </time>
                  )}
                </span>
                <span className="block text-sm text-muted [overflow-wrap:anywhere]">
                  {item.role === "owner" && <>{t("roleOwner")}: </>}
                  {item.listing ? item.listing.title : t("listingUnavailable")}
                </span>
                {item.last_message && (
                  <span className="mt-1 block truncate">
                    {item.last_message.mine && <>{t("you")} </>}
                    {item.last_message.body}
                  </span>
                )}
                {item.unread > 0 && (
                  <span className="mt-1.5 inline-block rounded-pill bg-brand px-2.5 py-0.5 text-sm font-semibold text-forest">{t("unread", { count: item.unread })}</span>
                )}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {page?.nextCursor && (
        <Link href={`/account/messages?cursor=${encodeURIComponent(page.nextCursor)}`} className="mt-6 inline-flex min-h-11 items-center rounded-btn border border-forest bg-surface px-4 text-sm font-semibold text-forest no-underline hover:bg-sand">{t("more")}</Link>
      )}
    </main>
  );
}
