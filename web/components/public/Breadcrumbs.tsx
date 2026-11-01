import { getTranslations } from "next-intl/server";
import { breadcrumbList } from "@/lib/public/json-ld";
import { JsonLd } from "./JsonLd";

export type Crumb = { name: string; href: string };

/** Brotkrumen (Review A12): `nav` mit Label, letzter Eintrag ist die aktuelle Seite; dazu BreadcrumbList (ADR 015). */
export async function Breadcrumbs({ crumbs }: { crumbs: Crumb[] }) {
  const t = await getTranslations("Public.detail");
  return (
    <>
      <JsonLd data={breadcrumbList(crumbs)} />
      <nav aria-label={t("breadcrumb")}>
        <ol className="flex flex-wrap gap-1 text-sm text-stone-700">
          {crumbs.map((crumb, i) => (
            <li key={crumb.href} className="flex gap-1">
              {i > 0 && <span aria-hidden="true">›</span>}
              {i === crumbs.length - 1 ? (
                <a href={crumb.href} aria-current="page">{crumb.name}</a>
              ) : (
                <a href={crumb.href} className="underline">{crumb.name}</a>
              )}
            </li>
          ))}
        </ol>
      </nav>
    </>
  );
}
