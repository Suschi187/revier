import { getLocale, getTranslations } from "next-intl/server";
import { signOut } from "@/app/[locale]/auth/actions";
import { Link } from "@/i18n/navigation";
import { getSessionUser } from "@/lib/services/auth";
import { UnreadRefresh } from "@/components/chat/UnreadRefresh";
import { unreadCount } from "@/lib/services/chat";

// Liest die Session und steht deshalb im Layout hinter einer Suspense-Grenze.
export async function AuthNav() {
  const [user, t, locale] = await Promise.all([getSessionUser(), getTranslations("Auth.nav"), getLocale()]);

  if (!user) {
    return (
      <Link href="/login" className="underline">
        {t("signIn")}
      </Link>
    );
  }

  // Zähler serverseitig (Review A13): kein Realtime außerhalb des Chats. Fehler → ohne Zahl.
  const [unread, tc] = await Promise.all([unreadCount(), getTranslations("Chat")]);

  return (
    <div className="flex items-center gap-4">
      <UnreadRefresh />
      <Link href="/account/messages" prefetch={false} className="underline" aria-label={unread ? tc("navUnread", { count: unread }) : undefined}>
        {tc("nav")}
        {unread ? <span className="ml-1 rounded bg-stone-900 px-1.5 text-sm text-white no-underline" aria-hidden="true">{unread}</span> : null}
      </Link>
      {user.adminHint && (
        <Link href="/admin" className="underline">
          {t("admin")}
        </Link>
      )}
      <Link href="/account" className="underline">
        {t("account")}
      </Link>
      <form action={signOut}>
        <input type="hidden" name="locale" value={locale} />
        <button type="submit" className="underline">
          {t("signOut")}
        </button>
      </form>
    </div>
  );
}
