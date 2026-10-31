export type Crumb = { name: string; href: string };

/** Brotkrumen (Review A12): `nav` mit Label, letzter Eintrag ist die aktuelle Seite. */
export function Breadcrumbs({ crumbs, label }: { crumbs: Crumb[]; label?: string }) {
  return (
    <nav aria-label={label ?? "Breadcrumb"}>
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
  );
}
