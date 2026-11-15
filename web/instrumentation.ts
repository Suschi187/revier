import * as Sentry from "@sentry/nextjs";
import { scrubEvent } from "@/lib/monitoring/scrub";

// Fehler-Monitoring (M10, ADR 023): Sentry nur auf dem Server, EU-Datenregion über die DSN. Ohne SENTRY_DSN
// (lokal, CI) bleibt Sentry aus. Kein Browser-SDK: keine Anfragen an Dritte aus dem Browser, kein Consent nötig.
// Kein Tracing (tracesSampleRate 0) und keine personenbezogenen Daten (dataCollection, scrubEvent; lokal mit einem
// Fake-Sentry geprüft: IP, E-Mail, Token und Cookie kommen nicht an).

export function register() {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;
  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT ?? process.env.VERCEL_ENV ?? "production",
    // Sentry 11 sammelt ohne diese Angaben Nutzer, Cookies, Header, Bodies, Query und Datenbankwerte.
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      databaseQueryData: false,
      queues: false,
      stackFrameVariables: false,
    },
    tracesSampleRate: 0,
    beforeSend: scrubEvent,
  });
}

// Fehler aus Server Components, Route Handlern, Server Actions und dem Proxy; ohne init ein No-op.
export const onRequestError = Sentry.captureRequestError;
