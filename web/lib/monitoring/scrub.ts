import type { ErrorEvent } from "@sentry/nextjs";

// Vor dem Versand an Sentry (ADR 023): Fehlerart, Meldung, Stack und der Pfad ohne Query. Keine IP, keine Cookies,
// keine Header, keine Query-Strings (Login-Links tragen token_hash, Abbestell-Links den Token, ADR 010/018), kein
// Nutzer, kein Request-Body, kein Servername, keine Breadcrumbs (sie könnten URLs mit Token enthalten).

export function stripQuery(url: string): string {
  const cut = url.search(/[?#]/);
  return cut === -1 ? url : url.slice(0, cut);
}

export function scrubEvent(event: ErrorEvent): ErrorEvent {
  delete event.user;
  delete event.server_name;
  delete event.breadcrumbs;
  if (event.request) {
    event.request = { url: event.request.url && stripQuery(event.request.url), method: event.request.method };
  }
  if (event.transaction) event.transaction = stripQuery(event.transaction);
  return event;
}
