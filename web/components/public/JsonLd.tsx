import { jsonLdString } from "@/lib/public/json-ld";

/** Datenblock für strukturierte Daten; maskiert über jsonLdString (ADR 015). */
export function JsonLd({ data }: { data: unknown }) {
  // eslint-disable-next-line react/no-danger -- Datenblock, maskiert über jsonLdString; React würde ihn sonst als Text kodieren
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(data) }} />;
}
