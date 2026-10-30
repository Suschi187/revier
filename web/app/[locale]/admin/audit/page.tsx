import type { Metadata } from "next";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import type { AppLocale } from "@/i18n/routing";
import { requireAdmin } from "@/lib/services/admin";
import { AUDIT_ACTIONS, AUDIT_PAGE, getAuditLog } from "@/lib/services/audit";

// `instant = false` nimmt die Seite aus der Instant-Navigation-Prüfung, damit sie die Session ohne
// Suspense-Grenze liest. Den Status (403, Login) setzt der Proxy; die Prüfung hier autorisiert nur und kann
// den schon gesendeten Status nicht mehr ändern (ADR 014, QA M4 F1).
export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Admin.audit");
  return { title: t("metaTitle"), robots: { index: false, follow: false } };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function AuditPage({ searchParams }: Props) {
  const locale = (await getLocale()) as AppLocale;
  await requireAdmin(locale, `/${locale}/admin/audit`);
  const query = await searchParams;
  const action = AUDIT_ACTIONS.find((a) => a === query.action) ?? null;
  const targetId = typeof query.target === "string" && UUID.test(query.target.trim()) ? query.target.trim() : null;
  const before =
    typeof query.before === "string" && typeof query.beforeId === "string" && !Number.isNaN(Date.parse(query.before)) && UUID.test(query.beforeId)
      ? { createdAt: query.before, id: query.beforeId }
      : null;
  const [t, tl, tm, format, entries] = await Promise.all([
    getTranslations("Admin.audit"),
    getTranslations("Listings"),
    getTranslations("Moderation"),
    getFormatter(),
    getAuditLog({ action, targetId, before }),
  ]);
  const label = (value: string) => {
    const key = `actions.${value.replace(".", "_")}`;
    return t.has(key) ? t(key) : value;
  };
  // Schlüssel und bekannte Codes in der Sprache des Admins (QA M4 F6); Freitext und Unbekanntes bleiben roh.
  const detailKey = (key: string) => (t.has(`detailKeys.${key}`) ? t(`detailKeys.${key}`) : key);
  const detailValue = (key: string, value: unknown) => {
    if (typeof value !== "string") return JSON.stringify(value);
    if (key === "from" && tl.has(`status.${value}`)) return tl(`status.${value}`);
    if (key === "code" && tm.has(`reasons.${value}`)) return tm(`reasons.${value}`);
    if (key === "via" && t.has(`via.${value}`)) return t(`via.${value}`);
    return value;
  };
  const last = entries.at(-1);
  const filters = new URLSearchParams({ ...(action ? { action } : {}), ...(targetId ? { target: targetId } : {}) });

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-12">
      <Link href="/admin" className="underline">
        {t("back")}
      </Link>
      <h1 className="mt-4 text-3xl font-semibold">{t("title")}</h1>

      <form method="get" className="mt-6 flex flex-wrap items-end gap-4">
        <div>
          <label htmlFor="a-action" className="font-medium">
            {t("filterAction")}
          </label>
          <select id="a-action" name="action" defaultValue={action ?? ""} className="mt-1 block rounded border border-stone-400 px-3 py-2">
            <option value="">{t("filterAll")}</option>
            {AUDIT_ACTIONS.map((a) => (
              <option key={a} value={a}>
                {label(a)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="a-target" className="font-medium">
            {t("filterTarget")}
          </label>
          <input id="a-target" name="target" defaultValue={targetId ?? ""} className="mt-1 block w-80 max-w-full rounded border border-stone-400 px-3 py-2 font-mono text-sm" />
        </div>
        <button type="submit" className="rounded bg-emerald-800 px-4 py-2 font-medium text-white">
          {t("filter")}
        </button>
      </form>

      {entries.length === 0 ? (
        <p className="mt-6">{t("empty")}</p>
      ) : (
        <div className="mt-6 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-stone-400">
                <th scope="col" className="py-2 pr-4">{t("time")}</th>
                <th scope="col" className="py-2 pr-4">{t("action")}</th>
                <th scope="col" className="py-2 pr-4">{t("actor")}</th>
                <th scope="col" className="py-2 pr-4">{t("target")}</th>
                <th scope="col" className="py-2">{t("details")}</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id} className="border-b border-stone-200 align-top">
                  <td className="py-2 pr-4 whitespace-nowrap">{format.dateTime(new Date(entry.createdAt), { dateStyle: "short", timeStyle: "medium" })}</td>
                  <td className="py-2 pr-4">{label(entry.action)}</td>
                  <td className="py-2 pr-4">{entry.actorName ?? t("system")}</td>
                  <td className="py-2 pr-4 font-mono text-xs">
                    {entry.targetType}{" "}
                    <Link href={`/admin/audit?target=${entry.targetId}`} className="underline">
                      {entry.targetId.slice(0, 8)}
                    </Link>
                  </td>
                  <td className="py-2">
                    <dl className="grid grid-cols-[max-content_1fr] gap-x-2">
                      {Object.entries(entry.details)
                        .filter(([, value]) => value !== null && value !== undefined)
                        .map(([key, value]) => (
                          <div key={key} className="contents">
                            <dt className="font-medium">{detailKey(key)}</dt>
                            <dd className="break-words">{detailValue(key, value)}</dd>
                          </div>
                        ))}
                    </dl>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {entries.length === AUDIT_PAGE && last && (
        <Link
          href={`/admin/audit?${filters.toString()}${filters.size ? "&" : ""}before=${encodeURIComponent(last.createdAt)}&beforeId=${last.id}`}
          className="mt-6 inline-block underline"
        >
          {t("more")}
        </Link>
      )}
    </main>
  );
}
