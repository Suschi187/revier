import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { hasQuery, ListingsPage, type SearchParams } from "@/components/public/ListingsPage";
import type { AppLocale } from "@/i18n/routing";
import { listContext, listMetadata, type ListPage } from "@/lib/public/list-pages";
import { parsePath } from "@/lib/public/paths";

// Bundesland (/{l}/{kind}/{state}), ADR 015. Detail und Anbieter folgen unter derselben Form.
export const instant = false;

type Props = { params: Promise<{ locale: string; section: string; a: string }>; searchParams: Promise<SearchParams> };

async function resolve(props: Props): Promise<{ locale: AppLocale; page: ListPage } | null> {
  const { locale, section, a } = await props.params;
  const parsed = parsePath(`/${locale}/${section}/${a}`);
  if (parsed.type !== "public" || parsed.page.route !== "state") return null;
  return { locale: parsed.locale, page: parsed.page };
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const resolved = await resolve(props);
  if (!resolved) return {};
  return listMetadata(resolved.page, resolved.locale, hasQuery(await props.searchParams));
}

export default async function StatePage(props: Props) {
  const resolved = await resolve(props);
  if (!resolved) notFound();
  const context = await listContext(resolved.page, resolved.locale);
  if (!context) notFound();
  return (
    <ListingsPage
      locale={resolved.locale}
      page={resolved.page}
      fixed={context.fixed}
      searchParams={await props.searchParams}
      heading={context.heading}
      crumbs={context.crumbs}
    />
  );
}
