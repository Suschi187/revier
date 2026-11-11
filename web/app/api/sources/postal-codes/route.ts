import { postalCodesCsv } from "@/lib/services/sources";

// Download der abgeleiteten PLZ-Tabelle unter ODbL (ADR 012, Seite „Datenquellen“). Öffentlich und cachebar, ohne
// Cookies; der Lizenzvermerk steht auf der Seite und im Link-Header.

export async function GET(): Promise<Response> {
  const csv = await postalCodesCsv();
  if (!csv) return new Response(null, { status: 502, headers: { "Cache-Control": "no-store" } });
  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="revier-postal-codes-odbl.csv"',
      "Cache-Control": "public, max-age=86400",
      "X-Content-Type-Options": "nosniff",
      Link: '<https://opendatacommons.org/licenses/odbl/1-0/>; rel="license"',
    },
  });
}
