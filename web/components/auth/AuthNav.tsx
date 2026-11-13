import { useTranslations } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";
import { signOut } from "@/app/[locale]/auth/actions";
import { Icon, type IconName } from "@/components/ui/Icon";
import { Link } from "@/i18n/navigation";
import { getSessionUser } from "@/lib/services/auth";
import { UnreadRefresh } from "@/components/chat/UnreadRefresh";
import { unreadCount } from "@/lib/services/chat";

const item = "relative flex min-h-11 min-w-11 flex-col items-center justify-center gap-0.5 px-2 text-[0.6875rem] leading-tight text-forest no-underline";

function NavItem({ href, icon, label, ariaLabel, badge }: { href: string; icon: IconName; label: string; ariaLabel?: string; badge?: number }) {
  return (
    <Link href={href} prefetch={false} className={item} aria-label={ariaLabel}>
      <Icon name={icon} size={22} />
      <span>{label}</span>
      {badge ? (
        <span aria-hidden="true" className="absolute right-1 top-0 min-w-5 rounded-pill bg-brand px-1 text-center text-[0.6875rem] font-bold text-forest">{badge}</span>
      ) : null}
    </Link>
  );
}

/**
 * Platzhalter der Suspense-Grenze, ohne Session: steht immer im ersten HTML. Kommt AuthNav nur gestreamt (ohne
 * JavaScript verborgen), bleibt so das Konto erreichbar; ohne Anmeldung leitet /account zur Anmeldung.
 */
export function AuthNavFallback() {
  const t = useTranslations("Header");
  return (
    <nav aria-label={t("accountNav")} className="flex items-center">
      <NavItem href="/account" icon="user" label={t("account")} />
    </nav>
  );
}

// Liest die Session und steht deshalb im Kopf hinter einer Suspense-Grenze.
export async function AuthNav() {
  const [user, t, locale] = await Promise.all([getSessionUser(), getTranslations("Header"), getLocale()]);

  if (!user) {
    return (
      <nav aria-label={t("accountNav")} className="flex items-center">
        <NavItem href="/login" icon="user" label={t("signIn")} />
      </nav>
    );
  }

  // Zähler serverseitig (Review A13): kein Realtime außerhalb des Chats. Fehler → ohne Zahl.
  const [unread, tc] = await Promise.all([unreadCount(), getTranslations("Chat")]);

  return (
    <nav aria-label={t("accountNav")} className="flex items-center">
      <UnreadRefresh />
      <NavItem href="/account/messages" icon="message" label={t("messages")} ariaLabel={unread ? tc("navUnread", { count: unread }) : undefined} badge={unread || undefined} />
      <NavItem href="/account/favorites" icon="bookmark" label={t("favorites")} />
      <NavItem href="/account" icon="user" label={t("account")} />
      {user.adminHint && <NavItem href="/admin" icon="shieldAdmin" label={t("admin")} />}
      <form action={signOut}>
        <input type="hidden" name="locale" value={locale} />
        <button type="submit" className={item}>
          <Icon name="logout" size={22} />
          <span>{t("signOut")}</span>
        </button>
      </form>
    </nav>
  );
}
