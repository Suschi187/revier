import { getLocale, getTranslations } from "next-intl/server";
import { signOut } from "@/app/[locale]/auth/actions";
import { Link } from "@/i18n/navigation";
import { getSessionUser } from "@/lib/services/auth";

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

  return (
    <div className="flex items-center gap-4">
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
