import type { Metadata } from "next";
import { notFound } from "next/navigation";

// Ziel des Proxy-Rewrites für Pfade ohne Seite (ADR 015): Den Status 404 setzt der Rewrite, notFound() rendert
// die lokalisierte Seite. Direkt aufgerufen antwortet der Proxy ebenfalls mit 404.
export const instant = false;

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function MissingPage() {
  notFound();
}
