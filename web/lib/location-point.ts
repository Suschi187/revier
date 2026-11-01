import { z } from "zod";
import type { PointInput } from "@/lib/services/listings";

// Punkt aus dem Formular des Schritts „Ort“ (ADR 016, Review B3, A7). Rein, damit Vitest es prüft. Vorgabe ist
// `keep`: Der gespeicherte Punkt wird nie als Eingabe zurückgeschickt, sonst verschöbe jedes Speichern ihn erneut.

const coordinates = z.object({
  lat: z.coerce.number().finite().min(-90).max(90),
  lng: z.coerce.number().finite().min(-180).max(180),
});

/** null bei ungültiger Eingabe; der Aufrufer meldet dann nur den Feldcode, nie die Werte. */
export function pointFromForm(form: FormData): PointInput | null {
  const mode = String(form.get("point") ?? "keep");
  if (mode === "keep") return { mode: "keep" };
  if (mode === "clear") return { mode: "clear" };
  if (mode !== "set") return null;
  const raw = { lat: String(form.get("lat") ?? ""), lng: String(form.get("lng") ?? "") };
  if (raw.lat.trim() === "" || raw.lng.trim() === "") return null;
  const parsed = coordinates.safeParse(raw);
  return parsed.success ? { mode: "set", lat: parsed.data.lat, lng: parsed.data.lng } : null;
}
