import type { Metadata } from "next";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { ChatLive } from "@/components/chat/ChatLive";
import { Composer } from "@/components/chat/Composer";
import { Link } from "@/i18n/navigation";
import type { AppLocale } from "@/i18n/routing";
import { counterpartName } from "@/lib/chat/names";
import { publicPath } from "@/lib/public/paths";
import { conversationInfo, conversationMessages, markRead } from "@/lib/services/chat";
import { requireSessionUser } from "@/lib/services/auth";
import { getLegalStatus } from "@/lib/services/legal";
import { blockAction, sendMessageAction, unblockAction } from "../actions";

// Chat-Ansicht (ADR 017). Fremde, unbekannte und ungültige IDs ergeben dieselbe Seite „nicht gefunden“ (noindex,
// no-store aus dem Proxy, Review A3). Text nur als React-Text, keine Autolinks (Review A12). Blockieren und Melden
// als Formulare bzw. Links, ohne JavaScript bedienbar (<details> als Menü).
export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Chat.conversation");
  return { title: t("metaTitle"), robots: { index: false, follow: false } };
}

type Props = { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

const NOTICES = ["blocked", "unblocked", "reported", "failed"] as const;

const BEFORE = /^(\d{4}-\d{2}-\d{2}T[\d:.]+(?:Z|[+-]\d{2}:\d{2}))\|([0-9a-f-]{36})$/;

export default async function ConversationPage(props: Props) {
  const locale = (await getLocale()) as AppLocale;
  const { id } = await props.params;
  // Nur angemeldet (QA M7 F1): Blockieren und Melden auch ohne aktuelle Zustimmung und für gesperrte Konten (ADR 017,
  // App Store, DSA). Schreiben verhindert ohne Zustimmung die DB (RV001); die Seite zeigt dann den Weg zur Zustimmung.
  const path = `/${locale}/account/messages/${id}`;
  const user = await requireSessionUser(locale, path);
  const [t, format, info, query, legal] = await Promise.all([
    getTranslations("Chat"), getFormatter(), conversationInfo(id), props.searchParams, getLegalStatus(),
  ]);

  if (!info) {
    return (
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6">
        <Link href="/account/messages" className="text-sm underline underline-offset-2">← {t("conversation.backToList")}</Link>
        <h1 className="mt-4 font-display text-2xl font-extrabold uppercase leading-tight [overflow-wrap:anywhere] hyphens-auto sm:text-3xl">{t("conversation.metaTitle")}</h1>
        <p className="mt-4">{t("conversation.notFound")}</p>
      </main>
    );
  }

  const before = typeof query.before === "string" ? BEFORE.exec(query.before) : null;
  // Öffnen markiert als gelesen (Links hierher ohne Prefetch). Erst danach laden, damit „gelesen“ stimmt.
  if (!before) await markRead(id);
  const page = await conversationMessages(id, before ? { before: { at: before[1], id: before[2] } } : undefined);
  const name = counterpartName(info, t("accountUnavailable"));
  const notice = NOTICES.find((code) => code === query.notice);
  const first = page?.items[0];

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6">
      <ChatLive userId={user.id} conversationId={id} />
      <Link href="/account/messages" className="text-sm underline underline-offset-2">← {t("conversation.backToList")}</Link>
      <header className="mt-4 rounded-card border border-sand bg-surface p-4">
        <div className="flex items-center gap-3">
        <span aria-hidden="true" className="flex size-12 shrink-0 items-center justify-center rounded-full bg-olive font-semibold text-offwhite">{name.slice(0, 2).toUpperCase()}</span>
        <div className="min-w-0">
        <h1 className="font-display text-2xl font-extrabold uppercase leading-tight [overflow-wrap:anywhere] hyphens-auto sm:text-3xl">{name}</h1>
        <p className="mt-1 text-sm [overflow-wrap:anywhere]">
          {info.listing?.public ? (
            <a href={publicPath({ route: "listing", id: info.listing.id }, locale)} className="underline">{info.listing.title}</a>
          ) : info.listing ? (
            <span>{info.listing.title}</span>
          ) : (
            <span>{t("listingUnavailable")}</span>
          )}
        </p>
        </div>
        </div>
        <details className="mt-3">
          <summary className="cursor-pointer text-sm underline underline-offset-2">{t("menu.label")}</summary>
          <div className="mt-2 flex flex-wrap gap-3">
            {!info.blocked_by_me && (
              <form action={blockAction}>
                <input type="hidden" name="locale" value={locale} />
                <input type="hidden" name="id" value={id} />
                <button type="submit" className="min-h-11 rounded-btn border border-forest bg-surface px-3 text-sm font-semibold hover:bg-sand">{t("menu.block")}</button>
              </form>
            )}
            {info.counterpart.profile && (
              <Link href={`/account/messages/${id}/report?profile=1`} prefetch={false} className="inline-flex min-h-11 items-center rounded-btn border border-forest bg-surface px-3 text-sm font-semibold text-forest no-underline hover:bg-sand">
                {t("menu.reportProfile")}
              </Link>
            )}
          </div>
        </details>
      </header>
      {notice && (
        <p className="mt-4" role={notice === "failed" ? "alert" : "status"}>{t(`notices.${notice}`)}</p>
      )}

      <p className="mt-4 rounded-card border border-notice bg-notice-soft p-3 text-sm text-notice">{t("safety")}</p>

      {page?.hasMore && first && (
        <Link
          href={`/account/messages/${id}?before=${encodeURIComponent(`${first.created_at}|${first.id}`)}`}
          prefetch={false}
          className="mt-6 inline-block underline"
        >
          {t("conversation.older")}
        </Link>
      )}

      {/* Log-Rolle am Container: auf der Liste selbst nähme sie den Einträgen die Listen-Semantik (axe listitem). */}
      <div role="log" aria-label={t("conversation.messagesLabel")} className="mt-4 rounded-card bg-sand/50 p-3 sm:p-4">
      <ol className="grid grid-cols-[minmax(0,1fr)] gap-3">
        {(page?.items ?? []).map((message, index, all) => (
          <li
            key={message.id}
            id={index === all.length - 1 ? "latest" : undefined}
            className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 ${message.mine ? "justify-self-end rounded-br-sm bg-forest text-offwhite" : "justify-self-start rounded-bl-sm border border-sand bg-surface"}`}
          >
            <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">{message.body}</p>
            <p className={`mt-1 text-xs ${message.mine ? "text-offwhite" : "text-muted"}`}>
              <time dateTime={message.created_at}>{format.dateTime(new Date(message.created_at), { dateStyle: "short", timeStyle: "short" })}</time>
              {message.mine && <> · {message.read_at ? t("conversation.read") : t("conversation.sent")}</>}
            </p>
            {!message.mine && (
              <Link href={`/account/messages/${id}/report?message=${message.id}`} prefetch={false} className="mt-1 inline-block text-xs underline">
                {t("menu.reportMessage")}
              </Link>
            )}
          </li>
        ))}
      </ol>
      </div>
      {!page && <p className="mt-4" role="alert">{t("loadFailed")}</p>}

      {info.can_write && legal && !legal.accepted ? (
        <p className="mt-6 rounded-card border border-field bg-surface p-3" role="status">
          {t("legalRequired")}{" "}
          <a href={`/${locale}/welcome?next=${encodeURIComponent(path)}`} className="underline">{t("legalLink")}</a>
        </p>
      ) : info.can_write ? (
        <Composer action={sendMessageAction} id={id} locale={locale} initialError={typeof query.error === "string" ? query.error : undefined} owner={info.role === "owner"} />
      ) : (
        <div className="mt-6 flex flex-wrap items-center gap-3 rounded-card border border-field bg-surface p-3">
          <p>{info.blocked_by_me ? t("blockedByMe") : t("cannotWrite")}</p>
          {info.blocked_by_me && (
            <form action={unblockAction}>
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="id" value={id} />
              <button type="submit" className="underline">{t("menu.unblock")}</button>
            </form>
          )}
        </div>
      )}
    </main>
  );
}
