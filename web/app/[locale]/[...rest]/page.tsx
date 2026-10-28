import { notFound } from "next/navigation";

// Fängt unbekannte Pfade unterhalb von /[locale] ab, damit die lokalisierte 404 greift.
// Rendert nie Inhalt, daher von der Instant-Navigation-Prüfung ausgenommen.
export const instant = false;

export default function CatchAll() {
  notFound();
}
